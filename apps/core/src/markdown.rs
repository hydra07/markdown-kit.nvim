use pulldown_cmark::{CodeBlockKind, Event, Options, Parser, Tag, TagEnd, html};
use smallvec::{SmallVec, smallvec};
use std::sync::atomic::{AtomicUsize, Ordering};
use syntect::{
    easy::HighlightLines,
    highlighting::ThemeSet,
    html::{IncludeBackground, styled_line_to_highlighted_html},
    parsing::SyntaxSet,
};

// ---------------------------------------------------------------------------
// Static syntax / theme sets — expensive to build, built once.
// ---------------------------------------------------------------------------

static SS: std::sync::LazyLock<SyntaxSet> =
    std::sync::LazyLock::new(SyntaxSet::load_defaults_newlines);

static TS: std::sync::LazyLock<ThemeSet> = std::sync::LazyLock::new(ThemeSet::load_defaults);

// Global counter so every mermaid SVG in the same document gets unique IDs.
// Wrapping is fine — 4 billion diagrams per process is not a concern.
static MERMAID_CTR: AtomicUsize = AtomicUsize::new(0);

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Convert a raw Markdown string to an HTML fragment.
///
/// Guarantees kept from the original implementation:
/// * Block-level elements receive `data-src-start` / `data-src-end` attributes
///   (line numbers, 1-based) so a Neovim / Preact client can sync cursor
///   position without re-parsing.
/// * Fenced code blocks are syntax-highlighted via syntect.
/// * `mermaid` fences are rendered to inline SVG via `mermaid_rs_renderer`
///   (falls back to `<pre class="mermaid">` on error).
/// * `![alt](url =WxH)` syntax is expanded to `<img … width height />`.
///
/// Fixes over v1:
/// * SVG gets `max-width:100%;height:auto` so it never overflows the viewport.
/// * Duplicate `<marker id>` collisions between multiple mermaid diagrams are
///   resolved by scoping every id/href to a per-diagram index.
/// * `<div style="display:contents">` wrappers are **not** emitted for `List`
///   or `Item` tags — placing a `<div>` inside `<ul>/<ol>` is invalid HTML
///   and breaks browser rendering.
/// * `@startuml … @enduml` blocks are converted to fenced `plantuml` blocks
///   before parsing so they appear as code blocks rather than raw paragraphs.
/// * `$…$` / `$$…$$` LaTeX is preserved as
///   `<span class="math-inline">` / `<div class="math-block">` placeholders
///   that KaTeX auto-render can pick up on the client.
pub fn render(markdown: &str, _theme: &str) -> String {
    // Pre-processing pipeline (order matters).
    let preprocessed = preprocess_plantuml(markdown);
    let preprocessed = preprocess_math(&preprocessed);
    let preprocessed = preprocess_images(&preprocessed);

    // Build line-start index for O(log n) offset → line-number lookups.
    let mut line_starts: Vec<usize> = vec![0];
    for (i, c) in preprocessed.char_indices() {
        if c == '\n' {
            line_starts.push(i + c.len_utf8());
        }
    }
    let get_line = |byte_offset: usize| -> usize {
        match line_starts.binary_search(&byte_offset) {
            Ok(idx) => idx + 1,
            Err(idx) => idx,
        }
    };

    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_SMART_PUNCTUATION;

    let mut html_output = String::with_capacity(preprocessed.len() * 2);
    let parser = Parser::new_ext(&preprocessed, opts).into_offset_iter();

    // -----------------------------------------------------------------------
    // Per-render state for code-block accumulation.
    // -----------------------------------------------------------------------
    let mut in_code_block = false;
    let mut current_lang = String::new();
    let mut current_code = String::new();
    let mut current_start_line: usize = 0;
    let mut current_end_line: usize = 0;

    // Tags that should receive data-src-* wrappers.
    // IMPORTANT: List / Item are intentionally excluded — a bare <div> inside
    // <ul>/<ol> is invalid HTML; browsers hoist it out and break list layout.
    let is_wrappable_block = |tag: &Tag| {
        matches!(
            tag,
            Tag::Paragraph | Tag::Heading { .. } | Tag::BlockQuote(_) | Tag::Table(_)
        )
    };
    let is_wrappable_block_end = |tag: &TagEnd| {
        matches!(
            tag,
            TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::BlockQuote(_) | TagEnd::Table
        )
    };

    let events = parser.flat_map(|(event, range)| {
        let mut output: SmallVec<[Event; 3]> = smallvec![];

        match event {
            // ----------------------------------------------------------------
            // Block wrappers for cursor-sync (valid elements only).
            // ----------------------------------------------------------------
            Event::Start(ref tag) if is_wrappable_block(tag) => {
                let start = get_line(range.start);
                let end = get_line(range.end);
                output.push(Event::Html(
                    format!(
                        "<div data-src-start=\"{start}\" data-src-end=\"{end}\" \
                         style=\"display:contents\">"
                    )
                    .into(),
                ));
                output.push(event);
            }
            Event::End(ref tag) if is_wrappable_block_end(tag) => {
                output.push(event);
                output.push(Event::Html("</div>".into()));
            }

            // ----------------------------------------------------------------
            // List / Item: emit data-src-* as custom HTML attributes on the
            // surrounding element by injecting a comment node that the client
            // can query. This keeps the DOM valid while still exposing line
            // numbers for Neovim sync.
            // ----------------------------------------------------------------
            Event::Start(Tag::List(_)) | Event::Start(Tag::Item) => {
                let start = get_line(range.start);
                let end = get_line(range.end);
                output.push(Event::Html(
                    format!(
                        "<!-- src:{start}:{end} -->"
                    )
                    .into(),
                ));
                output.push(event);
            }

            // ----------------------------------------------------------------
            // Fenced code blocks.
            // ----------------------------------------------------------------
            Event::Start(Tag::CodeBlock(kind)) => {
                in_code_block = true;
                current_start_line = get_line(range.start);
                current_end_line = get_line(range.end);
                current_lang = match kind {
                    CodeBlockKind::Fenced(lang) => lang.into_string(),
                    CodeBlockKind::Indented => String::new(),
                };
                current_code.clear();
            }
            Event::Text(ref text) if in_code_block => {
                current_code.push_str(text);
            }
            Event::End(TagEnd::CodeBlock) => {
                in_code_block = false;
                let lang = current_lang
                    .trim()
                    .split_whitespace()
                    .next()
                    .unwrap_or("");
                let data_attrs = format!(
                    "data-src-start=\"{current_start_line}\" \
                     data-src-end=\"{current_end_line}\""
                );

                let html_block = if lang == "mermaid" {
                    render_mermaid_block(&current_code, &data_attrs)
                } else if lang == "plantuml" {
                    // plantuml: show as styled pre (no server-side renderer).
                    format!(
                        r#"<pre class="plantuml" {data_attrs}>{}</pre>"#,
                        escape_html(&current_code)
                    )
                } else {
                    let highlighted = highlight_code(&current_code, lang, current_start_line);
                    format!(
                        r#"<pre class="hljs" {data_attrs}><code class="language-{lang}">{highlighted}</code></pre>"#
                    )
                };

                output.push(Event::Html(html_block.into()));
            }

            // ----------------------------------------------------------------
            // Pass-through for everything else (when not inside a code block).
            // ----------------------------------------------------------------
            _ if !in_code_block => {
                output.push(event);
            }
            _ => {}
        }

        output
    });

    html::push_html(&mut html_output, events);
    html_output
}

