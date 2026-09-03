//! Claude reports its own in-flight background work on the `Stop` hook payload, but only on
//! builds that carry that field; older ones need the same answer reconstructed by replaying
//! the session transcript.
//!
//! The two sources fail in opposite directions. A reported entry counts as outstanding unless
//! it says otherwise, because the inventory is complete by construction. Replayed work has to
//! be confirmed, so an unreadable transcript, a missing process or a failed clock read all
//! keep the plain completion behaviour rather than pinning the session open.

use crate::pty_manager::PtyManager;
use log::warn;
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const MAX_STORED_COMMAND_BYTES: usize = 1024;
const UNIDENTIFIED_TASK: &str = "unidentified";

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PendingBackgroundTask {
    task_id: String,
    kind: String,
    liveness: Liveness,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Liveness {
    RunsCommand(String),
    /// A `Monitor` runs inside Claude rather than as a child process, so there is nothing
    /// to match in the process tree; its own declared timeout is the only bound on how
    /// long it can still fire, and a persistent one declares none.
    ExpiresAt(Option<u64>),
}

impl PendingBackgroundTask {
    pub(crate) fn expires_at_ms(&self) -> Option<u64> {
        match self.liveness {
            Liveness::ExpiresAt(expires_at_ms) => expires_at_ms,
            Liveness::RunsCommand(_) => None,
        }
    }
}

fn pending_background_tasks<I>(lines: I) -> Vec<PendingBackgroundTask>
where
    I: IntoIterator,
    I::Item: AsRef<str>,
{
    let mut tool_uses_by_id: HashMap<String, (String, Option<String>)> = HashMap::new();
    let mut started: Vec<PendingBackgroundTask> = Vec::new();
    let mut started_ids: HashSet<String> = HashSet::new();
    let mut terminated: HashSet<String> = HashSet::new();

    for line in lines {
        let line = line.as_ref().trim();
        if line.is_empty() {
            continue;
        }

        if line.contains("task-notification") {
            collect_terminated_task_ids(line, &mut terminated);
        }

        if !line.contains("tool_use") {
            continue;
        }

        let Ok(entry) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };

        for block in message_content(&entry) {
            if block.get("type").and_then(serde_json::Value::as_str) != Some("tool_use") {
                continue;
            }
            let Some(tool_use_id) = block.get("id").and_then(serde_json::Value::as_str) else {
                continue;
            };
            let tool_name = block
                .get("name")
                .and_then(serde_json::Value::as_str)
                .unwrap_or_default();

            if tool_name == "TaskStop" {
                if let Some(task_id) = block
                    .pointer("/input/task_id")
                    .and_then(serde_json::Value::as_str)
                {
                    terminated.insert(task_id.to_string());
                }
                continue;
            }

            tool_uses_by_id.insert(
                tool_use_id.to_string(),
                (
                    tool_name.to_string(),
                    block
                        .pointer("/input/command")
                        .and_then(serde_json::Value::as_str)
                        .and_then(stored_command),
                ),
            );
        }

        let Some(result) = entry
            .get("toolUseResult")
            .and_then(serde_json::Value::as_object)
        else {
            continue;
        };
        let Some(tool_use_id) = tool_result_tool_use_id(&entry) else {
            continue;
        };
        let Some((tool_name, command)) = tool_uses_by_id.remove(tool_use_id) else {
            continue;
        };
        let task_id_field = match tool_name.as_str() {
            "Monitor" => "taskId",
            "Agent" => "agentId",
            _ => "backgroundTaskId",
        };
        let Some(task_id) = result
            .get(task_id_field)
            .and_then(serde_json::Value::as_str)
            .filter(|task_id| !task_id.is_empty())
        else {
            continue;
        };

        let liveness = match tool_name.as_str() {
            "Monitor" => Liveness::ExpiresAt(declared_expiry(&entry, result)),
            "Agent" => {
                if result.get("isAsync").and_then(serde_json::Value::as_bool) != Some(true) {
                    continue;
                }
                Liveness::ExpiresAt(None)
            }
            _ => match command {
                Some(command) => Liveness::RunsCommand(command),
                None => continue,
            },
        };

        if started_ids.insert(task_id.to_string()) {
            started.push(PendingBackgroundTask {
                task_id: task_id.to_string(),
                kind: tool_name,
                liveness,
            });
        }
    }

    started.retain(|task| !terminated.contains(&task.task_id));
    started
}

