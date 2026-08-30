use crate::db::{self, AgentSessionRow};
use crate::task_prompt::parse_image_reference_definition;
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub use crate::task_start_prompt::{
    build_task_prompt, StartPromptContribution, START_PROMPT_CONTRIBUTIONS_CONFIG_KEY,
};

fn safe_task_prompt_image_path_component(task_id: &str) -> String {
    let safe_id: String = task_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();

    if safe_id.is_empty() {
        "task".to_string()
    } else {
        safe_id
    }
}

pub(crate) fn task_prompt_image_attachment_dir(root_dir: &Path, task_id: &str) -> PathBuf {
    root_dir
        .join("task-image-attachments")
        .join(safe_task_prompt_image_path_component(task_id))
}

fn image_file_extension(mime_type: &str) -> String {
    match mime_type.to_ascii_lowercase().as_str() {
        "image/png" => "png".to_string(),
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/gif" => "gif".to_string(),
        "image/webp" => "webp".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/heic" => "heic".to_string(),
        "image/heif" => "heif".to_string(),
        mime => {
            let subtype = mime
                .strip_prefix("image/")
                .unwrap_or("img")
                .split('+')
                .next()
                .unwrap_or("img");
            let extension: String = subtype
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric())
                .collect();
            if extension.is_empty() {
                "img".to_string()
            } else {
                extension
            }
        }
    }
}

fn markdown_reference_path(path: &Path) -> String {
    let path = path.to_string_lossy();
    if path.chars().any(char::is_whitespace) {
        format!("<{}>", path.replace('>', "%3E"))
    } else {
        path.into_owned()
    }
}

fn materialize_task_prompt_image_reference_line(
    task_id: &str,
    line: &str,
    attachment_dir: &Path,
) -> Result<Option<String>, String> {
    let Some(reference) = parse_image_reference_definition(line) else {
        return Ok(None);
    };

    let bytes = general_purpose::STANDARD
        .decode(reference.base64_payload)
        .map_err(|e| format!("failed to decode pasted image {}: {e}", reference.marker))?;
    std::fs::create_dir_all(attachment_dir).map_err(|e| {
        format!("failed to create image attachment directory for task {task_id}: {e}")
    })?;

    let image_path = attachment_dir.join(format!(
        "image-{}.{}",
        reference.image_number,
        image_file_extension(reference.mime_type)
    ));
    std::fs::write(&image_path, bytes)
        .map_err(|e| format!("failed to write pasted image {}: {e}", reference.marker))?;
    Ok(Some(format!(
        "{}: {}",
        reference.marker,
        markdown_reference_path(&image_path)
    )))
}

