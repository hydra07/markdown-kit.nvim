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

// Was `include_str!("../../../test.md")` — test.md is a gitignored scratch
// file (see `.gitignore`'s "# old" section), so it never exists in a fresh
// clone or CI checkout and the test binary failed to compile there. Inlined
// the exact fence content it was reading so the test still exercises the
// same legacy flowchart.js sample without depending on untracked local state.
const SAMPLE_LEGACY_FLOWCHART: &str = "\
st=>start: Start|past:>http://www.google.com[blank]
e=>end: End|future:>http://www.google.com
op1=>operation: My Operation|past
op2=>operation: Stuff|current
sub1=>subroutine: My Subroutine|invalid
cond=>condition: Yes
or No?|approved:>http://www.google.com
c2=>condition: Good idea|rejected
io=>inputoutput: catch something...|future

st->op1(right)->cond
cond(yes, right)->c2
cond(no)->sub1(left)->op1
c2(yes)->io->e
c2(no)->op2->e
";

#[test]
fn sample_test_md_renders_in_mermaid_rs() {
    let m = legacy_flowchart_js_to_mermaid(SAMPLE_LEGACY_FLOWCHART).expect("convert");
    assert!(mermaid_rs_renderer::render(&m).is_ok());
}
