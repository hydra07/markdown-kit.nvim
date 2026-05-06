use std::sync::atomic::{AtomicUsize, Ordering};

use base64::Engine as _;

use crate::markdown::escape::escape_html;

static MERMAID_CTR: AtomicUsize = AtomicUsize::new(0);

/// Render a mermaid block to inline `<svg>`.
pub(crate) fn render_mermaid_block(code: &str, data_attrs: &str) -> String {
    let idx = MERMAID_CTR.fetch_add(1, Ordering::Relaxed);

    match mermaid_rs_renderer::render(code) {
        Ok(raw_svg) => {
            let svg = make_svg_responsive(&raw_svg);
            let svg = scope_svg_ids(&svg, idx);
            let b64 =
                base64::engine::general_purpose::STANDARD.encode(svg.as_bytes());

            format!(
                r#"<div class="mermaid-rendered" {data_attrs} data-svg-b64="{b64}">{svg}</div>"#
            )
        }
        Err(_) => format!(
            r#"<pre class="mermaid" {data_attrs}>{}</pre>"#,
            escape_html(code)
        ),
    }
}

pub(crate) fn make_svg_responsive(svg: &str) -> String {
    let tag_end = match svg.find('>') {
        Some(pos) => pos,
        None => return svg.to_string(),
    };
    let tag = &svg[..tag_end];
    let rest = &svg[tag_end..];

    let width = extract_attr_value(tag, "width");
    let height = extract_attr_value(tag, "height");

    let tag = if !tag.contains("viewBox") {
        match (&width, &height) {
            (Some(w), Some(h)) => {
                tag.replacen("<svg", &format!("<svg viewBox=\"0 0 {w} {h}\""), 1)
            }
            _ => tag.to_string(),
        }
    } else {
        tag.to_string()
    };

    let tag = remove_attr(&tag, "width");
    let tag = remove_attr(&tag, "height");

    let tag = if tag.contains("style=") {
        tag.replacen(
            "style=\"",
            "style=\"max-width:100%;height:auto;display:block;",
            1,
        )
    } else {
        tag.replacen(
            "<svg",
            "<svg style=\"max-width:100%;height:auto;display:block\"",
            1,
        )
    };

    format!("{tag}{rest}")
}

pub(crate) fn extract_attr_value(tag: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = tag.find(&needle)? + needle.len();
    let end = tag[start..].find('"')? + start;
    let raw = &tag[start..end];
    let trimmed = raw.trim_end_matches(|c: char| !c.is_ascii_digit());
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

pub(crate) fn remove_attr(tag: &str, attr: &str) -> String {
    let needle = format!("{attr}=\"");
    let Some(start) = tag.find(&needle) else {
        return tag.to_string();
    };
    let after_open = start + needle.len();
    let Some(rel_end) = tag[after_open..].find('"') else {
        return tag.to_string();
    };
    let end = after_open + rel_end + 1;

    let (trim_start, trim_end) = if start > 0 && tag.as_bytes()[start - 1] == b' ' {
        (start - 1, end)
    } else if end < tag.len() && tag.as_bytes()[end] == b' ' {
        (start, end + 1)
    } else {
        (start, end)
    };

    format!("{}{}", &tag[..trim_start], &tag[trim_end..])
}

pub(crate) fn scope_svg_ids(svg: &str, idx: usize) -> String {
    let prefix = format!("m{idx}-");
    let mut out = svg.to_string();
    out = replace_attr_ids(&out, "id=\"", &prefix);
    out = out.replace("url(#", &format!("url(#{prefix}"));
    out = replace_attr_ids(&out, "href=\"#", &prefix);
    out = replace_attr_ids(&out, "xlink:href=\"#", &prefix);
    out
}

fn replace_attr_ids(s: &str, attr_prefix: &str, replacement_prefix: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(pos) = rest.find(attr_prefix) {
        out.push_str(&rest[..pos]);
        out.push_str(attr_prefix);
        out.push_str(replacement_prefix);
        rest = &rest[pos + attr_prefix.len()..];
    }
    out.push_str(rest);
    out
}