pub(crate) fn materialize_task_prompt_images(
    task_id: &str,
    prompt: &str,
    attachment_dir: &Path,
) -> Result<String, String> {
    if !prompt.contains("data:image/") {
        return Ok(prompt.to_string());
    }

    let mut materialized_lines = Vec::new();
    for line in prompt.lines() {
        match materialize_task_prompt_image_reference_line(task_id, line, attachment_dir)? {
            Some(materialized_line) => materialized_lines.push(materialized_line),
            None => materialized_lines.push(line.to_string()),
        }
    }

    let mut materialized = materialized_lines.join("\n");
    if prompt.ends_with('\n') {
        materialized.push('\n');
    }
    Ok(materialized)
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AgentLifecycleEventKind {
    Started,
    BecameBusy,
    BecameIdle,
    RequestedPermission,
    Failed,
    Ended,
}

const AGENT_SESSION_STATUS_COMPLETED: &str = "completed";
const AGENT_SESSION_STATUS_FAILED: &str = "failed";
const AGENT_SESSION_STATUS_INTERRUPTED: &str = "interrupted";
pub(crate) const TERMINAL_AGENT_SESSION_STATUSES: [&str; 3] = [
    AGENT_SESSION_STATUS_COMPLETED,
    AGENT_SESSION_STATUS_FAILED,
    AGENT_SESSION_STATUS_INTERRUPTED,
];

/// Provider-agnostic lifecycle notification sent by installed agent adapters.
///
/// This is the seam between provider plugins/extensions/hooks and OpenForge's
/// session state. Provider adapters translate native event names into
/// `kind`, while raw fields are retained only for debugging.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AgentLifecycleNotification {
    pub provider: String,
    pub task_id: String,
    #[serde(default)]
    pub pty_instance_id: Option<u64>,
    #[serde(default)]
    pub provider_session_id: Option<String>,
    pub kind: AgentLifecycleEventKind,
    #[serde(default)]
    pub raw_event_type: Option<String>,
    #[serde(default)]
    pub raw_status_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentLifecycleStatusChange {
    pub task_id: String,
    pub status: String,
    pub provider: String,
    pub kind: AgentLifecycleEventKind,
    pub pty_instance_id: Option<u64>,
    pub raw_event_type: Option<String>,
    pub raw_status_type: Option<String>,
}

pub fn session_matches_pty_instance(session: &AgentSessionRow, pty_instance_id: u64) -> bool {
    session.pty_instance_id == Some(pty_instance_id)
}

pub fn provider_requires_pty_instance(provider: &str) -> bool {
    matches!(
        provider,
        "claude-code" | "pi" | "opencode" | "codex" | "grok"
    )
}

pub(crate) fn lifecycle_status_transition(
    kind: AgentLifecycleEventKind,
) -> (&'static str, &'static [&'static str]) {
    match kind {
        AgentLifecycleEventKind::Started | AgentLifecycleEventKind::BecameBusy => (
            "running",
            &[
                "started",
                AGENT_SESSION_STATUS_COMPLETED,
                "paused",
                AGENT_SESSION_STATUS_FAILED,
                AGENT_SESSION_STATUS_INTERRUPTED,
                "running",
            ],
        ),
        AgentLifecycleEventKind::BecameIdle | AgentLifecycleEventKind::Ended => (
            AGENT_SESSION_STATUS_COMPLETED,
            &["running", "paused", AGENT_SESSION_STATUS_COMPLETED],
        ),
        AgentLifecycleEventKind::RequestedPermission => ("paused", &["running", "paused"]),
        AgentLifecycleEventKind::Failed => (
            AGENT_SESSION_STATUS_FAILED,
            &["running", "paused", AGENT_SESSION_STATUS_FAILED],
        ),
    }
}

fn provider_session_id_is_persistable(provider: &str, provider_session_id: &str) -> bool {
    provider != "opencode" || provider_session_id.starts_with("ses")
}

fn session_provider_id<'a>(session: &'a AgentSessionRow, provider: &str) -> Option<&'a str> {
    match provider {
        "opencode" => session.opencode_session_id.as_deref(),
        "claude-code" => session.claude_session_id.as_deref(),
        "pi" => session.pi_session_id.as_deref(),
        "grok" => session.grok_session_id.as_deref(),
        _ => None,
    }
}

fn provider_session_id_is_claimed_elsewhere(
    db: &db::Database,
    current_session: &AgentSessionRow,
    provider: &str,
    provider_session_id: &str,
) -> Result<bool, String> {
    if !matches!(provider, "claude-code" | "pi") {
        return Ok(false);
    }

    let sessions = db
        .get_sessions_by_provider(provider)
        .map_err(|e| format!("failed to load provider sessions: {e}"))?;

    for session in sessions {
        if session.id == current_session.id
            || session_provider_id(&session, provider) != Some(provider_session_id)
        {
            continue;
        }

        let claimed_elsewhere = match provider {
            "claude-code" => matches!(session.status.as_str(), "running" | "paused"),
            "pi" => session.ticket_id != current_session.ticket_id,
            _ => false,
        };
        if claimed_elsewhere {
            return Ok(true);
        }
    }

    Ok(false)
}

