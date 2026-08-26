use crate::db;
use serde::{Deserialize, Serialize};

pub const START_PROMPT_CONTRIBUTIONS_CONFIG_KEY: &str = "start_prompt_contributions";
pub(crate) const MAX_START_PROMPT_CONTRIBUTION_LENGTH: usize = 16_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct StartPromptContribution {
    /// Plugin that owns this persisted contribution. Legacy host-owned entries have no owner.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner_plugin_id: Option<String>,
    pub id: String,
    #[serde(default = "default_start_prompt_contribution_enabled")]
    pub enabled: bool,
    pub content: String,
    #[serde(default)]
    pub order: i64,
}

fn default_start_prompt_contribution_enabled() -> bool {
    true
}

pub(crate) fn validate_start_prompt_contribution(
    contribution: &StartPromptContribution,
) -> Result<(), String> {
    if contribution.id.trim().is_empty() {
        return Err("start prompt contribution requires id".to_string());
    }
    if contribution.content.chars().count() > MAX_START_PROMPT_CONTRIBUTION_LENGTH {
        return Err(format!(
            "start prompt contribution content exceeds {MAX_START_PROMPT_CONTRIBUTION_LENGTH} characters"
        ));
    }
    Ok(())
}

pub(crate) fn parse_start_prompt_contribution_order(
    value: Option<&serde_json::Value>,
) -> Result<i64, String> {
    match value {
        None | Some(serde_json::Value::Null) => Ok(0),
        Some(value) => value.as_i64().ok_or_else(|| {
            "start prompt contribution order must be an integer within i64 range".to_string()
        }),
    }
}

pub(crate) fn upsert_start_prompt_contribution(
    database: &db::Database,
    project_id: &str,
    contribution: StartPromptContribution,
) -> Result<Vec<StartPromptContribution>, String> {
    validate_start_prompt_contribution(&contribution)?;
    database
        .update_project_config(
            project_id,
            START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
            |stored| {
                let mut contributions = stored
                    .and_then(|value| {
                        serde_json::from_str::<Vec<StartPromptContribution>>(value).ok()
                    })
                    .unwrap_or_default();
                contributions.retain(|existing| {
                    existing.id != contribution.id
                        || (existing.owner_plugin_id.is_some()
                            && existing.owner_plugin_id != contribution.owner_plugin_id)
                });
                contributions.push(contribution);
                contributions.sort_by(|left, right| {
                    left.order
                        .cmp(&right.order)
                        .then_with(|| left.id.cmp(&right.id))
                        .then_with(|| left.owner_plugin_id.cmp(&right.owner_plugin_id))
                });
                let serialized = serde_json::to_string(&contributions)
                    .map_err(|error| rusqlite::Error::ToSqlConversionFailure(Box::new(error)))?;
                Ok((serialized, contributions))
            },
        )
        .map_err(|error| format!("failed to update start prompt contributions: {error}"))
}

fn render_start_prompt_contribution(content: &str, task: &db::TaskRow) -> String {
    content
        .replace("{{taskId}}", &task.id)
        .replace("{{task_id}}", &task.id)
}

fn append_start_prompt_contributions(
    prompt: &mut String,
    task: &db::TaskRow,
    start_prompt_contributions: &[StartPromptContribution],
) {
    let mut contributions: Vec<&StartPromptContribution> = start_prompt_contributions
        .iter()
        .filter(|contribution| contribution.enabled)
        .filter(|contribution| !contribution.content.trim().is_empty())
        .collect();
    contributions.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.id.cmp(&b.id)));

    for contribution in contributions {
        prompt.push_str(&format!(
            "<openforge_start_prompt_contribution id=\"{}\">\n",
            contribution.id
        ));
        prompt.push_str(&render_start_prompt_contribution(
            &contribution.content,
            task,
        ));
        if !prompt.ends_with('\n') {
            prompt.push('\n');
        }
        prompt.push_str("</openforge_start_prompt_contribution>\n\n");
    }
}

fn split_leading_pi_skill_invocation(prompt: &str) -> Option<(&str, &str)> {
    let after_prefix = prompt.strip_prefix("/skill:")?;
    let skill_name_len = after_prefix
        .find(char::is_whitespace)
        .unwrap_or(after_prefix.len());
    if skill_name_len == 0 {
        return None;
    }

    let invocation_end = "/skill:".len() + skill_name_len;
    let (invocation, remainder) = prompt.split_at(invocation_end);
    Some((invocation, remainder.trim_start()))
}

