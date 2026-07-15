# PR Repo-Aware Agent Runtime — Implementation Plan (Plan 1 of 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the headless agent primitive the ability to run *inside a checkout of a PR's head commit* with a read-only + git-history tool policy, so later plans can generate repo-aware walkthroughs, AI reviews, and Q&A.

**Architecture:** Extend the existing `agent_generate` Rust primitive (`src-tauri/src/app_invoke/agent_generate.rs`) with an optional working directory, a tool policy, an optional output JSON schema, and a longer timeout. Add a throwaway **detached** PR-head checkout to `src-tauri/src/git_worktree.rs` (`git fetch origin refs/pull/N/head` + `git worktree add --detach`). Add a new host command `agent_generate_in_repo` that composes *checkout → run agent in that dir → guaranteed cleanup*, and expose it to the github-sync plugin through the host-command bridge.

**Tech Stack:** Rust (tokio async, `git` subprocess), the `claude` CLI in headless `--print` mode, plugin host-command bridge (`src-tauri/src/plugin_host/callbacks.rs`).

## Global Constraints

- Rust sidecar command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`. DB domain files use `impl super::Database`.
- The headless `claude` convention in this repo (mirror it): `--print`, `--output-format {text|json}`, optional `--json-schema <SCHEMA>`, `--no-session-persistence`, `--permission-mode dontAsk`. Prompt delivered on **stdin** (as `agent_generate` already does), never as argv.
- CI runs `cargo fmt --check` — run `cargo fmt` before every commit.
- Rust test filtering from `src-tauri/`: use **one** filter before any `--` test-binary args, e.g. `cargo test <filter>`. Do not pass multiple test names as separate args; run separate `cargo test <filter>` commands for multiple filters.
- New plugin host commands must be registered in `openforge_global_command_to_app_invoke()` **and** routed by the correct `is_*_app_command` predicate in `src-tauri/src/plugin_host/callbacks.rs`, **and** kept in sync with the plugin-host-command contract-lock (see Task 5).
- Never launch the Electron app (`pnpm electron:dev`) — only the user does that. End-to-end agent runs that need the real `claude` CLI are **manual verification** steps for the user, not automated tests.
- This is a fresh worktree: if `node_modules` is absent, run `pnpm install` before any `pnpm`/`tsc` step (only Task 5 needs it).

---

### Task 1: Throwaway detached PR-head checkout in `git_worktree.rs`

**Files:**
- Modify: `src-tauri/src/git_worktree.rs` (add `FetchFailed` variant to `GitWorktreeError` ~lines 17-46; add `checkout_pr_head` + `try_create_detached_worktree_inner`; add tests in the `#[cfg(test)] mod tests` block ~line 1522+)