pub fn apply_agent_lifecycle_notification(
    db: &db::Database,
    notification: &AgentLifecycleNotification,
) -> Result<Option<AgentLifecycleStatusChange>, String> {
    let Some(session) = db
        .get_latest_session_for_ticket(&notification.task_id)
        .map_err(|e| format!("failed to load latest agent session: {e}"))?
    else {
        return Ok(None);
    };

    if session.provider != notification.provider {
        return Ok(None);
    }

    if provider_requires_pty_instance(&notification.provider) {
        let Some(pty_instance_id) = notification.pty_instance_id else {
            return Ok(None);
        };
        if !session_matches_pty_instance(&session, pty_instance_id) {
            return Ok(None);
        }
    }

    if let Some(provider_session_id) = notification
        .provider_session_id
        .as_deref()
        .filter(|id| !id.is_empty())
        .filter(|id| provider_session_id_is_persistable(&notification.provider, id))
    {
        let may_persist = notification.provider != "pi" || session.pi_session_id.is_none();
        if may_persist {
            let claimed_elsewhere = provider_session_id_is_claimed_elsewhere(
                db,
                &session,
                &notification.provider,
                provider_session_id,
            )?;
            if !claimed_elsewhere {
                db.set_agent_session_provider_id(
                    &session.id,
                    &notification.provider,
                    provider_session_id,
                )
                .map_err(|e| format!("failed to persist provider session id: {e}"))?;
            }
        }
    }

    let (target_status, eligible_statuses) = lifecycle_status_transition(notification.kind);

    if !eligible_statuses.is_empty() && !eligible_statuses.contains(&session.status.as_str()) {
        return Ok(None);
    }

    if session.status != target_status {
        db.update_agent_session(
            &session.id,
            &session.stage,
            target_status,
            session.checkpoint_data.as_deref(),
            None,
        )
        .map_err(|e| format!("failed to update agent session status: {e}"))?;
    }

    Ok(Some(AgentLifecycleStatusChange {
        task_id: notification.task_id.clone(),
        status: target_status.to_string(),
        provider: notification.provider.clone(),
        kind: notification.kind,
        pty_instance_id: notification.pty_instance_id,
        raw_event_type: notification.raw_event_type.clone(),
        raw_status_type: notification.raw_status_type.clone(),
    }))
}

