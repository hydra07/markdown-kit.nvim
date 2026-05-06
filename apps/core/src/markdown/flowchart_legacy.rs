use std::collections::{HashMap, HashSet};

pub(crate) fn legacy_flowchart_js_to_mermaid(src: &str) -> Option<String> {
    let mut nodes: HashMap<String, (String, String)> = HashMap::new();
    let mut pending: Option<(String, String, String)> = None;
    let mut edge_sources: Vec<String> = Vec::new();

    fn flush_pending(
        pending: &mut Option<(String, String, String)>,
        nodes: &mut HashMap<String, (String, String)>,
    ) {
        let Some((id, kind, raw)) = pending.take() else {
            return;
        };
        let label = clean_legacy_flowchart_label(&raw);
        nodes.insert(id, (kind, label));
    }

    for line in src.lines() {
        let trimmed = line.trim();
        let ends_line = trimmed;

        let is_edge = ends_line.contains("->")
            && !ends_line.contains("=>")
            && ends_line
                .split("->")
                .any(|seg| !seg.trim().is_empty());

        if is_edge {
            flush_pending(&mut pending, &mut nodes);
            edge_sources.push(ends_line.to_string());
            continue;
        }

        if let Some((id, kind, after_colon)) = try_parse_flowchart_node_line(ends_line) {
            flush_pending(&mut pending, &mut nodes);
            pending = Some((id, kind, after_colon));
        } else if let Some((_, _, buf)) = pending.as_mut() {
            buf.push(' ');
            buf.push_str(ends_line);
        }
    }
    flush_pending(&mut pending, &mut nodes);

    if nodes.is_empty() && edge_sources.is_empty() {
        return None;
    }

    let mut refs: HashSet<String> = HashSet::new();
    for (id, _) in &nodes {
        refs.insert(id.clone());
    }
    for line in &edge_sources {
        for part in line.split("->") {
            let (id, _) = parse_flowchart_js_token(part.trim());
            if !id.is_empty() {
                refs.insert(id);
            }
        }
    }

    for id in &refs {
        nodes.entry(id.clone()).or_insert_with(|| {
            ("operation".to_string(), id.replace('_', " "))
        });
    }

    let mut out = String::from("flowchart TD\n");
    let mut ids: Vec<String> = nodes.keys().cloned().collect();
    ids.sort_unstable();

    for id in ids {
        let (kind, label) = nodes.get(&id).expect("merged map");
        out.push_str(&flowchart_js_node_def(&id, kind, label));
        out.push('\n');
    }

    for line in edge_sources {
        let parts: Vec<&str> = line
            .split("->")
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .collect();
        if parts.len() < 2 {
            continue;
        }
        for w in parts.windows(2) {
            let (from_id, edge_lbl) = parse_flowchart_js_token(w[0]);
            let (to_id, _) = parse_flowchart_js_token(w[1]);
            if from_id.is_empty() || to_id.is_empty() {
                continue;
            }
            match edge_lbl {
                Some(l) if !l.is_empty() => {
                    let le = mermaid_escape_mid_edge_label(&l);
                    out.push_str(&format!("    {} -->|{}| {}", from_id, le, to_id));
                }
                _ => out.push_str(&format!("    {} --> {}", from_id, to_id)),
            }
            out.push('\n');
        }
    }

    Some(out)
}

fn try_parse_flowchart_node_line(line: &str) -> Option<(String, String, String)> {
    let (left, rest) = line.split_once("=>")?;
    let id = left.trim().to_string();
    if id.is_empty() {
        return None;
    }
    let (kind, label_rest) = rest.split_once(':')?;
    let kind = kind.trim().to_string();
    if kind.is_empty() {
        return None;
    }
    Some((id, kind, label_rest.trim().to_string()))
}

/// Exposed only for integration tests (`tests/flowchart_legacy.rs`).
pub(crate) fn clean_legacy_flowchart_label(raw: &str) -> String {
    const STATUS: &[&str] =
        &["past", "future", "current", "approved", "rejected", "invalid"];

    let segs: Vec<&str> = raw
        .split('|')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect();
    if segs.is_empty() {
        return String::new();
    }

    let main = segs[0]
        .trim_end_matches("[blank]")
        .trim()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");

    let mut badges: Vec<String> = Vec::new();
    for s in segs.iter().copied().skip(1) {
        let keyword_opt = if let Some((before, link_rest)) = s.split_once(":>") {
            if link_rest.contains("http://") || link_rest.contains("https://") {
                before.split(':').next().unwrap_or(before).trim()
            } else {
                ""
            }
        } else if s.contains("http://") || s.contains("https://") {
            ""
        } else {
            s.split(':').next().unwrap_or(s).trim()
        };
        if keyword_opt.is_empty() {
            continue;
        }
        if STATUS.iter().any(|k| keyword_opt.eq_ignore_ascii_case(k)) {
            badges.push(keyword_opt.to_ascii_lowercase());
        }
    }

    badges.sort_unstable();
    badges.dedup();

    match (main.is_empty(), badges.is_empty()) {
        (true, true) => String::new(),
        (true, false) => badges.join(", "),
        (false, true) => main,
        (false, false) => format!("{} ({})", main, badges.join(", ")),
    }
}

fn mermaid_escape_mid_edge_label(text: &str) -> String {
    text.chars()
        .map(|c| match c {
            '\n' | '\r' => ' ',
            '|' => '·',
            _ => c,
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn mermaid_escape_label(text: &str) -> String {
    text.chars()
        .map(|c| if c == '\n' { ' ' } else { c })
        .collect::<String>()
        .trim()
        .to_string()
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
}

fn flowchart_js_node_def(id: &str, kind: &str, label: &str) -> String {
    let q = mermaid_escape_label(label);
    let q = if q.is_empty() { id.to_string() } else { q };
    match kind {
        "start" | "end" => format!(r#"    {}(["{}"])"#, id, q),
        "operation" => format!(r#"    {}["{}"]"#, id, q),
        "subroutine" => format!(r#"    {}[["{}"]]"#, id, q),
        "condition" => {
            let mut s = format!("    {id}");
            s.push('{');
            s.push('"');
            s.push_str(&q);
            s.push('"');
            s.push('}');
            s
        }
        "inputoutput" => {
            if q.contains('/') || q.contains('[') || q.contains(']') {
                format!(r#"    {}["{}"]"#, id, q)
            } else {
                format!(r#"    {}[/{}/]"#, id, q)
            }
        }
        "parallel" => format!(r#"    {}[["{}"]]"#, id, q),
        _ => format!(r#"    {}["{}"]"#, id, q),
    }
}

fn parse_flowchart_js_token(segment: &str) -> (String, Option<String>) {
    let s = segment.trim();
    let Some(open) = s.find('(') else {
        return (s.to_string(), None);
    };
    let Some(close) = s.rfind(')') else {
        return (s.to_string(), None);
    };
    if close <= open {
        return (s.to_string(), None);
    }
    let id = s[..open].trim().to_string();
    let inner = s[open + 1..close].trim();
    if matches!(inner, "left" | "right" | "top" | "bottom") {
        return (id, None);
    }
    let branch = inner.split(',').next().unwrap_or("").trim().to_string();
    if branch.is_empty() {
        (id, None)
    } else {
        (id, Some(branch))
    }
}
