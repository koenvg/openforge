//! Generic, feature-agnostic headless agent generation.
//!
//! Runs the configured AI provider CLI in a non-interactive "print" mode as a
//! plain subprocess (no PTY), feeds it a self-contained prompt on stdin, and
//! returns the captured stdout. This is the reusable core primitive that
//! plugins (e.g. the GitHub PR Walkthrough) call over the host-command bridge
//! to turn a prompt into text/JSON without any feature-specific code in core.
//!
//! Generations are keyed by a caller-supplied `sessionKey` so they can be
//! aborted mid-flight; aborting drops the child future, and `kill_on_drop`
//! terminates the underlying process.

use super::*;
use std::collections::HashMap;
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

/// Hard ceiling on a single generation so a stuck agent process can't hang forever.
const GENERATION_TIMEOUT_SECS: u64 = 240;

/// Repo-aware generations (checkout + exploration + review) need more head-room
/// than the diff-only 240s ceiling.
const REPO_GENERATION_TIMEOUT_SECS: u64 = 600;

/// Which tools the headless agent may use.
pub(super) enum ToolPolicy {
    /// No tool flags — the prompt is fully self-contained (diff-only callers).
    None,
    /// Read/search files + read-only git history; no edits, no general shell.
    ReadAndGitHistory,
}

/// The read + git-history whitelist, passed as a single `--allowedTools` value.
///
/// `Skill` is deliberately absent: the CLI does not gate skill invocation on the
/// allowlist, so guidance text can name a skill without widening this list.
const READ_AND_GIT_HISTORY_TOOLS: &str =
    "Read Grep Glob Bash(git log:*) Bash(git blame:*) Bash(git show:*)";

/// Edit tools hard-disabled for the read-only policy, as a single
/// `--disallowedTools` value. Defense-in-depth on top of the allowlist + `manual`
/// permission mode: even if a config widened permissions, these can't run.
const DISALLOWED_EDIT_TOOLS: &str = "Write Edit";

type GenerationAbortSender = oneshot::Sender<()>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct GenerationRegistrationId(u64);

struct InFlightGeneration {
    registration_id: GenerationRegistrationId,
    abort_sender: GenerationAbortSender,
}

/// Duplicate session keys share one abort group. Each run keeps its own registration so
/// completion only removes that run, while aborting the key cancels every remaining run.
type InFlightGenerations = HashMap<String, Vec<InFlightGeneration>>;

#[derive(Debug, PartialEq, Eq, thiserror::Error)]
enum GenerationRegistryError {
    #[error(
        "agent generation registry was poisoned; all in-flight agent generations were aborted and \
         the registry was reset; retry the request"
    )]
    Poisoned,
}

#[derive(Default)]
struct GenerationRegistry {
    in_flight: Mutex<InFlightGenerations>,
    next_registration_id: AtomicU64,
}

impl GenerationRegistry {
    fn register(
        &self,
        session_key: &str,
        abort_sender: GenerationAbortSender,
    ) -> Result<GenerationRegistrationId, GenerationRegistryError> {
        let registration_id =
            GenerationRegistrationId(self.next_registration_id.fetch_add(1, Ordering::Relaxed));
        self.with_in_flight(|in_flight| {
            in_flight
                .entry(session_key.to_string())
                .or_default()
                .push(InFlightGeneration {
                    registration_id,
                    abort_sender,
                });
            registration_id
        })
    }

    fn remove(
        &self,
        session_key: &str,
        registration_id: GenerationRegistrationId,
    ) -> Result<(), GenerationRegistryError> {
        self.with_in_flight(|in_flight| {
            if let Some(generations) = in_flight.get_mut(session_key) {
                generations.retain(|generation| generation.registration_id != registration_id);
                if generations.is_empty() {
                    in_flight.remove(session_key);
                }
            }
        })
    }

    fn abort(&self, session_key: &str) -> Result<(), GenerationRegistryError> {
        self.with_in_flight(|in_flight| {
            if let Some(generations) = in_flight.remove(session_key) {
                for generation in generations {
                    // The receiver may already be gone if the generation just finished.
                    let _ = generation.abort_sender.send(());
                }
            }
        })
    }