pub(crate) fn build_start_response(
    task_id: &str,
    session_id: &str,
    workspace_path: &str,
    port: u16,
) -> serde_json::Value {
    serde_json::json!({
        "task_id": task_id,
        "session_id": session_id,
        "workspace_path": workspace_path,
        "port": port,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn materialize_task_prompt_images_writes_files_and_replaces_data_uri_references() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let prompt =
            "Describe [image#1] inline\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=\n";

        let materialized =
            materialize_task_prompt_images("T-500", prompt, temp_dir.path()).expect("materialize");

        let image_path = temp_dir.path().join("image-1.png");
        assert_eq!(
            std::fs::read(&image_path).expect("materialized image file"),
            b"image-bytes"
        );
        assert!(materialized.contains("Describe [image#1] inline"));
        assert!(materialized.contains("[image#1]: "));
        assert!(materialized.contains(image_path.to_string_lossy().as_ref()));
        assert!(!materialized.contains("data:image/png;base64"));
    }

    #[test]
    fn materialize_task_prompt_images_leaves_noncanonical_references_untouched() {
        let temp_dir = tempfile::tempdir().expect("temp dir");
        let attachment_dir = temp_dir.path().join("attachments");
        let prompt =
            "[image#1]: data:image/png;base64,   \n[image#2]: data:image/svg_xml;base64,YQ==\n";

        let materialized = materialize_task_prompt_images("T-501", prompt, &attachment_dir)
            .expect("ignore noncanonical references");

        assert_eq!(materialized, prompt);
        assert!(!attachment_dir.exists());
    }

    #[test]
    fn opencode_lifecycle_ignores_message_ids_as_provider_session_ids() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("opencode_ignore_message_provider_id");
        insert_test_task(&db);
        db.create_agent_session(
            "session-row",
            "T-100",
            Some("ses_existing"),
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.set_agent_session_pty_instance_id("session-row", 42)
            .expect("store pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: "T-100".to_string(),
                pty_instance_id: Some(42),
                provider_session_id: Some("msg_bad123".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("message.updated".to_string()),
                raw_status_type: None,
            },
        )
        .expect("apply lifecycle notification");

        let session = db
            .get_agent_session("session-row")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.opencode_session_id.as_deref(), Some("ses_existing"));
    }

    #[test]
    fn opencode_lifecycle_accepts_real_session_ids_as_provider_session_ids() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("opencode_accept_real_provider_id");
        insert_test_task(&db);
        db.create_agent_session(
            "session-row",
            "T-100",
            None,
            "implementing",
            "running",
            "opencode",
        )
        .expect("create opencode session");
        db.set_agent_session_pty_instance_id("session-row", 42)
            .expect("store pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: "T-100".to_string(),
                pty_instance_id: Some(42),
                provider_session_id: Some("ses_good123".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("message.updated".to_string()),
                raw_status_type: None,
            },
        )
        .expect("apply lifecycle notification");

        let session = db
            .get_agent_session("session-row")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.opencode_session_id.as_deref(), Some("ses_good123"));
    }

    #[test]
    fn normalized_lifecycle_kind_drives_status_even_with_unknown_raw_debug_fields() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("normalized_lifecycle_ignores_raw_debug");
        let task = db
            .create_task("OpenCode task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-normalized",
            &task.id,
            None,
            "implementing",
            "completed",
            "opencode",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-normalized", 5)
            .expect("store pty instance");

        let change = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "opencode".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(5),
                provider_session_id: Some("ses-5".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("provider.changed.this.name".to_string()),
                raw_status_type: Some("provider-changed-this-status".to_string()),
            },
        )
        .expect("apply lifecycle")
        .expect("status should change");

        assert_eq!(change.status, "running");
        assert_eq!(change.kind, AgentLifecycleEventKind::BecameBusy);
        assert_eq!(change.pty_instance_id, Some(5));
        assert_eq!(
            change.raw_event_type.as_deref(),
            Some("provider.changed.this.name")
        );
        assert_eq!(
            change.raw_status_type.as_deref(),
            Some("provider-changed-this-status")
        );
        let session = db
            .get_agent_session("ses-normalized")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(session.opencode_session_id, Some("ses-5".to_string()));
    }

    #[test]
    fn claude_lifecycle_requires_matching_pty_instance() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("claude_lifecycle_requires_pty_instance");
        let task = db
            .create_task("Claude task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-claude-pty",
            &task.id,
            None,
            "implementing",
            "completed",
            "claude-code",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-claude-pty", 41)
            .expect("store pty instance");

        let stale = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(99),
                provider_session_id: Some("claude-stale".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("stale lifecycle should not error");
        assert!(stale.is_none());

        let missing_identity = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: None,
                provider_session_id: Some("claude-no-pty".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("missing pty identity should not error");
        assert!(missing_identity.is_none());

        let applied = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(41),
                provider_session_id: Some("claude-current".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("current lifecycle should apply")
        .expect("status should change");
        assert_eq!(applied.status, "running");

        let session = db
            .get_agent_session("ses-claude-pty")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(
            session.claude_session_id,
            Some("claude-current".to_string())
        );
    }

    #[test]
    fn codex_lifecycle_requires_matching_pty_instance() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("codex_lifecycle_requires_pty_instance");
        let task = db
            .create_task("Codex task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-codex-pty",
            &task.id,
            None,
            "implementing",
            "completed",
            "codex",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-codex-pty", 51)
            .expect("store pty instance");

        let stale = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "codex".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(99),
                provider_session_id: None,
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("PreToolUse".to_string()),
                raw_status_type: None,
            },
        )
        .expect("stale lifecycle should not error");
        assert!(stale.is_none());

        let missing_identity = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "codex".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: None,
                provider_session_id: None,
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("PreToolUse".to_string()),
                raw_status_type: None,
            },
        )
        .expect("missing pty identity should not error");
        assert!(missing_identity.is_none());

        let applied = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "codex".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(51),
                provider_session_id: None,
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("PreToolUse".to_string()),
                raw_status_type: None,
            },
        )
        .expect("current lifecycle should apply")
        .expect("status should change");
        assert_eq!(applied.status, "running");
        assert_eq!(applied.pty_instance_id, Some(51));

        let session = db
            .get_agent_session("ses-codex-pty")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
    }

    #[test]
    fn claude_lifecycle_keeps_provider_session_ids_task_scoped_for_active_tasks() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("claude_lifecycle_provider_id_unique");
        let first_task = db
            .create_task("First Claude task", "doing", None, None, None)
            .expect("create first task");
        let second_task = db
            .create_task("Second Claude task", "doing", None, None, None)
            .expect("create second task");
        db.create_agent_session(
            "ses-claude-first",
            &first_task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create first session");
        db.set_agent_session_pty_instance_id("ses-claude-first", 101)
            .expect("store first pty instance");
        db.create_agent_session(
            "ses-claude-second",
            &second_task.id,
            None,
            "implementing",
            "running",
            "claude-code",
        )
        .expect("create second session");
        db.set_agent_session_pty_instance_id("ses-claude-second", 202)
            .expect("store second pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: first_task.id.clone(),
                pty_instance_id: Some(101),
                provider_session_id: Some("claude-shared".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("first lifecycle should apply")
        .expect("first status should change");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "claude-code".to_string(),
                task_id: second_task.id.clone(),
                pty_instance_id: Some(202),
                provider_session_id: Some("claude-shared".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("duplicate lifecycle should not error")
        .expect("duplicate lifecycle still updates status");

        let first_session = db
            .get_agent_session("ses-claude-first")
            .expect("get first session")
            .expect("first session exists");
        let second_session = db
            .get_agent_session("ses-claude-second")
            .expect("get second session")
            .expect("second session exists");
        assert_eq!(
            first_session.claude_session_id.as_deref(),
            Some("claude-shared")
        );
        assert_eq!(second_session.claude_session_id, None);
    }

    #[test]
    fn pi_lifecycle_does_not_attach_one_provider_session_to_two_active_tasks() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("pi_lifecycle_provider_id_unique");
        let first_task = db
            .create_task("First Pi task", "done", None, None, None)
            .expect("create first task");
        let second_task = db
            .create_task("Second Pi task", "doing", None, None, None)
            .expect("create second task");
        db.create_agent_session(
            "ses-pi-first",
            &first_task.id,
            None,
            "implementing",
            "completed",
            "pi",
        )
        .expect("create first session");
        db.set_agent_session_pty_instance_id("ses-pi-first", 101)
            .expect("store first pty instance");
        db.set_agent_session_pi_id("ses-pi-first", "pi-shared")
            .expect("store first Pi session id");
        db.create_agent_session(
            "ses-pi-second",
            &second_task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create second session");
        db.set_agent_session_pty_instance_id("ses-pi-second", 202)
            .expect("store second pty instance");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "pi".to_string(),
                task_id: second_task.id.clone(),
                pty_instance_id: Some(202),
                provider_session_id: Some("pi-shared".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("user_prompt".to_string()),
                raw_status_type: None,
            },
        )
        .expect("Pi lifecycle should apply")
        .expect("Pi lifecycle should publish status");

        let first_session = db
            .get_agent_session("ses-pi-first")
            .expect("get first session")
            .expect("first session exists");
        let second_session = db
            .get_agent_session("ses-pi-second")
            .expect("get second session")
            .expect("second session exists");
        assert_eq!(first_session.pi_session_id.as_deref(), Some("pi-shared"));
        assert_eq!(second_session.pi_session_id, None);
    }

    #[test]
    fn pi_lifecycle_does_not_replace_an_existing_provider_session_id() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("pi_lifecycle_preserves_provider_id");
        let task = db
            .create_task("Pi task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-pi-existing",
            &task.id,
            None,
            "implementing",
            "running",
            "pi",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-pi-existing", 303)
            .expect("store pty instance");
        db.set_agent_session_pi_id("ses-pi-existing", "pi-authoritative")
            .expect("store Pi session id");

        apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "pi".to_string(),
                task_id: task.id,
                pty_instance_id: Some(303),
                provider_session_id: Some("pi-mismatched".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("user_prompt".to_string()),
                raw_status_type: None,
            },
        )
        .expect("Pi lifecycle should apply")
        .expect("Pi lifecycle should publish status");

        let session = db
            .get_agent_session("ses-pi-existing")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.pi_session_id.as_deref(), Some("pi-authoritative"));
    }

    #[test]
    fn provider_requires_pty_instance_includes_grok() {
        assert!(provider_requires_pty_instance("grok"));
    }

    #[test]
    fn session_provider_id_returns_grok_session_id() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("session_provider_id_returns_grok_session_id");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-provider-id",
            &task.id,
            None,
            "implementing",
            "running",
            "grok",
        )
        .expect("create session");
        db.set_agent_session_grok_id("ses-grok-provider-id", "grok-abc")
            .expect("store grok session id");

        let session = db
            .get_agent_session("ses-grok-provider-id")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session_provider_id(&session, "grok"), Some("grok-abc"));
    }

    #[test]
    fn grok_lifecycle_requires_matching_pty_instance() {
        use crate::db::test_helpers::*;
        let (db, _temp_dir) = make_test_db("grok_lifecycle_requires_pty_instance");
        let task = db
            .create_task("Grok task", "doing", None, None, None)
            .expect("create task");
        db.create_agent_session(
            "ses-grok-pty",
            &task.id,
            None,
            "implementing",
            "completed",
            "grok",
        )
        .expect("create session");
        db.set_agent_session_pty_instance_id("ses-grok-pty", 61)
            .expect("store pty instance");

        let stale = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "grok".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(99),
                provider_session_id: Some("grok-stale".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("stale lifecycle should not error");
        assert!(stale.is_none());

        let missing_identity = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "grok".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: None,
                provider_session_id: Some("grok-no-pty".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("missing pty identity should not error");
        assert!(missing_identity.is_none());

        let applied = apply_agent_lifecycle_notification(
            &db,
            &AgentLifecycleNotification {
                provider: "grok".to_string(),
                task_id: task.id.clone(),
                pty_instance_id: Some(61),
                provider_session_id: Some("grok-current".to_string()),
                kind: AgentLifecycleEventKind::BecameBusy,
                raw_event_type: Some("pre-tool-use".to_string()),
                raw_status_type: None,
            },
        )
        .expect("current lifecycle should apply")
        .expect("status should change");
        assert_eq!(applied.status, "running");

        let session = db
            .get_agent_session("ses-grok-pty")
            .expect("get session")
            .expect("session exists");
        assert_eq!(session.status, "running");
        assert_eq!(session.grok_session_id, Some("grok-current".to_string()));
    }

    #[test]
    fn test_build_start_response_uses_workspace_path_without_worktree_alias() {
        let response = build_start_response("T-100", "sess-abc", "/path/to/workspace", 3000);

        assert_eq!(response["task_id"], "T-100");
        assert_eq!(response["session_id"], "sess-abc");
        assert_eq!(response["workspace_path"], "/path/to/workspace");
        assert!(response.get("worktree_path").is_none());
        assert_eq!(response["port"], 3000);
    }

    #[test]
    fn test_build_start_response_zero_port() {
        let response = build_start_response("T-200", "sess-def", "/another/path", 0);

        assert_eq!(response["task_id"], "T-200");
        assert_eq!(response["port"], 0);
    }
}