fn message_content(entry: &serde_json::Value) -> impl Iterator<Item = &serde_json::Value> {
    entry
        .pointer("/message/content")
        .and_then(serde_json::Value::as_array)
        .map(|blocks| blocks.iter())
        .unwrap_or_default()
}

fn tool_result_tool_use_id(entry: &serde_json::Value) -> Option<&str> {
    message_content(entry)
        .find(|block| block.get("type").and_then(serde_json::Value::as_str) == Some("tool_result"))
        .and_then(|block| block.get("tool_use_id"))
        .and_then(serde_json::Value::as_str)
}

fn declared_expiry(
    entry: &serde_json::Value,
    result: &serde_json::Map<String, serde_json::Value>,
) -> Option<u64> {
    if result
        .get("persistent")
        .and_then(serde_json::Value::as_bool)
        == Some(true)
    {
        return None;
    }
    let timeout_ms = result
        .get("timeoutMs")
        .and_then(serde_json::Value::as_u64)?;
    let armed_at_ms = entry
        .get("timestamp")
        .and_then(serde_json::Value::as_str)
        .and_then(rfc3339_milliseconds)?;
    Some(armed_at_ms.saturating_add(timeout_ms))
}

fn rfc3339_milliseconds(timestamp: &str) -> Option<u64> {
    chrono::DateTime::parse_from_rfc3339(timestamp)
        .ok()?
        .timestamp_millis()
        .try_into()
        .ok()
}

/// A `Monitor` announces every event it observes through the same notification block it
/// closes with, so only a block carrying a status has actually ended its task.
fn collect_terminated_task_ids(line: &str, terminated: &mut HashSet<String>) {
    const OPEN: &str = "<task-notification>";
    const CLOSE: &str = "</task-notification>";

    let mut rest = line;
    while let Some(open) = rest.find(OPEN) {
        rest = &rest[open + OPEN.len()..];
        let (block, remainder) = match rest.find(CLOSE) {
            Some(close) => (&rest[..close], &rest[close + CLOSE.len()..]),
            None => (rest, ""),
        };
        if let Some(task_id) = tagged_value(block, "task-id") {
            if tagged_value(block, "status").is_some() {
                terminated.insert(task_id.to_string());
            }
        }
        rest = remainder;
    }
}

fn tagged_value<'a>(block: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim()).filter(|value| !value.is_empty())
}