    fn with_in_flight<T>(
        &self,
        operation: impl FnOnce(&mut InFlightGenerations) -> T,
    ) -> Result<T, GenerationRegistryError> {
        match self.in_flight.lock() {
            Ok(mut in_flight) => Ok(operation(&mut in_flight)),
            Err(poisoned) => {
                let mut in_flight = poisoned.into_inner();
                let abort_senders = in_flight
                    .drain()
                    .flat_map(|(_, generations)| generations)
                    .map(|generation| generation.abort_sender)
                    .collect::<Vec<_>>();
                self.in_flight.clear_poison();
                drop(in_flight);

                for abort_sender in abort_senders {
                    let _ = abort_sender.send(());
                }

                Err(GenerationRegistryError::Poisoned)
            }
        }
    }
}

/// In-flight generations, keyed by session key, so `abort_agent_generate` can cancel them.
fn generation_registry() -> &'static GenerationRegistry {
    static REGISTRY: OnceLock<GenerationRegistry> = OnceLock::new();
    REGISTRY.get_or_init(GenerationRegistry::default)
}

/// Ceiling on concurrent repo-aware generations. Each one spawns a throwaway
/// PR-head worktree checkout plus a long-running agent process, so an unbounded
/// number would fan out N worktrees + N agents at once (disk/CPU/rate-limit
/// pressure). Extra callers await a permit instead. Both the walkthrough trigger
/// and the (future) Q&A batches funnel through here, so this is the single
/// system-wide gate. Diff-only `agent_generate` is unaffected — it does no
/// checkout and stays uncapped.
const MAX_CONCURRENT_REPO_GENERATIONS: usize = 2;

fn make_repo_generation_semaphore() -> tokio::sync::Semaphore {
    tokio::sync::Semaphore::new(MAX_CONCURRENT_REPO_GENERATIONS)
}

fn repo_generation_semaphore() -> &'static tokio::sync::Semaphore {
    static SEMAPHORE: OnceLock<tokio::sync::Semaphore> = OnceLock::new();
    SEMAPHORE.get_or_init(make_repo_generation_semaphore)
}

pub(super) async fn handle_app_agent_generate_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "agent_generate" => {
            let session_key = payload_string(&request.payload, "sessionKey")?;
            let prompt = payload_string(&request.payload, "prompt")?;
            let project_id =
                payload_optional_string(&request.payload, "projectId")?.unwrap_or_default();
            let model = payload_optional_string(&request.payload, "model")?;
            let provider = resolve_generation_provider(state, &request.payload, &project_id)?;

            let text = run_headless_generation(
                &provider,
                &prompt,
                model.as_deref(),
                &session_key,
                None,
                &ToolPolicy::None,
                None,
                GENERATION_TIMEOUT_SECS,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(serde_json::json!({ "text": text }))?
        }
        "agent_generate_in_repo" => {
            let session_key = payload_string(&request.payload, "sessionKey")?;
            let prompt = payload_string(&request.payload, "prompt")?;
            let project_id = payload_string(&request.payload, "projectId")?;
            let pr_number = request
                .payload
                .get("prNumber")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| {
                    (
                        StatusCode::BAD_REQUEST,
                        "missing or invalid 'prNumber'".to_string(),
                    )
                })?;
            let head_sha = payload_string(&request.payload, "headSha")?;
            let model = payload_optional_string(&request.payload, "model")?;
            let output_schema = payload_optional_string(&request.payload, "outputSchema")?;
            let provider = resolve_generation_provider(state, &request.payload, &project_id)?;

            // Bound concurrent repo-aware runs system-wide: extra callers wait here
            // for a permit rather than all spawning worktrees + agents at once. Held
            // across checkout + generation + cleanup, released when this scope ends.
            let _permit = repo_generation_semaphore().acquire().await.map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("could not acquire a generation slot: {e}"),
                )
            })?;

            // Resolve the PR's base repo to a local project clone. Scope the DB
            // guard so the lock is released before the long checkout + agent run.
            let repo_path = {
                let db = crate::db::acquire_db(&state.db);
                db.get_project(&project_id)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?
                    .map(|p| std::path::PathBuf::from(p.path))
                    .ok_or_else(|| {
                        (
                            StatusCode::BAD_REQUEST,
                            repo_not_local_project_error(&project_id),
                        )
                    })?
            };

            let worktree_path = temp_pr_worktree_path(&session_key);

            crate::git_worktree::checkout_pr_head(&repo_path, &worktree_path, pr_number, &head_sha)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("{e:?}")))?;

            let run = run_headless_generation(
                &provider,
                &prompt,
                model.as_deref(),
                &session_key,
                Some(&worktree_path),
                &ToolPolicy::ReadAndGitHistory,
                output_schema.as_deref(),
                REPO_GENERATION_TIMEOUT_SECS,
            )
            .await;

            // Guaranteed cleanup: remove the throwaway worktree on success, error, or abort.
            let _ = crate::git_worktree::remove_worktree(&repo_path, &worktree_path).await;

            let text = run.map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(serde_json::json!({ "text": text }))?
        }
        "abort_agent_generate" => {
            let session_key = payload_string(&request.payload, "sessionKey")?;
            generation_registry()
                .abort(&session_key)
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error.to_string()))?;
            json_value(serde_json::json!({ "aborted": true }))?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

