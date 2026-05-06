//! Markdown → HTML rendering (Mermaid, fenced code, preprocessors).

mod escape;
mod flowchart_legacy;
mod highlight;
mod mermaid;
mod preprocess;

pub use highlight::highlight_code;

#[doc(hidden)]
pub mod __test_support {
    //! Crate integration tests only; not a stable API.
    pub fn legacy_flowchart_js_to_mermaid(src: &str) -> Option<String> {
        super::flowchart_legacy::legacy_flowchart_js_to_mermaid(src)
    }

    pub fn clean_legacy_flowchart_label(raw: &str) -> String {
        super::flowchart_legacy::clean_legacy_flowchart_label(raw)
    }
}

/// Convert a raw Markdown string to an HTML fragment.
pub fn render(markdown: &str, _theme: &str) -> String {
    let preprocessed = preprocess::preprocess_plantuml(markdown);
    let preprocessed = preprocess::preprocess_math(&preprocessed);
    let preprocessed = preprocess::preprocess_images(&preprocessed);

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

    let opts = pulldown_cmark::Options::ENABLE_TABLES
        | pulldown_cmark::Options::ENABLE_FOOTNOTES
        | pulldown_cmark::Options::ENABLE_STRIKETHROUGH
        | pulldown_cmark::Options::ENABLE_TASKLISTS
        | pulldown_cmark::Options::ENABLE_SMART_PUNCTUATION;

    let mut html_output = String::with_capacity(preprocessed.len() * 2);
    let parser =
        pulldown_cmark::Parser::new_ext(&preprocessed, opts).into_offset_iter();

    let mut in_code_block = false;
    let mut current_lang = String::new();
    let mut current_code = String::new();
    let mut current_start_line: usize = 0;
    let mut current_end_line: usize = 0;

    let is_wrappable_block =
        |tag: &pulldown_cmark::Tag| {
            matches!(
                tag,
                pulldown_cmark::Tag::Paragraph
                    | pulldown_cmark::Tag::Heading { .. }
                    | pulldown_cmark::Tag::BlockQuote(_)
                    | pulldown_cmark::Tag::Table(_)
            )
        };
    let is_wrappable_block_end = |tag: &pulldown_cmark::TagEnd| {
        matches!(
            tag,
            pulldown_cmark::TagEnd::Paragraph
                | pulldown_cmark::TagEnd::Heading(_)
                | pulldown_cmark::TagEnd::BlockQuote(_)
                | pulldown_cmark::TagEnd::Table
        )
    };

    let events = parser.flat_map(|(event, range)| {
        use pulldown_cmark::{CodeBlockKind, Event, Tag, TagEnd};
        use smallvec::{SmallVec, smallvec};
        let mut output: SmallVec<[Event; 3]> = smallvec![];

        match event {
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

            Event::Start(Tag::List(_)) | Event::Start(Tag::Item) => {
                let start = get_line(range.start);
                let end = get_line(range.end);
                output.push(Event::Html(format!("<!-- src:{start}:{end} -->").into()));
                output.push(event);
            }

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

                let html_block = match lang {
                    "mermaid" => mermaid::render_mermaid_block(&current_code, &data_attrs),
                    "flowchart" | "diagram" => {
                        match flowchart_legacy::legacy_flowchart_js_to_mermaid(&current_code) {
                            Some(m) => mermaid::render_mermaid_block(&m, &data_attrs),
                            None => format!(
                                r#"<pre class="hljs" {data_attrs}><code class="language-{lang}">{}</code></pre>"#,
                                escape::escape_html(&current_code)
                            ),
                        }
                    }
                    "plantuml" => format!(
                        r#"<pre class="plantuml" {data_attrs}>{}</pre>"#,
                        escape::escape_html(&current_code)
                    ),
                    _ => {
                        let highlighted =
                            highlight::highlight_code(&current_code, lang, current_start_line);
                        format!(
                            r#"<pre class="hljs" {data_attrs}><code class="language-{lang}">{highlighted}</code></pre>"#
                        )
                    }
                };

                output.push(Event::Html(html_block.into()));
            }

            _ if !in_code_block => output.push(event),
            _ => {}
        }

        output
    });

    pulldown_cmark::html::push_html(&mut html_output, events);
    html_output
}
