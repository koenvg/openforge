//! Atlassian Document Format → plain text.
//!
//! Jira Cloud's v3 REST API returns rich text fields (notably `description`) as
//! ADF node trees rather than strings. The walkthrough prompt needs readable
//! text, so we flatten the tree, preserving enough structure (headings, list
//! bullets, paragraph breaks) that an agent can still recognise an
//! "Acceptance Criteria" section inside a description.

use serde_json::Value;

/// Flatten an ADF value to plain text.
///
/// Tolerates anything that isn't a recognisable ADF document: a plain string is
/// returned as-is (older payloads and some fields are stored that way), and
/// null/unknown shapes yield an empty string rather than an error.
pub fn adf_to_text(value: &Value) -> String {
    if let Some(text) = value.as_str() {
        return text.to_string();
    }
    let mut raw = String::new();
    render_node(value, &mut raw);
    normalize(&raw)
}

fn render_node(node: &Value, out: &mut String) {
    let Some(object) = node.as_object() else {
        return;
    };
    let node_type = object
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default();

    match node_type {
        "text" => {
            if let Some(text) = object.get("text").and_then(Value::as_str) {
                out.push_str(text);
            }
        }
        "hardBreak" => out.push('\n'),
        "doc" => render_children(node, out),
        "heading" => {
            let level = object
                .get("attrs")
                .and_then(|attrs| attrs.get("level"))
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, 6) as usize;
            out.push_str(&"#".repeat(level));
            out.push(' ');
            render_children(node, out);
            out.push_str("\n\n");
        }
        "bulletList" | "orderedList" => {
            render_children(node, out);
            out.push('\n');
        }
        "listItem" => {
            let mut inner = String::new();
            render_children(node, &mut inner);
            let inner = normalize(&inner);
            if !inner.is_empty() {
                out.push_str("- ");
                // Indent continuation lines so nested lists stay readable.
                out.push_str(&inner.replace('\n', "\n  "));
                out.push('\n');
            }
        }
        _ => {
            // Paragraphs, code blocks, panels, blockquotes, tables — anything
            // carrying `content` recurses, so unknown node types never silently
            // drop ticket text. Inline nodes such as mentions expose their label
            // on `attrs.text`.
            if object.contains_key("content") {
                render_children(node, out);
                out.push_str("\n\n");
            } else if let Some(text) = object
                .get("attrs")
                .and_then(|attrs| attrs.get("text"))
                .and_then(Value::as_str)
            {
                out.push_str(text);
            }
        }
    }
}

fn render_children(node: &Value, out: &mut String) {
    let Some(children) = node.get("content").and_then(Value::as_array) else {
        return;
    };
    for child in children {
        render_node(child, out);
    }
}

/// Trim trailing whitespace per line, collapse runs of blank lines to one, and
/// trim the ends — the block renderers above emit generously and rely on this.
fn normalize(raw: &str) -> String {
    let mut lines: Vec<&str> = Vec::new();
    let mut blank_run = 0;
    for line in raw.lines() {
        let line = line.trim_end();
        if line.is_empty() {
            blank_run += 1;
            if blank_run > 1 {
                continue;
            }
        } else {
            blank_run = 0;
        }
        lines.push(line);
    }
    lines.join("\n").trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn doc(content: Value) -> Value {
        json!({ "type": "doc", "version": 1, "content": content })
    }

    fn paragraph(text: &str) -> Value {
        json!({ "type": "paragraph", "content": [{ "type": "text", "text": text }] })
    }

    #[test]
    fn flattens_a_single_paragraph() {
        assert_eq!(
            adf_to_text(&doc(json!([paragraph("Hello world")]))),
            "Hello world"
        );
    }

    #[test]
    fn separates_paragraphs_with_a_blank_line() {
        let value = doc(json!([paragraph("First."), paragraph("Second.")]));
        assert_eq!(adf_to_text(&value), "First.\n\nSecond.");
    }

    #[test]
    fn renders_bullet_list_items_with_a_dash() {
        let value = doc(json!([{
            "type": "bulletList",
            "content": [
                { "type": "listItem", "content": [paragraph("One")] },
                { "type": "listItem", "content": [paragraph("Two")] },
            ],
        }]));
        assert_eq!(adf_to_text(&value), "- One\n- Two");
    }

    #[test]
    fn renders_headings_as_markdown_so_an_ac_section_stays_recognisable() {
        let value = doc(json!([
            { "type": "heading", "attrs": { "level": 2 },
              "content": [{ "type": "text", "text": "Acceptance Criteria" }] },
            paragraph("The user can log in."),
        ]));
        assert_eq!(
            adf_to_text(&value),
            "## Acceptance Criteria\n\nThe user can log in."
        );
    }

    #[test]
    fn hard_breaks_become_newlines_within_a_paragraph() {
        let value = doc(json!([{
            "type": "paragraph",
            "content": [
                { "type": "text", "text": "Line one" },
                { "type": "hardBreak" },
                { "type": "text", "text": "Line two" },
            ],
        }]));
        assert_eq!(adf_to_text(&value), "Line one\nLine two");
    }

    #[test]
    fn nested_lists_keep_every_item() {
        let value = doc(json!([{
            "type": "bulletList",
            "content": [{
                "type": "listItem",
                "content": [
                    paragraph("Outer"),
                    { "type": "bulletList", "content": [
                        { "type": "listItem", "content": [paragraph("Inner")] },
                    ]},
                ],
            }],
        }]));
        let text = adf_to_text(&value);
        assert!(text.contains("Outer"), "outer item missing from {text:?}");
        assert!(text.contains("Inner"), "nested item missing from {text:?}");
    }

    #[test]
    fn a_plain_string_is_returned_unchanged() {
        assert_eq!(
            adf_to_text(&json!("legacy plain description")),
            "legacy plain description"
        );
    }

    #[test]
    fn null_and_unknown_shapes_yield_empty_text() {
        assert_eq!(adf_to_text(&Value::Null), "");
        assert_eq!(adf_to_text(&json!({ "type": "doc" })), "");
        assert_eq!(adf_to_text(&json!(42)), "");
    }

    #[test]
    fn unknown_block_nodes_still_yield_their_text() {
        // Panels, blockquotes, tables — anything with `content` recurses so no
        // ticket text is silently dropped just because we don't know the node.
        let value = doc(json!([{
            "type": "panel",
            "attrs": { "panelType": "info" },
            "content": [paragraph("Important detail")],
        }]));
        assert_eq!(adf_to_text(&value), "Important detail");
    }
}