fn live_tasks(
    pending: Vec<PendingBackgroundTask>,
    command_lines: impl FnOnce() -> Result<Vec<String>, String>,
    now_ms: u64,
) -> Vec<PendingBackgroundTask> {
    let live_commands: Vec<String> = if pending
        .iter()
        .any(|task| matches!(task.liveness, Liveness::RunsCommand(_)))
    {
        match command_lines() {
            Ok(lines) => lines.iter().map(|line| collapse_whitespace(line)).collect(),
            Err(error) => {
                warn!("[claude_background_work] could not inspect process tree: {error}");
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };

    pending
        .into_iter()
        .filter(|task| match &task.liveness {
            Liveness::RunsCommand(command) => command_is_running(command, &live_commands),
            Liveness::ExpiresAt(expires_at_ms) => {
                expires_at_ms.is_none_or(|expires_at_ms| now_ms < expires_at_ms)
            }
        })
        .collect()
}

fn command_is_running(command: &str, live_commands: &[String]) -> bool {
    let escaped = single_quote_escaped(command);
    live_commands.iter().any(|line| {
        line.contains(command)
            || escaped
                .as_deref()
                .is_some_and(|escaped| line.contains(escaped))
    })
}

/// Claude Code runs a background command through `eval '<command>'`, which rewrites every
/// single quote inside it, so a quoted command only matches its process in that form.
fn single_quote_escaped(command: &str) -> Option<String> {
    command
        .contains('\'')
        .then(|| command.replace('\'', "'\"'\"'"))
}

fn stored_command(command: &str) -> Option<String> {
    let command = collapse_whitespace(command);
    if command.is_empty() {
        return None;
    }
    let mut end = command.len().min(MAX_STORED_COMMAND_BYTES);
    while end > 0 && !command.is_char_boundary(end) {
        end -= 1;
    }
    Some(command[..end].to_string())
}

/// The process table reports a command as its argv joined by single spaces, so both sides
/// of the match have to be collapsed the same way for a multi-line command to be found.
fn collapse_whitespace(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Claude reports its own in-flight work on the `Stop` payload. Builds that predate that
/// field need the same answer reconstructed from the transcript, which can go stale, so the
/// two are not interchangeable once a deferral is running.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum OutstandingWork {
    Reported(Vec<PendingBackgroundTask>),
    Replayed(Vec<PendingBackgroundTask>),
}

impl OutstandingWork {
    pub(crate) fn tasks(&self) -> &[PendingBackgroundTask] {
        match self {
            Self::Reported(tasks) | Self::Replayed(tasks) => tasks,
        }
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.tasks().is_empty()
    }

    pub(crate) fn source(&self) -> &'static str {
        match self {
            Self::Reported(_) => "the reported inventory",
            Self::Replayed(_) => "the transcript",
        }
    }
}

pub(crate) async fn outstanding_background_work(
    pty_manager: Option<&PtyManager>,
    task_id: &str,
    pty_instance_id: Option<u64>,
    transcript_path: Option<&str>,
    background_tasks: Option<&serde_json::Value>,
) -> OutstandingWork {
    match reported_background_tasks(background_tasks) {
        Some(reported) => OutstandingWork::Reported(reported),
        None => OutstandingWork::Replayed(
            live_pending_background_tasks(pty_manager, task_id, pty_instance_id, transcript_path)
                .await,
        ),
    }
}

/// `None` means the running build reported no inventory. An empty list is a reported
/// inventory, not a missing one, and the caller must not collapse the two.
fn reported_background_tasks(
    background_tasks: Option<&serde_json::Value>,
) -> Option<Vec<PendingBackgroundTask>> {
    let entries = background_tasks?.as_array()?;
    Some(entries.iter().filter_map(reported_pending_task).collect())
}

/// An entry counts as outstanding unless it names itself as work that is not in flight.
/// Nothing else disqualifies it: an entry whose fields cannot be read is still evidence that
/// Claude registered something, and dropping it would complete a live session.
fn reported_pending_task(entry: &serde_json::Value) -> Option<PendingBackgroundTask> {
    /// A teammate stays registered as running while parked between turns, so its entry says
    /// nothing about whether work is in flight.
    const TEAMMATE: &str = "teammate";
    /// Claude filters the inventory to these before emitting it. Re-checking is what stops a
    /// build that drops that filter from silently completing live sessions.
    const IN_FLIGHT: [&str; 2] = ["running", "pending"];

    let kind = reported_field(entry, "type").unwrap_or_default();
    if kind.eq_ignore_ascii_case(TEAMMATE) {
        return None;
    }
    let status = reported_field(entry, "status").unwrap_or_default();
    if !status.is_empty()
        && !IN_FLIGHT
            .iter()
            .any(|in_flight| status.eq_ignore_ascii_case(in_flight))
    {
        return None;
    }

    Some(PendingBackgroundTask {
        task_id: reported_field(entry, "id")
            .unwrap_or(UNIDENTIFIED_TASK)
            .to_string(),
        kind: kind.to_string(),
        liveness: Liveness::ExpiresAt(None),
    })
}

fn reported_field<'a>(entry: &'a serde_json::Value, field: &str) -> Option<&'a str> {
    entry
        .get(field)
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

pub(crate) async fn live_pending_background_tasks(
    pty_manager: Option<&PtyManager>,
    task_id: &str,
    pty_instance_id: Option<u64>,
    transcript_path: Option<&str>,
) -> Vec<PendingBackgroundTask> {
    let Some(transcript_path) = transcript_path.filter(|path| !path.trim().is_empty()) else {
        return Vec::new();
    };
    let transcript_path = PathBuf::from(transcript_path);
    let root_pid = match pty_manager {
        Some(pty_manager) => pty_manager.agent_pty_pid(task_id, pty_instance_id).await,
        None => None,
    };
    let now_ms =
        crate::unix_timestamp::milliseconds(std::time::SystemTime::now()).unwrap_or(u64::MAX);

    let owned_task_id = task_id.to_string();
    match tokio::task::spawn_blocking(move || {
        live_transcript_tasks(&transcript_path, root_pid, now_ms)
    })
    .await
    {
        Ok(tasks) => tasks,
        Err(error) => {
            warn!(
                "[claude_background_work] background work inspection panicked for task {}: {}",
                owned_task_id, error
            );
            Vec::new()
        }
    }
}

