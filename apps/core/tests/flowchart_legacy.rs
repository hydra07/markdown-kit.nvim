use mk_core::markdown::__test_support::{
    clean_legacy_flowchart_label, legacy_flowchart_js_to_mermaid,
};

#[test]
fn preserves_status_badges_from_pipe_segments() {
    assert_eq!(
        clean_legacy_flowchart_label("Stuff|current"),
        "Stuff (current)"
    );
    assert_eq!(
        clean_legacy_flowchart_label("Start|past:>http://example.com[blank]"),
        "Start (past)"
    );
}

#[test]
fn io_node_uses_trap_syntax_without_inner_quotes() {
    let m = legacy_flowchart_js_to_mermaid("io=>inputoutput: catch x|future\na->io\n").expect("convert");
    assert!(m.lines().any(|l| l.contains("io[/") && l.contains("/]")));
    assert!(!m.contains("[/\"catch"));
}

#[test]
fn edge_labels_not_wrapped_in_extra_quotes() {
    let m = legacy_flowchart_js_to_mermaid(
        "a=>start: A\nb=>end: B\nc=>condition: C\na->c(yes)->b\n",
    )
    .expect("convert");
    assert!(m.contains("-->|yes|"));
    assert!(!m.contains("|\"yes\"|"));
}

#[test]
fn sample_test_md_renders_in_mermaid_rs() {
    let src = include_str!("../../../test.md");
    let start = src.find("```flowchart").expect("fence");
    let body_start = src[start..].find('\n').expect("nl") + start + 1;
    let end = src[body_start..].find("```").expect("close") + body_start;
    let block = &src[body_start..end];
    let m = legacy_flowchart_js_to_mermaid(block).expect("convert");
    assert!(mermaid_rs_renderer::render(&m).is_ok());
}