// ---------------------------------------------------------------------------
// Mermaid rendering
// ---------------------------------------------------------------------------

/// Render a mermaid code block to an inline SVG with all fixes applied:
/// - `max-width: 100%; height: auto` for responsive layout
/// - `overflow-x: auto` wrapper so wide diagrams scroll instead of overflow
/// - Unique marker/gradient IDs scoped to a per-diagram counter
fn render_mermaid_block(code: &str, data_attrs: &str) -> String {
    let idx = MERMAID_CTR.fetch_add(1, Ordering::Relaxed);

    match mermaid_rs_renderer::render(code) {
        Ok(raw_svg) => {
            let svg = make_svg_responsive(&raw_svg);
            let svg = scope_svg_ids(&svg, idx);
            format!(
                r#"<div class="mermaid-rendered" {data_attrs} style="overflow-x:auto">{svg}</div>"#
            )
        }
        Err(_) => {
            // Fallback: raw source in a pre so the user can still read it.
            format!(
                r#"<pre class="mermaid" {data_attrs}>{}</pre>"#,
                escape_html(code)
            )
        }
    }
}

/// Inject `style="max-width:100%;height:auto;display:block"` into the root
/// `<svg` tag so the diagram scales to its container on any viewport.
fn make_svg_responsive(svg: &str) -> String {
    // Find the opening <svg tag and insert the style attribute right after it.
    if let Some(pos) = svg.find("<svg") {
        // Check if there's already a style attribute; if so, prepend our rules.
        let tag_end = svg[pos..].find('>').unwrap_or(svg.len() - pos) + pos;
        let tag_slice = &svg[pos..=tag_end];

        if tag_slice.contains("style=") {
            // Prepend responsive rules to the existing style value.
            let new_tag = tag_slice.replacen(
                "style=\"",
                "style=\"max-width:100%;height:auto;display:block;",
                1,
            );
            let mut out = svg.to_string();
            out.replace_range(pos..=tag_end, &new_tag);
            return out;
        } else {
            // No existing style — insert fresh attribute after "<svg".
            let insert_at = pos + 4; // len("<svg") == 4
            let mut out = svg.to_string();
            out.insert_str(
                insert_at,
                " style=\"max-width:100%;height:auto;display:block\"",
            );
            return out;
        }
    }
    svg.to_string()
}