fn live_transcript_tasks(
    transcript_path: &Path,
    root_pid: Option<u32>,
    now_ms: u64,
) -> Vec<PendingBackgroundTask> {
    let pending = match read_pending_background_tasks(transcript_path) {
        Ok(pending) => pending,
        Err(error) => {
            warn!(
                "[claude_background_work] could not read transcript {}: {}",
                transcript_path.display(),
                error
            );
            return Vec::new();
        }
    };
    if pending.is_empty() {
        return Vec::new();
    }

    live_tasks(
        pending,
        || match root_pid {
            Some(root_pid) => crate::process_memory::descendant_command_lines(root_pid),
            None => Err("no live agent PTY process for this task".to_string()),
        },
        now_ms,
    )
}

fn read_pending_background_tasks(path: &Path) -> std::io::Result<Vec<PendingBackgroundTask>> {
    let mut lines = BufReader::new(File::open(path)?).lines();
    let readable_lines = std::iter::from_fn(move || loop {
        match lines.next()? {
            Ok(line) => return Some(line),
            Err(_) => continue,
        }
    });
    Ok(pending_background_tasks(readable_lines))
}

pub(crate) fn describe_tasks(tasks: &[PendingBackgroundTask]) -> String {
    tasks
        .iter()
        .map(|task| match task.kind.as_str() {
            "" => task.task_id.clone(),
            kind => format!("{} ({kind})", task.task_id),
        })
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    const HOUR_MS: u64 = 60 * 60 * 1000;
    const ARMED_AT: &str = "2026-08-27T10:00:00.000Z";

    fn assistant_tool_use(tool_use_id: &str, name: &str, input: serde_json::Value) -> String {
        serde_json::json!({
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "tool_use", "id": tool_use_id, "name": name, "input": input}],
            },
        })
        .to_string()
    }

    fn tool_result(tool_use_id: &str, tool_use_result: serde_json::Value) -> String {
        serde_json::json!({
            "type": "user",
            "timestamp": ARMED_AT,
            "message": {
                "role": "user",
                "content": [{"type": "tool_result", "tool_use_id": tool_use_id, "content": "ok"}],
            },
            "toolUseResult": tool_use_result,
        })
        .to_string()
    }

    fn notification(body: &str) -> String {
        serde_json::json!({
            "type": "user",
            "message": {
                "role": "user",
                "content": format!("<task-notification>\n{body}\n</task-notification>"),
            },
        })
        .to_string()
    }

    fn completion_notification(task_id: &str) -> String {
        notification(&format!(
            "<task-id>{task_id}</task-id>\n<status>completed</status>"
        ))
    }

    fn monitor_event_notification(task_id: &str) -> String {
        notification(&format!(
            "<task-id>{task_id}</task-id>\n<summary>Monitor event</summary>\n<event>EXIT=0</event>"
        ))
    }

    fn task_ids(tasks: &[PendingBackgroundTask]) -> Vec<&str> {
        tasks.iter().map(|task| task.task_id.as_str()).collect()
    }

    fn backgrounded_shell(task_id: &str, command: &str) -> PendingBackgroundTask {
        PendingBackgroundTask {
            task_id: task_id.to_string(),
            kind: "Bash".to_string(),
            liveness: Liveness::RunsCommand(stored_command(command).expect("stored command")),
        }
    }

    fn armed_monitor(task_id: &str, expires_at_ms: Option<u64>) -> PendingBackgroundTask {
        PendingBackgroundTask {
            task_id: task_id.to_string(),
            kind: "Monitor".to_string(),
            liveness: Liveness::ExpiresAt(expires_at_ms),
        }
    }

    fn no_processes() -> Result<Vec<String>, String> {
        Ok(Vec::new())
    }

    #[test]
    fn explicitly_backgrounded_bash_is_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "pnpm dev", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), vec!["b1"]);
    }

    #[test]
    fn bash_moved_to_background_by_timeout_is_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "sleep 600"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"backgroundTaskId": "b1", "timedOutAfterMs": 120_000}),
            ),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), vec!["b1"]);
    }

    #[test]
    fn armed_monitor_is_pending_until_its_declared_timeout() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Monitor",
                serde_json::json!({"until": "ci passes"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"taskId": "m1", "timeoutMs": HOUR_MS, "persistent": false}),
            ),
        ];

        let pending = pending_background_tasks(transcript);

        assert_eq!(task_ids(&pending), vec!["m1"]);
        assert_eq!(
            pending[0].liveness,
            Liveness::ExpiresAt(rfc3339_milliseconds("2026-08-27T11:00:00.000Z"))
        );
    }

    #[test]
    fn persistent_monitor_has_no_declared_timeout() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Monitor",
                serde_json::json!({"until": "ci passes"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"taskId": "m1", "timeoutMs": HOUR_MS, "persistent": true}),
            ),
        ];

        assert_eq!(
            pending_background_tasks(transcript)[0].liveness,
            Liveness::ExpiresAt(None)
        );
    }

    #[test]
    fn async_subagent_is_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Agent",
                serde_json::json!({"description": "Correctness review", "subagent_type": "general-purpose"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"agentId": "a939d27", "isAsync": true, "status": "async_launched"}),
            ),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), ["a939d27"]);
    }

    #[test]
    fn synchronous_subagent_is_not_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Agent",
                serde_json::json!({"description": "Correctness review", "subagent_type": "general-purpose"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"agentId": "a939d27", "agentType": "general-purpose", "status": "completed"}),
            ),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn subagent_that_announced_its_stop_is_no_longer_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Agent",
                serde_json::json!({"description": "Correctness review", "subagent_type": "general-purpose"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"agentId": "a939d27", "isAsync": true, "status": "async_launched"}),
            ),
            completion_notification("a939d27"),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn task_id_from_a_non_monitor_tool_is_not_a_background_task() {
        let transcript = [
            assistant_tool_use("toolu_1", "TaskUpdate", serde_json::json!({"task_id": "1"})),
            tool_result("toolu_1", serde_json::json!({"taskId": "1"})),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn task_announced_with_a_status_is_no_longer_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "pnpm test", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
            completion_notification("b1"),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn monitor_event_notification_does_not_end_the_monitor() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Monitor",
                serde_json::json!({"command": "pnpm test"}),
            ),
            tool_result(
                "toolu_1",
                serde_json::json!({"taskId": "m1", "timeoutMs": HOUR_MS, "persistent": true}),
            ),
            monitor_event_notification("m1"),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), vec!["m1"]);
    }

    #[test]
    fn notification_repeated_across_queue_operations_leaves_other_tasks_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "pnpm test", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
            assistant_tool_use(
                "toolu_2",
                "Bash",
                serde_json::json!({"command": "pnpm dev", "run_in_background": true}),
            ),
            tool_result("toolu_2", serde_json::json!({"backgroundTaskId": "b2"})),
            completion_notification("b1"),
            completion_notification("b1"),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), vec!["b2"]);
    }

    #[test]
    fn one_notification_line_carrying_several_blocks_ends_only_the_announced_tasks() {
        let line = serde_json::json!({
            "type": "user",
            "message": {"role": "user", "content":
                "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>\n<task-notification>\n<task-id>b2</task-id>\n<summary>Monitor event</summary>\n</task-notification>"
            },
        })
        .to_string();
        let mut terminated = HashSet::new();

        collect_terminated_task_ids(&line, &mut terminated);

        assert_eq!(terminated, HashSet::from(["b1".to_string()]));
    }

    #[test]
    fn task_stopped_by_the_model_is_no_longer_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "pnpm dev", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
            assistant_tool_use("toolu_2", "TaskStop", serde_json::json!({"task_id": "b1"})),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn foreground_bash_is_not_pending() {
        let transcript = [
            assistant_tool_use("toolu_1", "Bash", serde_json::json!({"command": "ls"})),
            tool_result("toolu_1", serde_json::json!({"stdout": "src\n"})),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn unparseable_and_empty_transcript_lines_are_skipped() {
        let transcript = [
            String::new(),
            "{ not json but mentions tool_use".to_string(),
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "pnpm dev", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
        ];

        assert_eq!(task_ids(&pending_background_tasks(transcript)), vec!["b1"]);
    }

    #[test]
    fn shell_whose_command_still_runs_is_live() {
        let processes = || Ok(vec!["/bin/bash -c pnpm dev --port 3000".to_string()]);

        let live = live_tasks(
            vec![backgrounded_shell("b1", "pnpm dev --port 3000")],
            processes,
            0,
        );

        assert_eq!(task_ids(&live), vec!["b1"]);
    }

    #[test]
    fn quoted_command_matches_its_shell_escaped_process() {
        let command = "tail -f log | sed -u 's/x/y/g'";
        let processes = || {
            Ok(vec![
                "/bin/zsh -c eval 'tail -f log | sed -u '\"'\"'s/x/y/g'\"'\"''".to_string(),
            ])
        };

        let live = live_tasks(vec![backgrounded_shell("b1", command)], processes, 0);

        assert_eq!(task_ids(&live), vec!["b1"]);
    }

    #[test]
    fn multi_line_command_matches_a_space_joined_process_command() {
        let processes = || Ok(vec!["/bin/bash -c set -e cargo build".to_string()]);

        let live = live_tasks(
            vec![backgrounded_shell("b1", "set -e\n  cargo build")],
            processes,
            0,
        );

        assert_eq!(task_ids(&live), vec!["b1"]);
    }

    #[test]
    fn shell_with_no_matching_process_is_dropped() {
        let processes = || Ok(vec!["/bin/bash -c pnpm test".to_string()]);

        let live = live_tasks(vec![backgrounded_shell("b1", "pnpm dev")], processes, 0);

        assert!(live.is_empty());
    }

    #[test]
    fn shell_is_dropped_when_the_process_tree_cannot_be_read() {
        let live = live_tasks(
            vec![backgrounded_shell("b1", "pnpm dev")],
            || Err("no live agent PTY process for this task".to_string()),
            0,
        );

        assert!(live.is_empty());
    }

    #[test]
    fn backgrounded_shell_without_a_usable_command_is_not_pending() {
        let transcript = [
            assistant_tool_use(
                "toolu_1",
                "Bash",
                serde_json::json!({"command": "   ", "run_in_background": true}),
            ),
            tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
        ];

        assert!(pending_background_tasks(transcript).is_empty());
    }

    #[test]
    fn long_command_matches_on_its_stored_prefix() {
        let command = format!("pnpm exec vitest run {}", "a".repeat(4096));
        let processes = || Ok(vec![format!("/bin/bash -c {command}")]);

        let live = live_tasks(vec![backgrounded_shell("b1", &command)], processes, 0);

        assert_eq!(task_ids(&live), vec!["b1"]);
    }

    #[test]
    fn stored_command_truncates_on_a_character_boundary() {
        let command = "é".repeat(MAX_STORED_COMMAND_BYTES);

        let stored = stored_command(&command).expect("stored command");

        assert!(stored.len() <= MAX_STORED_COMMAND_BYTES);
        assert!(command.starts_with(&stored));
    }

    #[test]
    fn monitor_within_its_timeout_is_live_without_any_process() {
        let live = live_tasks(vec![armed_monitor("m1", Some(HOUR_MS))], no_processes, 0);

        assert_eq!(task_ids(&live), vec!["m1"]);
    }

    #[test]
    fn monitor_past_its_timeout_is_dropped() {
        let live = live_tasks(
            vec![armed_monitor("m1", Some(HOUR_MS))],
            no_processes,
            HOUR_MS + 1,
        );

        assert!(live.is_empty());
    }

    #[test]
    fn monitor_without_a_declared_timeout_stays_live() {
        let live = live_tasks(vec![armed_monitor("m1", None)], no_processes, HOUR_MS);

        assert_eq!(task_ids(&live), vec!["m1"]);
    }

    #[test]
    fn transcript_file_is_read_line_by_line() {
        let dir = tempfile::tempdir().expect("temp dir");
        let path = dir.path().join("transcript.jsonl");
        std::fs::write(
            &path,
            format!(
                "{}\n{}\n",
                assistant_tool_use(
                    "toolu_1",
                    "Bash",
                    serde_json::json!({"command": "pnpm dev", "run_in_background": true}),
                ),
                tool_result("toolu_1", serde_json::json!({"backgroundTaskId": "b1"})),
            ),
        )
        .expect("write transcript");

        let pending = read_pending_background_tasks(&path).expect("read transcript");

        assert_eq!(task_ids(&pending), vec!["b1"]);
    }

    #[test]
    fn missing_transcript_file_is_an_error() {
        let dir = tempfile::tempdir().expect("temp dir");

        assert!(read_pending_background_tasks(&dir.path().join("missing.jsonl")).is_err());
    }

    #[test]
    fn unreadable_transcript_yields_no_pending_tasks() {
        let dir = tempfile::tempdir().expect("temp dir");

        assert!(live_transcript_tasks(&dir.path().join("missing.jsonl"), None, 0).is_empty());
    }

    #[test]
    fn describe_tasks_names_every_deferring_task() {
        let described = describe_tasks(&[
            backgrounded_shell("b1", "pnpm dev"),
            armed_monitor("m1", None),
        ]);

        assert_eq!(described, "b1 (Bash), m1 (Monitor)");
    }

    fn reported(entries: serde_json::Value) -> Vec<PendingBackgroundTask> {
        reported_background_tasks(Some(&entries)).expect("an array is a reported inventory")
    }

    #[test]
    fn an_entry_reported_as_running_counts_as_outstanding() {
        let inventory = serde_json::json!([
            {"id": "a939d27", "type": "subagent", "status": "running", "description": "Correctness review"}
        ]);

        assert_eq!(task_ids(&reported(inventory)), ["a939d27"]);
    }

    #[test]
    fn an_entry_reported_as_pending_counts_as_outstanding() {
        let inventory = serde_json::json!([
            {"id": "b1", "type": "shell", "status": "pending", "description": "Run the suite"}
        ]);

        assert_eq!(task_ids(&reported(inventory)), ["b1"]);
    }

    #[test]
    fn an_entry_of_an_unrecognised_kind_counts_as_outstanding() {
        let inventory = serde_json::json!([
            {"id": "d1", "type": "dream", "status": "running", "description": "Dreaming"}
        ]);

        assert_eq!(task_ids(&reported(inventory)), ["d1"]);
    }

    #[test]
    fn an_entry_that_omits_its_kind_or_status_counts_as_outstanding() {
        assert_eq!(
            task_ids(&reported(serde_json::json!([{"id": "x1"}]))),
            ["x1"]
        );
        assert_eq!(
            task_ids(&reported(
                serde_json::json!([{"id": "x2", "type": "subagent"}])
            )),
            ["x2"]
        );
        assert_eq!(
            task_ids(&reported(
                serde_json::json!([{"id": "x3", "status": "running"}])
            )),
            ["x3"]
        );
    }

    #[test]
    fn an_entry_reported_as_finished_does_not_count_as_outstanding() {
        let inventory = serde_json::json!([
            {"id": "a939d27", "type": "subagent", "status": "completed", "description": "Correctness review"}
        ]);

        assert!(reported(inventory).is_empty());
    }

    #[test]
    fn a_reported_teammate_does_not_count_as_outstanding() {
        let inventory = serde_json::json!([
            {"id": "arev-4f2a", "type": "teammate", "status": "running", "description": "rev"}
        ]);

        assert!(reported(inventory).is_empty());
    }

    #[test]
    fn a_reported_teammate_does_not_hide_other_running_work() {
        let inventory = serde_json::json!([
            {"id": "arev-4f2a", "type": "teammate", "status": "running"},
            {"id": "a939d27", "type": "subagent", "status": "running"}
        ]);

        assert_eq!(task_ids(&reported(inventory)), ["a939d27"]);
    }

    #[test]
    fn concurrent_subagents_are_outstanding_until_the_last_one_stops() {
        let inventory = serde_json::json!([
            {"id": "a1", "type": "subagent", "status": "completed"},
            {"id": "a2", "type": "subagent", "status": "running"}
        ]);

        assert_eq!(task_ids(&reported(inventory)), ["a2"]);
    }

    #[test]
    fn an_unreadable_entry_still_counts_as_outstanding() {
        let inventory = serde_json::json!([
            "not an object",
            {"type": "subagent", "status": "running"},
            {"taskId": "renamed", "kind": "subagent", "state": "running"}
        ]);

        assert_eq!(
            describe_tasks(&reported(inventory)),
            "unidentified, unidentified (subagent), unidentified"
        );
    }

    #[test]
    fn an_empty_reported_inventory_is_still_an_inventory() {
        assert_eq!(
            reported_background_tasks(Some(&serde_json::json!([]))),
            Some(Vec::new())
        );
    }

    #[test]
    fn an_absent_inventory_is_not_an_empty_one() {
        assert_eq!(reported_background_tasks(None), None);
    }

    #[test]
    fn an_inventory_that_is_not_a_list_reads_as_absent() {
        assert_eq!(
            reported_background_tasks(Some(&serde_json::json!("all done"))),
            None
        );
    }
}