fn resolve_generation_provider(
    state: &AppState,
    payload: &serde_json::Value,
    project_id: &str,
) -> AppResult<String> {
    match payload_optional_string(payload, "provider")? {
        Some(provider) if !provider.is_empty() => Ok(provider),
        _ => {
            let db = crate::db::acquire_db(&state.db);
            db.try_resolve_ai_provider(project_id).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("failed to resolve AI provider: {e}"),
                )
            })
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_headless_generation(
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    session_key: &str,
    working_directory: Option<&Path>,
    tool_policy: &ToolPolicy,
    output_schema: Option<&str>,
    timeout_secs: u64,
) -> Result<String, String> {
    // Only the repo-aware policy exposes personal skills; the diff-only path is
    // meant to be self-contained.
    let local_skills = match tool_policy {
        ToolPolicy::ReadAndGitHistory => super::local_skills::local_skills_plugin_dir(),
        ToolPolicy::None => None,
    };
    let (binary_name, args) = headless_command(
        provider,
        model,
        tool_policy,
        output_schema,
        local_skills.as_deref(),
    )?;

    let env = crate::user_environment::user_environment();
    let path = env
        .get("PATH")
        .cloned()
        .unwrap_or_else(crate::user_environment::user_tool_path);
    let binary = crate::user_environment::find_tool_on_path(binary_name, &path)
        .ok_or_else(|| format!("{binary_name} executable was not found on PATH"))?;

    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    let registration_id = generation_registry()
        .register(session_key, abort_tx)
        .map_err(|error| error.to_string())?;

    let result = run_child(
        &binary,
        &args,
        &env,
        prompt,
        working_directory,
        timeout_secs,
        abort_rx,
    )
    .await;

    // Remove only this run's registration. Other runs may share the session key.
    generation_registry()
        .remove(session_key, registration_id)
        .map_err(|error| error.to_string())?;

    // With a schema we run the CLI in `--output-format json`, whose stdout is a
    // *result envelope* — the model's actual answer is the string in `result`.
    // Callers expect the model's text, not the envelope, so unwrap it here (the
    // text-format path returns raw stdout and is unaffected).
    match result {
        Ok(stdout) if output_schema.is_some() => unwrap_json_result_envelope(&stdout),
        other => other,
    }
}

/// The claude CLI's `--output-format json` wraps the model's answer in a result
/// envelope (`{ "type": "result", "result": "<the model text>", ... }`). Callers
/// want the model's text, so extract `result`. A non-`success` envelope surfaces
/// as an error. Anything that isn't a recognizable envelope is returned unchanged
/// so we never mangle raw output from a different CLI/version.
fn unwrap_json_result_envelope(stdout: &str) -> Result<String, String> {
    let envelope: serde_json::Value = match serde_json::from_str(stdout) {
        Ok(value) => value,
        Err(_) => return Ok(stdout.to_string()),
    };
    if envelope.get("type").and_then(|v| v.as_str()) != Some("result") {
        return Ok(stdout.to_string());
    }
    if envelope.get("is_error").and_then(|v| v.as_bool()) == Some(true) {
        let detail = envelope
            .get("result")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown error");
        return Err(format!("agent generation reported an error: {detail}"));
    }
    match envelope.get("result").and_then(|v| v.as_str()) {
        Some(result) => Ok(result.to_string()),
        None => Ok(stdout.to_string()),
    }
}