/// Prefix every `id="…"` and every `url(#…)` / `href="#…"` reference in the
/// SVG with `m{idx}-` so multiple diagrams on the same page don't share IDs.
///
/// This is a deliberate text-level transform rather than DOM parsing to keep
/// the dependency tree clean (no `roxmltree` / `scraper` needed).
fn scope_svg_ids(svg: &str, idx: usize) -> String {
    let prefix = format!("m{idx}-");
    let mut out = svg.to_string();

    // 1. id="…"  →  id="m{idx}-…"
    out = replace_attr_ids(&out, "id=\"", &prefix);

    // 2. url(#…)  →  url(#m{idx}-…)
    out = out.replace("url(#", &format!("url(#{prefix}"));

    // 3. href="#…"  →  href="#m{idx}-…"
    out = replace_attr_ids(&out, "href=\"#", &format!("href=\"#{prefix}"));

    // 4. xlink:href="#…"  (older SVG)
    out = replace_attr_ids(&out, "xlink:href=\"#", &format!("xlink:href=\"#{prefix}"));

    out
}

/// For patterns like `attr_prefix + value + '"'`, insert `insert` between
/// the prefix and the value.  Handles multiple occurrences.
fn replace_attr_ids(s: &str, attr_prefix: &str, replacement_prefix: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find(attr_prefix) {
        out.push_str(&rest[..pos]);
        out.push_str(replacement_prefix);
        rest = &rest[pos + attr_prefix.len()..];
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Syntax highlighting
// ---------------------------------------------------------------------------

/// Syntax-highlight `code` for `lang` using syntect.
/// Falls back to HTML-escaped plain text for unknown languages.
pub fn highlight_code(code: &str, lang: &str, start_line: usize) -> String {
    let syntax = SS
        .find_syntax_by_token(lang)
        .unwrap_or_else(|| SS.find_syntax_plain_text());

    // Prefer the dark ocean theme; fall back to InspiredGitHub (always present).
    let theme = TS
        .themes
        .get("base16-ocean.dark")
        .or_else(|| TS.themes.get("InspiredGitHub"))
        .expect("bundled syntect themes must exist");

    let mut h = HighlightLines::new(syntax, theme);
    let mut out = String::new();

    let mut line_no = start_line;
    for line in syntect::util::LinesWithEndings::from(code) {
        let ranges = h.highlight_line(line, &SS).unwrap_or_default();
        let html_line = styled_line_to_highlighted_html(&ranges[..], IncludeBackground::No)
            .unwrap_or_else(|_| escape_html(line));
        out.push_str(&format!(
            r#"<span class="src-line" data-src-start="{line_no}" data-src-end="{line_no}">{html_line}</span>"#
        ));
        if line.ends_with('\n') {
            line_no += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------
// Pre-processing helpers
// ---------------------------------------------------------------------------

/// Convert PlantUML blocks (`@startuml … @enduml`) to fenced ```plantuml
/// blocks so pulldown-cmark treats them as code blocks rather than raw
/// paragraphs that get mangled by the inline parser.
fn preprocess_plantuml(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut rest = md;

    while let Some(start) = rest.find("@startuml") {
        // Everything before the marker passes through unchanged.
        out.push_str(&rest[..start]);

        let after_start = &rest[start + "@startuml".len()..];

        if let Some(end_rel) = after_start.find("@enduml") {
            // Capture the diagram body (may include an optional diagram name
            // on the same line as @startuml, which we preserve).
            let body = &after_start[..end_rel];
            out.push_str("```plantuml\n");
            out.push_str(body.trim_matches('\n'));
            out.push_str("\n```");

            rest = &after_start[end_rel + "@enduml".len()..];
            // Consume a trailing newline if present to avoid blank lines.
            if rest.starts_with('\n') {
                rest = &rest[1..];
            }
        } else {
            // No closing tag — emit verbatim and stop scanning.
            out.push_str(&rest[start..]);
            return out;
        }
    }
    out.push_str(rest);
    out
}

/// Wrap `$$…$$` and `$…$` LaTeX in placeholder elements so KaTeX auto-render
/// can process them on the client.  Emits raw HTML so pulldown-cmark's inline
/// parser doesn't touch the math content.
///
/// Rules (matching KaTeX / markdown-it-katex conventions):
/// * `$$` blocks are converted to `<div class="math-block">…</div>`.
/// * `$…$` spans are converted to `<span class="math-inline">…</span>`.
/// * A lone `$` followed by a space or digit is **not** treated as math
///   (avoids false positives like "$20,000 and $30,000").
fn preprocess_math(md: &str) -> String {
    let mut out = String::with_capacity(md.len() + 64);
    let chars: Vec<char> = md.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        // ----------------------------------------------------------------
        // $$…$$ — block math
        // ----------------------------------------------------------------
        if i + 1 < len && chars[i] == '$' && chars[i + 1] == '$' {
            // Look for the closing $$
            if let Some(end) = find_closing(&chars, i + 2, "$$") {
                let inner: String = chars[i + 2..end].iter().collect();
                out.push_str("<div class=\"math-block\">");
                out.push_str(&escape_html(inner.trim()));
                out.push_str("</div>");
                i = end + 2;
                continue;
            }
        }

        // ----------------------------------------------------------------
        // $…$ — inline math
        // ----------------------------------------------------------------
        if chars[i] == '$' {
            // The character immediately after $ must not be a space or digit
            // (guards against "$20,000" style false positives).
            let next = chars.get(i + 1).copied().unwrap_or(' ');
            if next != ' ' && !next.is_ascii_digit() && next != '$' {
                if let Some(end) = find_closing_inline(&chars, i + 1) {
                    let inner: String = chars[i + 1..end].iter().collect();
                    out.push_str("<span class=\"math-inline\">");
                    out.push_str(&escape_html(inner.trim()));
                    out.push_str("</span>");
                    i = end + 1;
                    continue;
                }
            }
        }

        out.push(chars[i]);
        i += 1;
    }

    out
}

/// Find the position of the first occurrence of `needle` starting at `from`
/// in the char slice.  Returns the index of the first char of `needle`.
fn find_closing(chars: &[char], from: usize, needle: &str) -> Option<usize> {
    let nc: Vec<char> = needle.chars().collect();
    let nlen = nc.len();
    'outer: for i in from..chars.len().saturating_sub(nlen - 1) {
        for (j, &nc_c) in nc.iter().enumerate() {
            if chars[i + j] != nc_c {
                continue 'outer;
            }
        }
        return Some(i);
    }
    None
}

/// Find the closing `$` for inline math starting at `from`.
/// The closing `$` must not be preceded by a space and must not be followed
/// by a digit (standard KaTeX rules).
fn find_closing_inline(chars: &[char], from: usize) -> Option<usize> {
    for i in from..chars.len() {
        if chars[i] == '$' {
            // Reject if the previous char is a space.
            if i > 0 && chars[i - 1] == ' ' {
                continue;
            }
            // Reject if followed by a digit.
            let after = chars.get(i + 1).copied().unwrap_or(' ');
            if after.is_ascii_digit() {
                continue;
            }
            return Some(i);
        }
        // Don't cross newlines for inline math.
        if chars[i] == '\n' {
            return None;
        }
    }
    None
}

/// Pre-process `![alt](url =WxH)` → `<img src="url" alt="alt" width="W" height="H" />`.
/// Regex-free to keep the dependency tree clean.
fn preprocess_images(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    let mut chars = md.char_indices().peekable();

    while let Some((i, c)) = chars.next() {
        if c == '!' && md[i..].starts_with("![") {
            if let Some((consumed, img_html)) = try_parse_image(&md[i..]) {
                out.push_str(&img_html);
                // Skip the bytes already consumed (minus the one we already
                // advanced with `.next()` above).
                for _ in 0..consumed.saturating_sub(1) {
                    chars.next();
                }
                continue;
            }
        }
        out.push(c);
    }
    out
}

/// Returns `(bytes_consumed, html_string)` for `![alt](url =WxH)`, else `None`.
fn try_parse_image(s: &str) -> Option<(usize, String)> {
    // Must start with "!["
    let alt_end = s[2..].find(']')? + 2;
    let alt = &s[2..alt_end];

    let rest = &s[alt_end + 1..];
    if !rest.starts_with('(') {
        return None;
    }
    let paren_end = rest.find(')')?;
    let inner = &rest[1..paren_end];

    // Detect " =WxH" size hint
    let size_pat = inner.find(" =")?;
    let url = inner[..size_pat].trim();
    let size = &inner[size_pat + 2..];
    let x_pos = size.find('x')?;
    let w = &size[..x_pos];
    let h = &size[x_pos + 1..];

    let width_attr = if w.is_empty() {
        String::new()
    } else {
        format!(" width=\"{w}\"")
    };
    let height_attr = if h.is_empty() {
        String::new()
    } else {
        format!(" height=\"{h}\"")
    };
    let html = format!("<img src=\"{url}\" alt=\"{alt}\"{width_attr}{height_attr} />");

    let consumed = alt_end + 1 + paren_end + 1;
    Some((consumed, html))
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/// Escape HTML special characters.  Used as a safe fallback throughout.
fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