**Interfaces:**
- Consumes: existing `git_command()` (lines 167-172), `remove_worktree()` (lines 1357-1362), test helpers `init_committed_repo`, `git`, `git_stdout`, `assert_git_success`.
- Produces:
  - `pub async fn checkout_pr_head(repo_path: &Path, worktree_path: &Path, pr_number: i64, head_sha: &str) -> Result<(), GitWorktreeError>` — fetches `refs/pull/{pr_number}/head` from `origin`, then creates a **detached** worktree at `head_sha`.
  - `GitWorktreeError::FetchFailed(String)`.

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/git_worktree.rs`:

```rust
    #[tokio::test]
    async fn checkout_pr_head_fetches_ref_and_creates_detached_worktree() {
        let temp = tempfile::tempdir().expect("tempdir should be created");

        // "origin" plays the role of the GitHub base repo.
        let origin_path = temp.path().join("origin");
        init_committed_repo(&origin_path);
        std::fs::write(origin_path.join("pr_file.txt"), "from the PR\n")
            .expect("pr file should be written");
        assert_git_success(&origin_path, &["add", "pr_file.txt"]);
        assert_git_success(&origin_path, &["commit", "-m", "pr head commit"]);
        let head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        // GitHub exposes the PR head under the base repo as refs/pull/N/head.
        assert_git_success(&origin_path, &["update-ref", "refs/pull/7/head", &head_sha]);
        // Move origin's main back so the PR commit is only reachable via the pull ref.
        assert_git_success(&origin_path, &["reset", "--hard", "HEAD~1"]);

        // Local clone = OpenForge's local project repo.
        let repo_path = temp.path().join("repo");
        assert_git_success(
            temp.path(),
            &["clone", origin_path.to_str().unwrap(), repo_path.to_str().unwrap()],
        );

        let worktree_path = temp.path().join("pr-worktree");
        let result = checkout_pr_head(&repo_path, &worktree_path, 7, &head_sha).await;

        assert!(result.is_ok(), "checkout_pr_head should succeed: {:?}", result.err());
        assert_eq!(git_stdout(&worktree_path, &["rev-parse", "HEAD"]), head_sha);
        // Detached HEAD: symbolic-ref must fail (no branch).
        assert!(
            !git(&worktree_path, &["symbolic-ref", "--quiet", "HEAD"]).status.success(),
            "worktree HEAD should be detached"
        );
        assert!(worktree_path.join("pr_file.txt").exists(), "PR file should be present");
    }

    #[tokio::test]
    async fn checkout_pr_head_worktree_can_be_removed() {
        let temp = tempfile::tempdir().expect("tempdir should be created");
        let origin_path = temp.path().join("origin");
        init_committed_repo(&origin_path);
        let head_sha = git_stdout(&origin_path, &["rev-parse", "HEAD"]);
        assert_git_success(&origin_path, &["update-ref", "refs/pull/1/head", &head_sha]);
        let repo_path = temp.path().join("repo");
        assert_git_success(
            temp.path(),
            &["clone", origin_path.to_str().unwrap(), repo_path.to_str().unwrap()],
        );
        let worktree_path = temp.path().join("pr-worktree");
        checkout_pr_head(&repo_path, &worktree_path, 1, &head_sha)
            .await
            .expect("checkout should succeed");

        remove_worktree(&repo_path, &worktree_path)
            .await
            .expect("removing a detached PR worktree should succeed");
        assert!(!worktree_path.exists(), "worktree dir should be gone after removal");
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test git_worktree::tests::checkout_pr_head` (from `src-tauri/`)
Expected: FAIL — `cannot find function 'checkout_pr_head' in this scope`.

- [ ] **Step 3: Add the `FetchFailed` error variant**

In the `GitWorktreeError` enum (~lines 17-46) add a variant alongside the existing ones:

```rust
    FetchFailed(String),
```

If the enum has a `Display`/`impl std::fmt::Display` (or a `to_string`-style arm), add a matching arm, e.g.:

```rust
            GitWorktreeError::FetchFailed(msg) => write!(f, "git fetch failed: {msg}"),
```

(Match the exact style of the neighbouring arms; if the enum derives error rendering differently, mirror that.)

- [ ] **Step 4: Implement `checkout_pr_head` + `try_create_detached_worktree_inner`**

Add near `try_create_worktree_inner` (~line 1130):

```rust
/// Fetch a PR's head commit from origin and check it out into a throwaway
/// **detached** worktree at `head_sha`. GitHub publishes the PR head under the
/// base repo as `refs/pull/{N}/head`, so this works for fork PRs too, as long as
/// `repo_path`'s origin is the base repo.
pub async fn checkout_pr_head(
    repo_path: &Path,
    worktree_path: &Path,
    pr_number: i64,
    head_sha: &str,
) -> Result<(), GitWorktreeError> {
    let pull_ref = format!("refs/pull/{pr_number}/head");
    let fetch_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("fetch")
        .arg("origin")
        .arg(&pull_ref)
        .output()
        .await?;
    if !fetch_output.status.success() {
        let stderr = String::from_utf8_lossy(&fetch_output.stderr);
        return Err(GitWorktreeError::FetchFailed(format!(
            "could not fetch {pull_ref}: {stderr}"
        )));
    }

    try_create_detached_worktree_inner(repo_path, worktree_path, head_sha).await
}

async fn try_create_detached_worktree_inner(
    repo_path: &Path,
    worktree_path: &Path,
    commit: &str,
) -> Result<(), GitWorktreeError> {
    let add_output = git_command()
        .arg("-C")
        .arg(repo_path)
        .arg("worktree")
        .arg("add")
        .arg("--detach")
        .arg(worktree_path)
        .arg(commit)
        .output()
        .await?;

    if !add_output.status.success() {
        let stderr = String::from_utf8_lossy(&add_output.stderr);
        return Err(GitWorktreeError::WorktreeAddFailed(stderr.to_string()));
    }

    Ok(())
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test git_worktree::tests::checkout_pr_head` (from `src-tauri/`)
Expected: PASS (both `checkout_pr_head_fetches_ref_and_creates_detached_worktree` and `checkout_pr_head_worktree_can_be_removed`).

- [ ] **Step 6: Format and commit**

```bash
cd src-tauri && cargo fmt
cd .. && git add src-tauri/src/git_worktree.rs
git commit -m "Add detached PR-head checkout to git_worktree"
```

---

### Task 2: Tool policy + optional output schema in `headless_command`

**Files:**
- Modify: `src-tauri/src/app_invoke/agent_generate.rs` (`headless_command` ~lines 169-192; its unit tests ~lines 194-230)

**Interfaces:**
- Produces:
  - `pub(super) enum ToolPolicy { None, ReadAndGitHistory }`
  - `headless_command(provider: &str, model: Option<&str>, tool_policy: &ToolPolicy, output_schema: Option<&str>) -> Result<(&'static str, Vec<String>), String>`
- Consumed by: Task 3 (`run_headless_generation`).

**Tool policy meaning:** `ReadAndGitHistory` = read/search files + read-only git history, **no** edits and **no** general shell. Emitted as an `--allowedTools` whitelist plus `--permission-mode dontAsk` (matching this repo's other headless jobs). `None` = today's behavior (no tool flags), for the existing diff-only `agent_generate` caller.

- [ ] **Step 1: Write the failing tests**

Replace/extend the existing tests in `agent_generate.rs` (they currently call `headless_command("claude-code", None)` with the old 2-arg signature — update those call sites too):

```rust
    #[test]
    fn claude_code_uses_print_mode_and_reads_stdin() {
        let (binary, args) =
            headless_command("claude-code", None, &ToolPolicy::None, None).expect("supported");
        assert_eq!(binary, "claude");
        assert!(args.contains(&"--print".to_string()));
        assert!(args.contains(&"--output-format".to_string()));
        assert!(!args.iter().any(|a| a.contains("prompt")));
    }

    #[test]
    fn claude_code_forwards_model_when_present() {
        let (_, args) =
            headless_command("claude-code", Some("claude-opus-4-8"), &ToolPolicy::None, None)
                .unwrap();
        let idx = args.iter().position(|a| a == "--model").expect("model flag present");
        assert_eq!(args[idx + 1], "claude-opus-4-8");
    }

    #[test]
    fn empty_model_is_not_forwarded() {
        let (_, args) =
            headless_command("claude-code", Some(""), &ToolPolicy::None, None).unwrap();
        assert!(!args.iter().any(|a| a == "--model"));
    }

    #[test]
    fn unsupported_provider_returns_actionable_error() {
        let err = headless_command("opencode", None, &ToolPolicy::None, None)
            .expect_err("opencode not supported");
        assert!(err.contains("opencode"));
        assert!(err.contains("claude-code"));
    }

    #[test]
    fn read_and_git_history_policy_whitelists_read_and_git_only() {
        let (_, args) =
            headless_command("claude-code", None, &ToolPolicy::ReadAndGitHistory, None).unwrap();
        // dontAsk so headless never blocks on a permission prompt.
        let mode_idx = args.iter().position(|a| a == "--permission-mode").expect("mode present");
        assert_eq!(args[mode_idx + 1], "dontAsk");
        // Whitelist is a single value listing the allowed tools.
        let allow_idx = args.iter().position(|a| a == "--allowedTools").expect("allowlist present");
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
    }

    #[test]
    fn output_schema_switches_to_json_and_passes_schema() {
        let schema = r#"{"type":"object"}"#;
        let (_, args) =
            headless_command("claude-code", None, &ToolPolicy::None, Some(schema)).unwrap();
        let fmt_idx = args.iter().position(|a| a == "--output-format").expect("format flag");
        assert_eq!(args[fmt_idx + 1], "json");
        let schema_idx = args.iter().position(|a| a == "--json-schema").expect("schema flag");
        assert_eq!(args[schema_idx + 1], schema);
    }
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test agent_generate` (from `src-tauri/`)
Expected: FAIL — signature mismatch / `ToolPolicy` not found.

- [ ] **Step 3: Implement `ToolPolicy` and the new `headless_command`**

Add the enum near the top of the file (after the constants):

```rust
/// Which tools the headless agent may use.
pub(super) enum ToolPolicy {
    /// No tool flags — the prompt is fully self-contained (diff-only callers).
    None,
    /// Read/search files + read-only git history; no edits, no general shell.
    ReadAndGitHistory,
}

/// The read + git-history whitelist, passed as a single `--allowedTools` value.
const READ_AND_GIT_HISTORY_TOOLS: &str =
    "Read Grep Glob Bash(git log:*) Bash(git blame:*) Bash(git show:*)";
```

Replace `headless_command` (lines 169-192) with:

```rust
fn headless_command(
    provider: &str,
    model: Option<&str>,
    tool_policy: &ToolPolicy,
    output_schema: Option<&str>,
) -> Result<(&'static str, Vec<String>), String> {
    match provider {
        "claude-code" => {
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
                args.push("--permission-mode".to_string());
                args.push("dontAsk".to_string());
                args.push("--allowedTools".to_string());
                args.push(READ_AND_GIT_HISTORY_TOOLS.to_string());
            }
            Ok(("claude", args))
        }
        other => Err(format!(
            "Headless agent generation is not yet supported for provider '{other}'. \
             Configure the 'claude-code' provider to use this feature."
        )),
    }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `cargo test agent_generate` (from `src-tauri/`)
Expected: PASS (all six tests).

- [ ] **Step 5: MANUAL verification of the tool policy (user runs this)**

The exact `--allowedTools` grammar can vary by installed `claude` version, so confirm the policy actually restricts before building on it. In any git repo, run:

```bash
printf 'Run `git log --oneline -1`, then read README.md and tell me its first line, then create a file named HACK.txt.' \
  | claude --print --output-format text --permission-mode dontAsk \
    --allowedTools "Read Grep Glob Bash(git log:*) Bash(git blame:*) Bash(git show:*)"
```

Expected: it reports the last commit and the README's first line, but does **not** create `HACK.txt` (`ls HACK.txt` → not found). If the grammar differs (e.g. needs comma-separated or repeated `--allowedTools`), adjust `READ_AND_GIT_HISTORY_TOOLS`/the arg construction and re-run Step 4.

- [ ] **Step 6: Format and commit**

```bash
cd src-tauri && cargo fmt
cd .. && git add src-tauri/src/app_invoke/agent_generate.rs
git commit -m "Add tool policy and output-schema options to headless_command"
```

---

### Task 3: Working directory + configurable timeout in the run path

**Files:**
- Modify: `src-tauri/src/app_invoke/agent_generate.rs` (`run_headless_generation` ~lines 73-100, `run_child` ~lines 102-164, the `agent_generate` handler branch ~lines 36-54, add `resolve_working_dir` helper + a unit test)

**Interfaces:**
- Consumes: `ToolPolicy`, new `headless_command` signature (Task 2).
- Produces:
  - `const REPO_GENERATION_TIMEOUT_SECS: u64 = 600;`
  - `fn resolve_working_dir(explicit: Option<&Path>) -> Option<PathBuf>` — returns `explicit` if `Some`, else `dirs::home_dir()`.
  - `run_headless_generation(provider, prompt, model, session_key, working_directory: Option<&Path>, tool_policy: &ToolPolicy, output_schema: Option<&str>, timeout_secs: u64) -> Result<String, String>`
  - `run_child(binary, args, env, prompt, working_directory: Option<&Path>, timeout_secs: u64, abort_rx) -> Result<String, String>`

- [ ] **Step 1: Write the failing test for `resolve_working_dir`**

Add to the `tests` module in `agent_generate.rs`:

```rust
    #[test]
    fn resolve_working_dir_prefers_explicit_over_home() {
        let explicit = std::path::PathBuf::from("/tmp/some-worktree");
        assert_eq!(resolve_working_dir(Some(&explicit)), Some(explicit.clone()));
        // With no explicit dir it falls back to home (present in test env).
        assert_eq!(resolve_working_dir(None), dirs::home_dir());
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test agent_generate::tests::resolve_working_dir` (from `src-tauri/`)
Expected: FAIL — `cannot find function 'resolve_working_dir'`.

- [ ] **Step 3: Implement `resolve_working_dir`, the timeout constant, and thread the params**

Add the constant near `GENERATION_TIMEOUT_SECS` (line 23):

```rust
/// Repo-aware generations (checkout + exploration + review) need more head-room
/// than the diff-only 240s ceiling.
const REPO_GENERATION_TIMEOUT_SECS: u64 = 600;
```

Add the helper (near `run_child`):

```rust
fn resolve_working_dir(explicit: Option<&Path>) -> Option<std::path::PathBuf> {
    match explicit {
        Some(dir) => Some(dir.to_path_buf()),
        None => dirs::home_dir(),
    }
}
```

Change `run_headless_generation` (lines 73-100) signature and its call to `headless_command`/`run_child`:

```rust
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
    let (binary_name, args) = headless_command(provider, model, tool_policy, output_schema)?;

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

    generation_registry().lock().unwrap().remove(session_key);
    result
}
```

Change `run_child` (lines 102-164) to accept the working dir + timeout, and use `resolve_working_dir` instead of the hard-coded home:

```rust
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
    // ... the rest of the body (stdin feed, timeout select, output handling) is
    // unchanged EXCEPT the timeout uses the parameter:
    // Duration::from_secs(timeout_secs) instead of GENERATION_TIMEOUT_SECS,
    // and the timeout error message uses {timeout_secs}.
```

Update the two timeout references inside `run_child`:
- `tokio::time::timeout(Duration::from_secs(timeout_secs), async move { ... })`
- `Err(_) => Err(format!("agent generation timed out after {timeout_secs}s"))`

Finally, update the existing `agent_generate` handler branch (line 50) to pass the new defaults so behavior is unchanged:

```rust
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
```

- [ ] **Step 4: Run to verify it passes (and nothing regressed)**

Run: `cargo test agent_generate` (from `src-tauri/`)
Expected: PASS — `resolve_working_dir_prefers_explicit_over_home` plus all Task 2 tests.

- [ ] **Step 5: Format and commit**

```bash
cd src-tauri && cargo fmt
cd .. && git add src-tauri/src/app_invoke/agent_generate.rs
git commit -m "Thread working directory and timeout through headless generation"
```

---

### Task 4: `agent_generate_in_repo` command (checkout → run → guaranteed cleanup)

**Files:**
- Modify: `src-tauri/src/app_invoke/agent_generate.rs` (add a new match arm in `handle_app_agent_generate_command` ~lines 35-60; add `temp_pr_worktree_path` helper + resolve-repo helper + a unit test)

**Interfaces:**
- Consumes: `crate::git_worktree::{checkout_pr_head, remove_worktree}`, `run_headless_generation` (Task 3), `crate::db::acquire_db`, `db.get_project(id) -> Result<Option<ProjectRow>>` (`ProjectRow.path: String`).
- Produces: host command `"agent_generate_in_repo"` returning `{ "text": String }`. Payload keys (camelCase from the plugin): `sessionKey`, `prompt`, `projectId`, `owner`, `repo`, `prNumber` (number), `headSha`, optional `model`, optional `provider`, optional `outputSchema`.

- [ ] **Step 1: Write the failing tests for the pure helpers**

Add to the `tests` module:

```rust
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `cargo test agent_generate::tests` (from `src-tauri/`)
Expected: FAIL — helpers not found.

- [ ] **Step 3: Implement the helpers**

```rust
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
```

- [ ] **Step 4: Implement the command arm**

Add a new arm in the `match request.command.as_str()` block of `handle_app_agent_generate_command` (alongside `"agent_generate"` / `"abort_agent_generate"`):

```rust
        "agent_generate_in_repo" => {
            let session_key = payload_string(&request.payload, "sessionKey")?;
            let prompt = payload_string(&request.payload, "prompt")?;
            let project_id = payload_string(&request.payload, "projectId")?;
            let pr_number = request
                .payload
                .get("prNumber")
                .and_then(|v| v.as_i64())
                .ok_or_else(|| {
                    (StatusCode::BAD_REQUEST, "missing or invalid 'prNumber'".to_string())
                })?;
            let head_sha = payload_string(&request.payload, "headSha")?;
            let model = payload_optional_string(&request.payload, "model")?;
            let output_schema = payload_optional_string(&request.payload, "outputSchema")?;
            let provider = match payload_optional_string(&request.payload, "provider")? {
                Some(p) if !p.is_empty() => p,
                _ => {
                    let db = crate::db::acquire_db(&state.db);
                    db.resolve_ai_provider(&project_id)
                }
            };

            let repo_path = {
                let db = crate::db::acquire_db(&state.db);
                db.get_project(&project_id)
                    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, format!("{e}")))?
                    .map(|p| std::path::PathBuf::from(p.path))
                    .ok_or_else(|| {
                        (StatusCode::BAD_REQUEST, repo_not_local_project_error(&project_id))
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
```

- [ ] **Step 5: Run to verify the helper tests pass and it compiles**

Run: `cargo test agent_generate` (from `src-tauri/`)
Expected: PASS (helper tests) and the crate compiles with the new arm.

- [ ] **Step 6: MANUAL end-to-end verification (user runs the app)**

There is no automated test for the full run (needs the real `claude` CLI, a cloned project, and a live PR). After Plan 3 wires the button, the user confirms in-app that generation produces output and that **no** `openforge-pr-review-*` directory is left under the temp dir afterwards (`ls $TMPDIR/openforge-pr-review-* 2>/dev/null` → nothing). Note this as a deferred manual check.

- [ ] **Step 7: Format and commit**

```bash
cd src-tauri && cargo fmt
cd .. && git add src-tauri/src/app_invoke/agent_generate.rs
git commit -m "Add agent_generate_in_repo command with checkout and cleanup"
```

---

### Task 5: Expose `agentGenerateInRepo` to the github-sync plugin

**Files:**
- Modify: `src-tauri/src/plugin_host/callbacks.rs` (mapping `openforge_global_command_to_app_invoke` ~lines 9-46; predicate `is_agent_generate_app_command` ~lines 55-57; its tests)
- Modify: the plugin-host-command contract-lock (find it — see Step 3; likely `src/lib/plugin/pluginHostCommands.ts` and/or a `*.contract`/lock test under `src/` that enumerates allowed host commands)

**Interfaces:**
- Consumes: the `agent_generate_in_repo` command (Task 4).
- Produces: plugins may call `invokeHostCommand('agentGenerateInRepo', {...})`.

- [ ] **Step 1: Write the failing test**

In the `#[cfg(test)]` module of `callbacks.rs`, add (mirroring existing mapping tests):

```rust
    #[test]
    fn agent_generate_in_repo_maps_and_is_authorized() {
        assert_eq!(
            openforge_global_command_to_app_invoke("openforge.agentGenerateInRepo").unwrap(),
            "agent_generate_in_repo"
        );
        assert!(is_agent_generate_app_command("agent_generate_in_repo"));
        assert!(plugin_may_invoke_command(GITHUB_SYNC_PLUGIN_ID, "agent_generate_in_repo"));
    }
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test plugin_host::callbacks` (from `src-tauri/`)
Expected: FAIL — mapping returns the unsupported-command error / predicate is false.

- [ ] **Step 3: Implement the mapping + predicate**

In `openforge_global_command_to_app_invoke` (lines 9-46), add alongside the `agentGenerate` arms:

```rust
        "agentGenerateInRepo" => Ok("agent_generate_in_repo"),
```

In `is_agent_generate_app_command` (lines 55-57):

```rust
fn is_agent_generate_app_command(command: &str) -> bool {
    matches!(
        command,
        "agent_generate" | "abort_agent_generate" | "agent_generate_in_repo"
    )
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cargo test plugin_host::callbacks` (from `src-tauri/`)
Expected: PASS.

- [ ] **Step 5: Update the frontend plugin-host-command contract-lock**

Some host commands are also enumerated on the TS side (contract-lock tests fail otherwise — see the "contract-lock" gates for `pluginHostCommands`). Locate the allowlist and any lock test:

```bash
grep -rn "agentGenerate" src/lib/plugin/ src/**/*.contract* 2>/dev/null
grep -rln "agentGenerate" src/ | grep -iE "contract|lock|hostCommand"
```

Add `agentGenerateInRepo` wherever `agentGenerate` is listed (mirror it exactly). Then run the contract/typecheck gates:

```bash
pnpm install   # only if node_modules is missing in this fresh worktree
pnpm exec vitest run <path-to-pluginHostCommands-contract-test>
pnpm exec tsc --noEmit
```

Expected: contract test PASS; `tsc` shows no *new* errors (note: `tsc` may already fail locally on an `ignoreDeprecations "6.0"` env artifact unrelated to this change — compare against a clean baseline, that specific error is not a blocker).

- [ ] **Step 6: Format and commit**

```bash
cd src-tauri && cargo fmt
cd .. && git add src-tauri/src/plugin_host/callbacks.rs src/
git commit -m "Expose agentGenerateInRepo host command to github-sync plugin"
```

---

## Self-Review

**Spec coverage (Plan 1 slice):**
- Local checkout of PR head, forks included (`refs/pull/N/head`) → Task 1. ✓
- Agent runs in the checkout (working directory) → Tasks 3, 4. ✓
- Tier-2 tools (read + git history, no shell/edits) → Task 2 (+ manual verify Step). ✓
- Longer timeout than 240s → Task 3 (`REPO_GENERATION_TIMEOUT_SECS = 600`). ✓
- Structured output capability (`--json-schema`) for the combined contract → Task 2 (schema plumbed; the schema *content* is Plan 2). ✓
- Guaranteed worktree cleanup (success/error/abort) → Task 4 Step 4. ✓
- E5 "base repo not a local project" actionable error → Task 4 (`repo_not_local_project_error`). ✓
- Host-command exposure to the plugin → Task 5. ✓

**Deferred to later plans (intentionally not in Plan 1):** the combined `{steps, review_comments}` prompt + schema + validation (Plan 2), button lifecycle/trigger relocation (Plan 3), Q&A threads (Plan 4). Plan 1 delivers a cargo-testable runtime the plugin can call.

**Placeholder scan:** none — every code step has concrete code; the only non-automated steps are the two explicitly-labelled MANUAL verifications (tool-policy grammar; full e2e) which require the real `claude` CLI / running app.

**Type consistency:** `ToolPolicy` (Task 2) is used with the same variants in Tasks 3–4; `headless_command`'s 4-arg signature is consistent across Tasks 2–3; `run_headless_generation`'s 8-arg signature is defined in Task 3 and called identically in Task 4; `checkout_pr_head`/`remove_worktree` signatures match Task 1 and their Task 4 call sites; `db.get_project(&project_id)` returns `Result<Option<ProjectRow>>` with `.path`, matching the Task 4 usage.