fn append_code_cleanup_instructions(prompt: &mut String, task_id: &str) {
    prompt.push_str(&format!(r#"<openforge_code_cleanup>
As you work on this task, watch for code that doesn't meet project standards or that should be split into separate concerns. When you encounter such code — whether in files you're modifying or adjacent code you're reading — create a new task for it using the OpenForge CLI or the equivalent task-creation mechanism available in your environment.

Create a task when you find:
- Code that violates the project's established patterns or conventions
- Functions or modules that are doing too many things and should be split up
- Duplicated logic that should be extracted into a shared utility
- Missing or inadequate error handling that deserves its own fix
- Technical debt like TODO/FIXME/HACK comments that represent real work
- Dead code, unused imports, or stale abstractions that should be cleaned up

How to create a cleanup task:
- Run: openforge task create --initial-prompt "..." --worktree "$PWD" --depends-on "{task_id}" --label cleanup
- Write a clear, actionable prompt (e.g. "Extract shared validation logic from UserForm and AdminForm")
- Add useful --label values when the category is obvious (for example, cleanup, bug, docs, or tests); do not invent noisy labels just because labels exist
- Keep the --depends-on link to "{task_id}" for cleanup tasks that are related to this work, and add additional prerequisite links when the order is known
- Do NOT fix these issues yourself — just log them as tasks and stay focused on your current task

Only create tasks for genuine issues worth addressing. Do not create tasks for minor style preferences or trivial nitpicks.
</openforge_code_cleanup>

"#));
}

pub fn build_task_prompt(
    task: &db::TaskRow,
    additional_instructions: Option<&str>,
    code_cleanup_enabled: bool,
    start_prompt_contributions: &[StartPromptContribution],
    prompt_prefix: Option<&str>,
) -> String {
    let task_prompt = task.prompt.as_deref().unwrap_or(&task.initial_prompt);
    let (skill_invocation, task_prompt) = split_leading_pi_skill_invocation(task_prompt)
        .map_or((None, task_prompt), |(invocation, remainder)| {
            (Some(invocation), remainder)
        });
    let mut prompt = String::new();
    if let Some(invocation) = skill_invocation {
        prompt.push_str(invocation);
        // Pi finds the command name at the first ASCII space, then treats the
        // complete generated prompt as the skill's arguments.
        prompt.push(' ');
    }

    append_start_prompt_contributions(&mut prompt, task, start_prompt_contributions);

    if code_cleanup_enabled {
        append_code_cleanup_instructions(&mut prompt, &task.id);
    }

    if let Some(instructions) = additional_instructions {
        if !instructions.is_empty() {
            prompt.push_str(instructions);
            prompt.push_str("\n\n");
        }
    }

    // A one-off prefix chosen at start time. It sits next to the task's own text
    // rather than at the top because it speaks about this ticket, not about how
    // the agent should behave generally. Never persisted to the task.
    if let Some(prefix) = prompt_prefix {
        let trimmed = prefix.trim();
        if !trimmed.is_empty() {
            prompt.push_str(trimmed);
            prompt.push_str("\n\n");
        }
    }

    prompt.push_str(task_prompt);
    prompt.push('\n');

    prompt
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_task(id: &str, initial_prompt: &str, prompt: Option<&str>) -> db::TaskRow {
        db::TaskRow {
            id: id.to_string(),
            initial_prompt: initial_prompt.to_string(),
            status: "backlog".to_string(),
            project_id: None,
            created_at: 0,
            updated_at: 0,
            prompt: prompt.map(|value| value.to_string()),
            agent: None,
            permission_mode: None,
            worktree_source: None,
            worktree_branch: None,
            title: None,
            title_source: None,
            title_generated_at: None,
            source_ticket_url: None,
            depends_on: Vec::new(),
            labels: Vec::new(),
        }
    }

    fn start_prompt_contributions() -> Vec<StartPromptContribution> {
        vec![StartPromptContribution {
            owner_plugin_id: None,
            id: "project-guidance".to_string(),
            enabled: true,
            content: "Project start guidance for {{taskId}}".to_string(),
            order: 0,
        }]
    }

    #[test]
    fn test_build_task_prompt_keeps_leading_pi_skill_command_before_generated_instructions() {
        let task = sample_task(
            "T-122",
            "/skill:manual-skill Complete the release notes",
            None,
        );

        let prompt = build_task_prompt(
            &task,
            Some("Project rules here"),
            true,
            &start_prompt_contributions(),
            Some("Verify this is still relevant before doing it."),
        );

        assert!(
            prompt.starts_with("/skill:manual-skill "),
            "Pi only expands skill commands at the start of the prompt"
        );
        let contribution_at = prompt.find("<openforge_start_prompt_contribution").unwrap();
        let cleanup_at = prompt.find("<openforge_code_cleanup>").unwrap();
        let instructions_at = prompt.find("Project rules here").unwrap();
        let prefix_at = prompt
            .find("Verify this is still relevant before doing it.")
            .unwrap();
        let task_at = prompt.find("Complete the release notes").unwrap();

        assert!(contribution_at < cleanup_at);
        assert!(cleanup_at < instructions_at);
        assert!(instructions_at < prefix_at);
        assert!(prefix_at < task_at);
    }

    #[test]
    fn test_build_task_prompt_includes_configured_contribution_and_task_prompt() {
        let task = sample_task("T-123", "Test Task", None);

        let prompt = build_task_prompt(&task, None, false, &start_prompt_contributions(), None);

        assert!(prompt.contains("<openforge_start_prompt_contribution id=\"project-guidance\">"));
        assert!(prompt.contains("Project start guidance for T-123"));
        assert!(prompt.contains("Test Task"));
    }

    #[test]
    fn test_build_task_prompt_uses_prompt_over_initial_prompt() {
        let task = sample_task(
            "T-456",
            "Initial title",
            Some("Specific implementation prompt"),
        );

        let prompt = build_task_prompt(&task, None, false, &start_prompt_contributions(), None);

        assert!(prompt.contains("Specific implementation prompt"));
        assert!(!prompt.contains("\nInitial title\n"));
    }

    #[test]
    fn test_build_task_prompt_places_prefix_directly_before_task_prompt() {
        let task = sample_task("T-300", "Fix the login redirect", None);

        let prompt = build_task_prompt(
            &task,
            None,
            false,
            &start_prompt_contributions(),
            Some("Verify this is still relevant before doing it."),
        );

        let prefix_at = prompt
            .find("Verify this is still relevant before doing it.")
            .expect("prefix present");
        let task_at = prompt
            .find("Fix the login redirect")
            .expect("task prompt present");
        let contribution_at = prompt
            .find("<openforge_start_prompt_contribution")
            .expect("start contribution present");

        assert!(prefix_at < task_at, "prefix must precede the task prompt");
        assert!(
            contribution_at < prefix_at,
            "start contributions must precede the prefix"
        );
    }

    #[test]
    fn test_build_task_prompt_without_prefix_is_unchanged() {
        let task = sample_task("T-301", "Fix the login redirect", None);

        let without = build_task_prompt(&task, None, false, &start_prompt_contributions(), None);
        let blank = build_task_prompt(
            &task,
            None,
            false,
            &start_prompt_contributions(),
            Some("   \n  "),
        );

        assert_eq!(without, blank, "a blank prefix must not alter the prompt");
        assert!(without.ends_with("Fix the login redirect\n"));
    }

    #[test]
    fn test_build_task_prompt_separates_prefix_from_task_prompt() {
        let task = sample_task("T-302", "Fix the login redirect", None);

        let prompt = build_task_prompt(&task, None, false, &[], Some("Check relevance."));

        assert!(prompt.contains("Check relevance.\n\nFix the login redirect"));
    }

    #[test]
    fn test_build_task_prompt_with_additional_instructions_ordering() {
        let task = sample_task("T-789", "Task Body", Some("Do the work"));

        let prompt = build_task_prompt(
            &task,
            Some("Project rules here"),
            false,
            &start_prompt_contributions(),
            None,
        );

        let contribution_pos = prompt.find("<openforge_start_prompt_contribution").unwrap();
        let instructions_pos = prompt.find("Project rules here").unwrap();
        let task_prompt_pos = prompt.find("Do the work").unwrap();

        assert!(contribution_pos < instructions_pos);
        assert!(instructions_pos < task_prompt_pos);
        assert!(!prompt.contains("External ticket:"));
    }

    #[test]
    fn test_build_task_prompt_without_code_cleanup() {
        let task = sample_task("T-800", "No cleanup", None);

        let prompt = build_task_prompt(&task, None, false, &start_prompt_contributions(), None);

        assert!(!prompt.contains("<openforge_code_cleanup>"));
        assert!(!prompt.contains("openforge_create_task"));
        assert!(!prompt.contains("openforge_update_task"));
    }

    #[test]
    fn test_build_task_prompt_with_code_cleanup_enabled() {
        let task = sample_task("T-801", "With cleanup", None);

        let prompt = build_task_prompt(&task, None, true, &start_prompt_contributions(), None);

        assert!(prompt.contains("<openforge_code_cleanup>"));
        assert!(prompt.contains("</openforge_code_cleanup>"));
        assert!(prompt.contains(
            "openforge task create --initial-prompt \"...\" --worktree \"$PWD\" --depends-on \"T-801\" --label cleanup"
        ));
        assert!(prompt.contains("Add useful --label values"));
        assert!(prompt.contains("Keep the --depends-on link"));
        assert!(!prompt.contains("openforge_create_task"));
        assert!(!prompt.contains("openforge_update_task"));
    }

    #[test]
    fn test_build_task_prompt_code_cleanup_ordering() {
        let task = sample_task("T-802", "Cleanup ordering", None);

        let prompt = build_task_prompt(&task, None, true, &start_prompt_contributions(), None);

        let contribution_pos = prompt.find("<openforge_start_prompt_contribution").unwrap();
        let cleanup_pos = prompt.find("<openforge_code_cleanup>").unwrap();
        let task_prompt_pos = prompt.find("Cleanup ordering").unwrap();

        // Start contributions precede code cleanup, which precedes the task prompt.
        assert!(
            contribution_pos < cleanup_pos,
            "Start contributions should come before code cleanup"
        );
        assert!(
            cleanup_pos < task_prompt_pos,
            "Code cleanup should come before task prompt"
        );
    }
}
