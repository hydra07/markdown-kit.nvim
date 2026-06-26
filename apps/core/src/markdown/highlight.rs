use std::fmt::Write;

use syntect::{
    easy::HighlightLines,
    highlighting::ThemeSet,
    html::{IncludeBackground, styled_line_to_highlighted_html},
    parsing::SyntaxSet,
};

use crate::markdown::escape::escape_html;

static SS: std::sync::LazyLock<SyntaxSet> =
    std::sync::LazyLock::new(SyntaxSet::load_defaults_newlines);

static TS: std::sync::LazyLock<ThemeSet> =
    std::sync::LazyLock::new(ThemeSet::load_defaults);

pub fn highlight_code(code: &str, lang: &str, start_line: usize) -> String {
    let syntax = SS
        .find_syntax_by_token(lang)
        .unwrap_or_else(|| SS.find_syntax_plain_text());

    let theme = TS
        .themes
        .get("base16-ocean.dark")
        .or_else(|| TS.themes.get("InspiredGitHub"))
        .expect("bundled syntect themes must exist");

    let mut h = HighlightLines::new(syntax, theme);
    // Highlighted HTML is consistently larger than the source; pre-size to cut
    // reallocations on big code blocks.
    let mut out = String::with_capacity(code.len() * 4);
    let mut line_no = start_line;

    for line in syntect::util::LinesWithEndings::from(code) {
        let ranges = h.highlight_line(line, &SS).unwrap_or_default();
        let html_line =
            styled_line_to_highlighted_html(&ranges[..], IncludeBackground::No)
                .unwrap_or_else(|_| escape_html(line));
        // Write straight into the buffer — avoids a throwaway String per line.
        let _ = write!(
            out,
            r#"<span class="src-line" data-src-start="{line_no}" data-src-end="{line_no}">{html_line}</span>"#
        );
        if line.ends_with('\n') {
            line_no += 1;
        }
    }
    out
}