/// The directory the agent process runs in: an explicit checkout when provided,
/// otherwise the user's home (a neutral dir for self-contained diff-only prompts).
fn resolve_working_dir(explicit: Option<&Path>) -> Option<std::path::PathBuf> {
    match explicit {
        Some(dir) => Some(dir.to_path_buf()),
        None => dirs::home_dir(),
    }
}

/// A throwaway worktree path under the OS temp dir, unique per generation.
fn temp_pr_worktree_path(session_key: &str) -> std::path::PathBuf {
    std::env::temp_dir().join(format!("openforge-pr-review-{session_key}"))
}

fn repo_not_local_project_error(project_id: &str) -> String {
    format!(
        "cannot generate a repo-aware walkthrough: project '{project_id}' has no local project \
         clone. Add this repository as a project to enable the walkthrough."
    )
}

async fn run_child(
    binary: &Path,
    args: &[String],
    env: &HashMap<String, String>,
    prompt: &str,
    working_directory: Option<&Path>,
    timeout_secs: u64,
    abort_rx: oneshot::Receiver<()>,
) -> Result<String, String> {
    let mut command = tokio::process::Command::new(binary);
    command
        .args(args)
        .envs(env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(dir) = resolve_working_dir(working_directory) {
        command.current_dir(dir);
    }

    let mut child = command
        .spawn()
        .map_err(|e| format!("failed to spawn agent process: {e}"))?;

    // Feed the prompt via stdin from a separate task so a full stdout pipe can't deadlock us.
    if let Some(mut stdin) = child.stdin.take() {
        let prompt_bytes = prompt.as_bytes().to_vec();
        tokio::spawn(async move {
            let _ = stdin.write_all(&prompt_bytes).await;
            let _ = stdin.shutdown().await;
        });
    }

    let output_future = child.wait_with_output();
    let selected = tokio::time::timeout(Duration::from_secs(timeout_secs), async move {
        tokio::select! {
            out = output_future => Some(out),
            // Abort: dropping `output_future` drops the child, and `kill_on_drop` terminates it.
            _ = abort_rx => None,
        }
    })
    .await;

    match selected {
        Err(_) => Err(format!("agent generation timed out after {timeout_secs}s")),
        Ok(None) => Err("agent generation was aborted".to_string()),
        Ok(Some(Err(e))) => Err(format!("agent process failed: {e}")),
        Ok(Some(Ok(output))) => {
            if output.status.success() {
                Ok(String::from_utf8_lossy(&output.stdout).into_owned())
            } else {
                let stderr = String::from_utf8_lossy(&output.stderr);
                Err(format!(
                    "agent process exited with status {}: {}",
                    output.status,
                    stderr.trim()
                ))
            }
        }
    }
}

/// Map a provider name to the CLI binary + non-interactive args for a one-shot generation.
///
/// The prompt is delivered on stdin, so it never hits argv length limits.
fn headless_command(
    provider: &str,
    model: Option<&str>,
    tool_policy: &ToolPolicy,
    output_schema: Option<&str>,
    local_skills_plugin: Option<&Path>,
) -> Result<(&'static str, Vec<String>), String> {
    match provider {
        "claude-code" => {
            // `claude --print` reads the prompt from stdin, prints the final result, and exits.
            let mut args = vec!["--print".to_string(), "--output-format".to_string()];
            match output_schema {
                Some(schema) => {
                    args.push("json".to_string());
                    args.push("--json-schema".to_string());
                    args.push(schema.to_string());
                }
                None => args.push("text".to_string()),
            }
            if let Some(model) = model.filter(|m| !m.is_empty()) {
                args.push("--model".to_string());
                args.push(model.to_string());
            }
            if let ToolPolicy::ReadAndGitHistory = tool_policy {
                // Read + git-history only. The grammar here is load-bearing and was
                // verified empirically (see the repo-aware read-only design notes):
                // - `--setting-sources project`: do NOT inherit the user's global
                //   `~/.claude/settings.json` `permissions.allow` (often `Bash(*)`,
                //   `Write`, `Edit`), which would silently defeat the whitelist for
                //   this automated run in the end user's environment.
                // - `--permission-mode manual`: anything not in the allowlist needs
                //   approval, which in headless `--print` mode is a denial.
                //   (`dontAsk` would auto-approve everything and is unsafe here.)
                // - `--disallowedTools`: hard-remove the edit tools regardless.
                // - `--no-session-persistence`: these one-shot runs keep no history.
                args.push("--no-session-persistence".to_string());
                args.push("--setting-sources".to_string());
                args.push("project".to_string());
                args.push("--permission-mode".to_string());
                args.push("manual".to_string());
                args.push("--disallowedTools".to_string());
                args.push(DISALLOWED_EDIT_TOOLS.to_string());
                args.push("--allowedTools".to_string());
                args.push(READ_AND_GIT_HISTORY_TOOLS.to_string());
                // The user's own skills, wrapped as a session-only plugin. This is
                // how guidance text like "follow the /strict-code-review skill"
                // resolves without `--setting-sources user` handing the run the
                // user's global `permissions.allow` (see local_skills.rs).
                if let Some(plugin_dir) = local_skills_plugin {
                    args.push("--plugin-dir".to_string());
                    args.push(plugin_dir.to_string_lossy().to_string());
                }
            }
            Ok(("claude", args))
        }
        other => Err(format!(
            "Headless agent generation is not yet supported for provider '{other}'. \
             Configure the 'claude-code' provider to use this feature."
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn poison_registry(registry: &GenerationRegistry) {
        std::thread::scope(|scope| {
            let handle = scope.spawn(|| {
                let _guard = registry.in_flight.lock().expect("registry lock");
                panic!("poison test registry");
            });
            assert!(handle.join().is_err(), "test thread must poison the mutex");
        });
    }

    #[test]
    fn repo_generation_semaphore_caps_concurrency_at_two() {
        // A fresh semaphore built the same way as the global one hands out exactly
        // two permits; a third concurrent repo-aware run must wait for one to free.
        let sem = make_repo_generation_semaphore();
        let _p1 = sem.try_acquire().expect("first repo generation permit");
        let _p2 = sem.try_acquire().expect("second repo generation permit");
        assert!(
            sem.try_acquire().is_err(),
            "a third concurrent repo generation must be denied a permit"
        );
    }

    #[test]
    fn repo_generation_semaphore_frees_permit_after_drop() {
        let sem = make_repo_generation_semaphore();
        let p1 = sem.try_acquire().expect("first permit");
        let _p2 = sem.try_acquire().expect("second permit");
        assert!(sem.try_acquire().is_err(), "capacity reached");
        drop(p1);
        assert!(
            sem.try_acquire().is_ok(),
            "a permit frees up once an in-flight generation finishes"
        );
    }

    #[test]
    fn temp_pr_worktree_path_is_unique_per_session() {
        let a = temp_pr_worktree_path("sess-a");
        let b = temp_pr_worktree_path("sess-b");
        assert_ne!(a, b);
        assert!(a.starts_with(std::env::temp_dir()));
        assert!(a.to_string_lossy().contains("sess-a"));
    }

    #[test]
    fn repo_not_local_project_error_is_actionable() {
        let err = repo_not_local_project_error("proj-123");
        assert!(err.contains("proj-123"));
        assert!(err.to_lowercase().contains("local project"));
    }

    #[test]
    fn resolve_working_dir_prefers_explicit_over_home() {
        let explicit = std::path::PathBuf::from("/tmp/some-worktree");
        assert_eq!(resolve_working_dir(Some(&explicit)), Some(explicit.clone()));
        // With no explicit dir it falls back to home (present in test env).
        assert_eq!(resolve_working_dir(None), dirs::home_dir());
    }

    #[test]
    fn claude_code_uses_print_mode_and_reads_stdin() {
        let (binary, args) = headless_command("claude-code", None, &ToolPolicy::None, None, None)
            .expect("supported");
        assert_eq!(binary, "claude");
        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        // Prompt is delivered on stdin, so it must not be passed as an argument.
        assert!(!args.iter().any(|a| a.contains("prompt")));
    }

    #[test]
    fn claude_code_forwards_model_when_present() {
        let (_, args) = headless_command(
            "claude-code",
            Some("claude-opus-4-8"),
            &ToolPolicy::None,
            None,
            None,
        )
        .unwrap();
        let idx = args
            .iter()
            .position(|a| a == "--model")
            .expect("model flag present");
        assert_eq!(args[idx + 1], "claude-opus-4-8");
    }

    #[test]
    fn empty_model_is_not_forwarded() {
        let (_, args) =
            headless_command("claude-code", Some(""), &ToolPolicy::None, None, None).unwrap();
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn unsupported_provider_returns_actionable_error() {
        let err = headless_command("opencode", None, &ToolPolicy::None, None, None)
            .expect_err("opencode not supported");
        assert!(err.contains("opencode"));
        assert!(err.contains("claude-code"));
    }

    #[test]
    fn none_policy_adds_no_tool_or_permission_flags() {
        // The existing diff-only caller must be unchanged: no tool/permission flags.
        let (_, args) =
            headless_command("claude-code", None, &ToolPolicy::None, None, None).unwrap();
        assert!(!args.iter().any(|a| a == "--allowedTools"));
        assert!(!args.iter().any(|a| a == "--disallowedTools"));
        assert!(!args.iter().any(|a| a == "--permission-mode"));
        assert!(!args.iter().any(|a| a == "--setting-sources"));
        assert!(!args.iter().any(|a| a == "--no-session-persistence"));
    }

    #[test]
    fn read_and_git_history_policy_whitelists_read_and_git_only() {
        let (_, args) = headless_command(
            "claude-code",
            None,
            &ToolPolicy::ReadAndGitHistory,
            None,
            None,
        )
        .unwrap();
        // Do NOT inherit the user's global permissions.allow (often Bash(*)/Write/
        // Edit) — that would silently defeat the whitelist for this automated run.
        let src_idx = args
            .iter()
            .position(|a| a == "--setting-sources")
            .expect("setting-sources present");
        assert_eq!(args[src_idx + 1], "project");
        // `manual` so a non-allowlisted tool requires approval, which in headless
        // `--print` mode is a denial. (`dontAsk` would auto-approve everything.)
        let mode_idx = args
            .iter()
            .position(|a| a == "--permission-mode")
            .expect("mode present");
        assert_eq!(args[mode_idx + 1], "manual");
        // One-shot review runs must not accumulate session history.
        assert!(args.contains(&"--no-session-persistence".to_string()));
        // Whitelist is a single value listing the allowed tools.
        let allow_idx = args
            .iter()
            .position(|a| a == "--allowedTools")
            .expect("allowlist present");
        let allow = &args[allow_idx + 1];
        assert!(allow.contains("Read"));
        assert!(allow.contains("Grep"));
        assert!(allow.contains("Glob"));
        assert!(allow.contains("Bash(git log:*)"));
        assert!(allow.contains("Bash(git blame:*)"));
        assert!(allow.contains("Bash(git show:*)"));
        // No edit/write/general-bash in the whitelist.
        assert!(!allow.contains("Edit"));
        assert!(!allow.contains("Write"));
        // Belt-and-suspenders: hard-disable the edit tools regardless of mode.
        let deny_idx = args
            .iter()
            .position(|a| a == "--disallowedTools")
            .expect("disallowlist present");
        let deny = &args[deny_idx + 1];
        assert!(deny.contains("Write"));
        assert!(deny.contains("Edit"));
        // With no personal skills to expose, the flag is omitted entirely.
        assert!(!args.iter().any(|a| a == "--plugin-dir"));
    }

    #[test]
    fn read_and_git_history_policy_mounts_personal_skills_as_a_plugin() {
        let plugin = std::path::PathBuf::from("/tmp/openforge-local-skills-1");
        let (_, args) = headless_command(
            "claude-code",
            None,
            &ToolPolicy::ReadAndGitHistory,
            None,
            Some(&plugin),
        )
        .unwrap();

        let idx = args
            .iter()
            .position(|a| a == "--plugin-dir")
            .expect("plugin-dir present");
        assert_eq!(args[idx + 1], "/tmp/openforge-local-skills-1");
        // A session-only plugin must not drag the user's settings in with it:
        // `permissions.allow` there is typically Bash(*)/Write/Edit.
        let src_idx = args
            .iter()
            .position(|a| a == "--setting-sources")
            .expect("setting-sources present");
        assert_eq!(args[src_idx + 1], "project");
    }

    // The PR guidance settings tell users this feature needs the Claude Code
    // provider. That claim is only true while every other provider is rejected
    // here; if one is ever added, the Settings notice has to change with it.
    #[test]
    fn every_provider_except_claude_code_is_rejected() {
        for provider in ["opencode", "codex", "grok", "gemini", "pi", ""] {
            let result =
                headless_command(provider, None, &ToolPolicy::ReadAndGitHistory, None, None);
            let err = result.expect_err("only claude-code is supported");
            assert!(err.contains("claude-code"), "provider {provider}: {err}");
        }
        assert!(headless_command(
            "claude-code",
            None,
            &ToolPolicy::ReadAndGitHistory,
            None,
            None
        )
        .is_ok());
    }

    #[test]
    fn none_policy_never_mounts_personal_skills() {
        let plugin = std::path::PathBuf::from("/tmp/openforge-local-skills-1");
        let (_, args) =
            headless_command("claude-code", None, &ToolPolicy::None, None, Some(&plugin)).unwrap();
        assert!(!args.iter().any(|a| a == "--plugin-dir"));
    }

    #[test]
    fn unwrap_json_result_envelope_extracts_model_text() {
        // Real shape of `claude --print --output-format json --json-schema` stdout:
        // the model's answer is the *string* in `result`, wrapped in a result
        // envelope. Callers want that inner text, not the envelope.
        let envelope = r#"{"type":"result","subtype":"success","is_error":false,"result":"{\"steps\":[{\"id\":\"step-1\",\"title\":\"Hello\"}]}","structured_output":{"steps":[{"id":"step-1","title":"Hello"}]}}"#;
        assert_eq!(
            unwrap_json_result_envelope(envelope).unwrap(),
            r#"{"steps":[{"id":"step-1","title":"Hello"}]}"#,
        );
    }

    #[test]
    fn unwrap_json_result_envelope_passes_through_non_envelope() {
        // Raw schema JSON (not a result envelope) must be returned untouched so we
        // never mangle output from a CLI/version that prints the answer directly.
        let raw = r#"{"steps":[]}"#;
        assert_eq!(unwrap_json_result_envelope(raw).unwrap(), raw);
        // Non-JSON text is returned unchanged too (defensive: keep the raw output).
        assert_eq!(
            unwrap_json_result_envelope("plain text").unwrap(),
            "plain text"
        );
    }

    #[test]
    fn unwrap_json_result_envelope_surfaces_error_envelopes() {
        let envelope =
            r#"{"type":"result","subtype":"error","is_error":true,"result":"rate limit exceeded"}"#;
        let err = unwrap_json_result_envelope(envelope).expect_err("error envelope is an error");
        assert!(err.contains("rate limit exceeded"));
    }

    #[test]
    fn output_schema_switches_to_json_and_passes_schema() {
        let schema = r#"{"type":"object"}"#;
        let (_, args) =
            headless_command("claude-code", None, &ToolPolicy::None, Some(schema), None).unwrap();
        let fmt_idx = args
            .iter()
            .position(|a| a == "--output-format")
            .expect("format flag");
        assert_eq!(args[fmt_idx + 1], "json");
        let schema_idx = args
            .iter()
            .position(|a| a == "--json-schema")
            .expect("schema flag");
        assert_eq!(args[schema_idx + 1], schema);
    }

    #[test]
    fn aborting_duplicate_session_key_aborts_every_generation() {
        let registry = GenerationRegistry::default();
        let barrier = std::sync::Barrier::new(2);
        let (first_tx, mut first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();

        registry
            .register("shared-session", first_tx)
            .expect("first registration");

        std::thread::scope(|scope| {
            let registry = &registry;
            let barrier = &barrier;
            let second_generation = scope.spawn(move || {
                registry
                    .register("shared-session", second_tx)
                    .expect("duplicate registration");
                barrier.wait();
                second_rx.blocking_recv()
            });

            barrier.wait();
            registry.abort("shared-session").expect("abort duplicates");

            assert_eq!(first_rx.try_recv(), Ok(()));
            assert_eq!(
                second_generation.join().expect("second generation thread"),
                Ok(())
            );
        });
    }

    #[test]
    fn cleanup_only_removes_the_registration_owned_by_that_generation() {
        let registry = GenerationRegistry::default();
        let barrier = std::sync::Barrier::new(2);
        let (first_tx, _first_rx) = oneshot::channel();
        let (second_tx, second_rx) = oneshot::channel();

        let first_registration = registry
            .register("shared-session", first_tx)
            .expect("first registration");

        std::thread::scope(|scope| {
            let registry = &registry;
            let barrier = &barrier;
            let second_generation = scope.spawn(move || {
                registry
                    .register("shared-session", second_tx)
                    .expect("duplicate registration");
                barrier.wait();
                second_rx.blocking_recv()
            });

            barrier.wait();
            registry
                .remove("shared-session", first_registration)
                .expect("first generation cleanup");
            registry
                .abort("shared-session")
                .expect("abort remaining generation");

            assert_eq!(
                second_generation.join().expect("second generation thread"),
                Ok(())
            );
        });
    }

    #[test]
    fn poisoned_registry_aborts_all_generations_and_recovers() {
        let registry = GenerationRegistry::default();
        let (abort_tx, mut abort_rx) = oneshot::channel();
        registry
            .register("active-session", abort_tx)
            .expect("initial registration");

        poison_registry(&registry);

        let error = registry
            .abort("active-session")
            .expect_err("poisoned abort must report the recovery");

        assert_eq!(error, GenerationRegistryError::Poisoned);
        let error_message = error.to_string();
        assert!(error_message.contains("all in-flight agent generations were aborted"));
        assert!(error_message.contains("retry"));
        assert_eq!(
            abort_rx.try_recv(),
            Ok(()),
            "poison recovery must fail closed by aborting tracked generations"
        );

        let (replacement_tx, _replacement_rx) = oneshot::channel();
        registry
            .register("replacement-session", replacement_tx)
            .expect("the registry must accept operations after recovery");
    }

    #[test]
    fn poisoned_registry_rejects_registration_then_accepts_retry() {
        let registry = GenerationRegistry::default();

        poison_registry(&registry);

        let (rejected_tx, mut rejected_rx) = oneshot::channel();
        let error = registry
            .register("rejected-session", rejected_tx)
            .expect_err("the operation that detects poison must fail");

        assert_eq!(error, GenerationRegistryError::Poisoned);
        assert_eq!(
            rejected_rx.try_recv(),
            Err(oneshot::error::TryRecvError::Closed),
            "a generation rejected during recovery must not retain an abort sender"
        );

        let (retry_tx, _retry_rx) = oneshot::channel();
        registry
            .register("retry-session", retry_tx)
            .expect("a retry must succeed after recovery");
    }

    #[test]
    fn poisoned_registry_cleanup_fails_and_aborts_tracked_generations() {
        let registry = GenerationRegistry::default();
        let (abort_tx, mut abort_rx) = oneshot::channel();
        let registration_id = registry
            .register("completed-session", abort_tx)
            .expect("initial registration");

        poison_registry(&registry);

        let error = registry
            .remove("completed-session", registration_id)
            .expect_err("poisoned cleanup must report the recovery");

        assert_eq!(error, GenerationRegistryError::Poisoned);
        assert_eq!(
            abort_rx.try_recv(),
            Ok(()),
            "cleanup recovery must abort every sender before discarding the registry"
        );
    }
}
