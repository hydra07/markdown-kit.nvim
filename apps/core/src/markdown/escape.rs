/// Escape the five HTML-significant characters in a single pass.
///
/// The naive `s.replace(...).replace(...)...` chain rescans and reallocates
/// the *entire* string once per character — 4 full passes + 4 buffers for
/// text that, in the common case, has almost nothing to escape. This walks
/// the string once, copying runs of unescaped bytes in one `push_str` and
/// only ever allocating the single output buffer.
pub(crate) fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut last = 0;
    for (i, b) in s.bytes().enumerate() {
        let entity = match b {
            b'&' => "&amp;",
            b'<' => "&lt;",
            b'>' => "&gt;",
            b'"' => "&quot;",
            _ => continue,
        };
        out.push_str(&s[last..i]);
        out.push_str(entity);
        last = i + 1;
    }
    out.push_str(&s[last..]);
    out
}
