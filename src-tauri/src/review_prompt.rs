/// Build the code review prompt for an OpenCode agent session.
/// The agent will analyze the PR changes and produce structured review feedback.
pub fn build_review_prompt(
    base_ref: &str,
    head_ref: &str,
    pr_title: &str,
    pr_body: Option<&str>,
) -> String {
    let mut prompt = String::new();

    prompt.push_str("You are a code reviewer tasked with reviewing a pull request.\n\n");

    // Context section
    prompt.push_str("=== PULL REQUEST CONTEXT ===\n");
    prompt.push_str(&format!("Title: {}\n", pr_title));

    if let Some(body) = pr_body {
        if !body.is_empty() {
            prompt.push_str(&format!("Description:\n{}\n", body));
        }
    }

    prompt.push_str(&format!("Base branch: {}\n", base_ref));
    prompt.push_str(&format!("Head branch: {}\n\n", head_ref));

    // Instruction section
    prompt.push_str("=== YOUR TASK ===\n");
    prompt.push_str(&format!(
        "Run the following command to see ALL changes in this PR:\n\n  git diff origin/{}...HEAD\n\n",
        base_ref
    ));
    prompt.push_str("Analyze the diff output and provide a thorough code review.\n\n");

    // Review focus areas
    prompt.push_str("=== REVIEW FOCUS AREAS ===\n");
    prompt.push_str("Focus on:\n");
    prompt.push_str("- Bugs and logic errors\n");
    prompt.push_str("- Security vulnerabilities\n");
    prompt.push_str("- Performance issues\n");
    prompt.push_str("- Code clarity and readability\n");
    prompt.push_str("- Missing error handling\n");
    prompt.push_str("- Incomplete implementations\n");
    prompt.push_str("- Potential edge cases\n\n");

    // Output schema
    prompt.push_str("=== OUTPUT FORMAT ===\n");
    prompt.push_str("You MUST output ONLY a single JSON block in the following format, with no text before or after:\n\n");
    prompt.push_str("```json\n");
    prompt.push_str("{\n");
    prompt.push_str("  \"summary\": \"Overall review summary. Be concise but thorough.\",\n");
    prompt.push_str("  \"comments\": [\n");
    prompt.push_str("    {\n");
    prompt.push_str("      \"file\": \"path/to/file.rs\",\n");
    prompt.push_str("      \"line\": 42,\n");
    prompt.push_str("      \"side\": \"RIGHT\",\n");
    prompt.push_str("      \"body\": \"Specific review comment...\"\n");
    prompt.push_str("    }\n");
    prompt.push_str("  ]\n");
    prompt.push_str("}\n");
    prompt.push_str("```\n\n");

    // Line number explanation
    prompt.push_str("=== FIELD EXPLANATIONS ===\n");
    prompt.push_str("- `summary`: A concise overall assessment of the PR. Include key findings and overall quality.\n");
    prompt.push_str(
        "- `comments`: Array of specific review comments. Leave empty if no issues found.\n",
    );
    prompt
        .push_str("- `file`: The file path (relative to repo root) where the issue is located.\n");
    prompt.push_str("- `line`: The line number in the file where the issue occurs. Use the line number from the new file (RIGHT side).\n");
    prompt.push_str("- `side`: Use \"RIGHT\" for comments on new code (most common), or \"LEFT\" for comments on deleted code.\n");
    prompt.push_str("- `body`: The review comment. Be specific, actionable, and explain why the change is problematic.\n\n");

    // Good comment examples
    prompt.push_str("=== GOOD COMMENT EXAMPLES ===\n");
    prompt.push_str("Example 1 (Bug):\n");
    prompt.push_str("  \"body\": \"This function doesn't handle the case where `items` is empty. The loop will panic if items.len() is 0. Consider adding a guard clause or returning early.\"\n\n");
    prompt.push_str("Example 2 (Security):\n");
    prompt.push_str("  \"body\": \"User input is passed directly to SQL without parameterization. This is vulnerable to SQL injection. Use prepared statements instead.\"\n\n");
    prompt.push_str("Example 3 (Performance):\n");
    prompt.push_str("  \"body\": \"This O(n²) loop iterates over the same collection twice. Consider using a HashMap to reduce to O(n).\"\n\n");

    // Selectivity instruction
    prompt.push_str("=== QUALITY OVER QUANTITY ===\n");
    prompt.push_str("Only comment on real issues, not style preferences or minor nitpicks.\n");
    prompt.push_str("Aim for 3-5 high-quality comments rather than 20 trivial ones.\n");
    prompt.push_str("If the code is well-written with no issues, return:\n\n");
    prompt.push_str("```json\n");
    prompt.push_str("{\"summary\": \"LGTM - no issues found.\", \"comments\": []}\n");
    prompt.push_str("```\n");

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_review_prompt_contains_json_schema() {
        let prompt = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Check for JSON schema fields
        assert!(
            prompt.contains("\"summary\""),
            "Prompt should contain 'summary' field"
        );
        assert!(
            prompt.contains("\"comments\""),
            "Prompt should contain 'comments' field"
        );
        assert!(
            prompt.contains("\"file\""),
            "Prompt should contain 'file' field"
        );
        assert!(
            prompt.contains("\"line\""),
            "Prompt should contain 'line' field"
        );
        assert!(
            prompt.contains("\"side\""),
            "Prompt should contain 'side' field"
        );
        assert!(
            prompt.contains("\"body\""),
            "Prompt should contain 'body' field"
        );
    }

    #[test]
    fn test_review_prompt_includes_base_ref() {
        let prompt = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Check for base_ref in git diff command
        assert!(
            prompt.contains("git diff origin/main...HEAD"),
            "Prompt should contain git diff command with base_ref"
        );
        assert!(prompt.contains("main"), "Prompt should contain base_ref");
        assert!(
            prompt.contains("feature-branch"),
            "Prompt should contain head_ref"
        );
    }

    #[test]
    fn test_review_prompt_with_and_without_body() {
        let with_body = build_review_prompt(
            "main",
            "feature-branch",
            "Add new feature",
            Some("This PR adds support for async operations"),
        );

        let without_body = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Both should contain the title
        assert!(with_body.contains("Add new feature"));
        assert!(without_body.contains("Add new feature"));

        // Only the one with body should contain the description
        assert!(with_body.contains("This PR adds support for async operations"));
        assert!(!without_body.contains("This PR adds support for async operations"));

        // Both should contain the git diff command
        assert!(with_body.contains("git diff origin/main...HEAD"));
        assert!(without_body.contains("git diff origin/main...HEAD"));
    }

    #[test]
    fn test_review_prompt_includes_focus_areas() {
        let prompt = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Check for review focus areas
        assert!(prompt.contains("Bugs and logic errors"));
        assert!(prompt.contains("Security vulnerabilities"));
        assert!(prompt.contains("Performance issues"));
        assert!(prompt.contains("Code clarity"));
        assert!(prompt.contains("Missing error handling"));
    }

    #[test]
    fn test_review_prompt_includes_examples() {
        let prompt = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Check for good comment examples
        assert!(prompt.contains("Example 1"));
        assert!(prompt.contains("Example 2"));
        assert!(prompt.contains("Example 3"));
        assert!(prompt.contains("SQL injection"));
    }

    #[test]
    fn test_review_prompt_includes_lgtm_example() {
        let prompt = build_review_prompt("main", "feature-branch", "Add new feature", None);

        // Check for LGTM example
        assert!(prompt.contains("LGTM - no issues found"));
    }
}
