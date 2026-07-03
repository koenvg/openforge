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
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::sync::oneshot;

/// Hard ceiling on a single generation so a stuck agent process can't hang forever.
const GENERATION_TIMEOUT_SECS: u64 = 240;

/// In-flight generations, keyed by session key, so `abort_agent_generate` can cancel them.
fn generation_registry() -> &'static Mutex<HashMap<String, oneshot::Sender<()>>> {
    static REGISTRY: OnceLock<Mutex<HashMap<String, oneshot::Sender<()>>>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
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
            let provider = match payload_optional_string(&request.payload, "provider")? {
                Some(p) if !p.is_empty() => p,
                _ => {
                    let db = crate::db::acquire_db(&state.db);
                    db.resolve_ai_provider(&project_id)
                }
            };

            let text = run_headless_generation(&provider, &prompt, model.as_deref(), &session_key)
                .await
                .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(serde_json::json!({ "text": text }))?
        }
        "abort_agent_generate" => {
            let session_key = payload_string(&request.payload, "sessionKey")?;
            abort_generation(&session_key);
            json_value(serde_json::json!({ "aborted": true }))?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

fn abort_generation(session_key: &str) {
    if let Some(tx) = generation_registry().lock().unwrap().remove(session_key) {
        // Receiver may already be gone if the generation just finished; ignore.
        let _ = tx.send(());
    }
}

async fn run_headless_generation(
    provider: &str,
    prompt: &str,
    model: Option<&str>,
    session_key: &str,
) -> Result<String, String> {
    let (binary_name, args) = headless_command(provider, model)?;

    let env = crate::user_environment::user_environment();
    let path = env
        .get("PATH")
        .cloned()
        .unwrap_or_else(crate::user_environment::user_tool_path);
    let binary = crate::user_environment::find_tool_on_path(binary_name, &path)
        .ok_or_else(|| format!("{binary_name} executable was not found on PATH"))?;

    let (abort_tx, abort_rx) = oneshot::channel::<()>();
    generation_registry()
        .lock()
        .unwrap()
        .insert(session_key.to_string(), abort_tx);

    let result = run_child(&binary, &args, &env, prompt, abort_rx).await;

    // Always drop the registry entry so a finished generation can't be "aborted" later.
    generation_registry().lock().unwrap().remove(session_key);
    result
}

async fn run_child(
    binary: &Path,
    args: &[String],
    env: &HashMap<String, String>,
    prompt: &str,
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
    // The prompt is fully self-contained, so a neutral working directory is fine.
    if let Some(home) = dirs::home_dir() {
        command.current_dir(home);
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
    let selected = tokio::time::timeout(Duration::from_secs(GENERATION_TIMEOUT_SECS), async move {
        tokio::select! {
            out = output_future => Some(out),
            // Abort: dropping `output_future` drops the child, and `kill_on_drop` terminates it.
            _ = abort_rx => None,
        }
    })
    .await;

    match selected {
        Err(_) => Err(format!(
            "agent generation timed out after {GENERATION_TIMEOUT_SECS}s"
        )),
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
) -> Result<(&'static str, Vec<String>), String> {
    match provider {
        "claude-code" => {
            // `claude --print` reads the prompt from stdin, prints the final result, and exits.
            let mut args = vec![
                "--print".to_string(),
                "--output-format".to_string(),
                "text".to_string(),
            ];
            if let Some(model) = model.filter(|m| !m.is_empty()) {
                args.push("--model".to_string());
                args.push(model.to_string());
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

    #[test]
    fn claude_code_uses_print_mode_and_reads_stdin() {
        let (binary, args) = headless_command("claude-code", None).expect("claude-code supported");
        assert_eq!(binary, "claude");
        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        // Prompt is delivered on stdin, so it must not be passed as an argument.
        assert!(!args.iter().any(|a| a.contains("prompt")));
    }

    #[test]
    fn claude_code_forwards_model_when_present() {
        let (_, args) = headless_command("claude-code", Some("claude-opus-4-8")).unwrap();
        let idx = args
            .iter()
            .position(|a| a == "--model")
            .expect("model flag present");
        assert_eq!(args[idx + 1], "claude-opus-4-8");
    }

    #[test]
    fn empty_model_is_not_forwarded() {
        let (_, args) = headless_command("claude-code", Some("")).unwrap();
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn unsupported_provider_returns_actionable_error() {
        let err = headless_command("opencode", None).expect_err("opencode not yet supported");
        assert!(err.contains("opencode"));
        assert!(err.contains("claude-code"));
    }
}
