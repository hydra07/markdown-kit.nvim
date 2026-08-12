use std::borrow::Cow;

use crate::markdown::escape::escape_html;

/// Render debounces to ~80ms but still re-runs the full preprocessing chain on
/// every settled keystroke. Most documents never touch PlantUML/math/sized
/// images, so each stage returns `Cow::Borrowed` untouched input when its
/// trigger pattern isn't present — skipping a full-buffer allocation + copy
/// that would otherwise happen on every single render.
pub(crate) fn preprocess_plantuml(md: &str) -> Cow<'_, str> {
    if !md.contains("@startuml") {
        return Cow::Borrowed(md);
    }

    let mut out = String::with_capacity(md.len());
    let mut rest = md;

    while let Some(start) = rest.find("@startuml") {
        out.push_str(&rest[..start]);
        let after_start = &rest[start + "@startuml".len()..];

        if let Some(end_rel) = after_start.find("@enduml") {
            let body = &after_start[..end_rel];
            out.push_str("```plantuml\n");
            out.push_str(body.trim_matches('\n'));
            out.push_str("\n```");
            rest = &after_start[end_rel + "@enduml".len()..];
            if rest.starts_with('\n') {
                rest = &rest[1..];
            }
        } else {
            out.push_str(&rest[start..]);
            return Cow::Owned(out);
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

pub(crate) fn preprocess_math(md: &str) -> Cow<'_, str> {
    if !md.contains('$') {
        return Cow::Borrowed(md);
    }

    let mut out = String::with_capacity(md.len() + 64);
    let chars: Vec<char> = md.chars().collect();
    let len = chars.len();
    let mut i = 0;

    while i < len {
        if i + 1 < len && chars[i] == '$' && chars[i + 1] == '$' {
            if let Some(end) = find_closing(&chars, i + 2, "$$") {
                let inner: String = chars[i + 2..end].iter().collect();
                out.push_str("<div class=\"math-block\">");
                out.push_str(&escape_html(inner.trim()));
                out.push_str("</div>");
                i = end + 2;
                continue;
            }
        }

        if chars[i] == '$' {
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
    Cow::Owned(out)
}

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

fn find_closing_inline(chars: &[char], from: usize) -> Option<usize> {
    for i in from..chars.len() {
        if chars[i] == '$' {
            if i > 0 && chars[i - 1] == ' ' {
                continue;
            }
            let after = chars.get(i + 1).copied().unwrap_or(' ');
            if after.is_ascii_digit() {
                continue;
            }
            return Some(i);
        }
        if chars[i] == '\n' {
            return None;
        }
    }
    None
}

pub(crate) fn preprocess_images(md: &str) -> Cow<'_, str> {
    if !md.contains("![") {
        return Cow::Borrowed(md);
    }

    let mut out = String::with_capacity(md.len());
    let mut chars = md.char_indices().peekable();

    while let Some((i, c)) = chars.next() {
        if c == '!' && md[i..].starts_with("![") {
            if let Some((consumed, img_html)) = try_parse_image(&md[i..]) {
                out.push_str(&img_html);
                for _ in 0..consumed.saturating_sub(1) {
                    chars.next();
                }
                continue;
            }
        }
        out.push(c);
    }
    Cow::Owned(out)
}

fn try_parse_image(s: &str) -> Option<(usize, String)> {
    let alt_end = s[2..].find(']')? + 2;
    let alt = &s[2..alt_end];
    let rest = &s[alt_end + 1..];
    if !rest.starts_with('(') {
        return None;
    }
    let paren_end = rest.find(')')?;
    let inner = &rest[1..paren_end];
    let size_pat = inner.find(" =")?;
    let url = inner[..size_pat].trim();
    let size = &inner[size_pat + 2..];
    let x_pos = size.find('x')?;
    let w = &size[..x_pos];
    let h = &size[x_pos + 1..];
    let width_attr = if w.is_empty() { String::new() } else { format!(" width=\"{w}\"") };
    let height_attr = if h.is_empty() { String::new() } else { format!(" height=\"{h}\"") };
    let html = format!("<img src=\"{url}\" alt=\"{alt}\"{width_attr}{height_attr} />");
    Some((alt_end + 1 + paren_end + 1, html))
}
