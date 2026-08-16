# Grok Provider Support — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `grok` (xAI Grok Build CLI) as a fifth AI provider so a user can select it, have it detected, launch it in a task worktree, see live status, and resume a session.

**Architecture:** Grok is highly Claude-Code-compatible, so this ports the existing Claude integration (provider struct, PTY adapter, hooks module, install check, frontend union) with two Grok-specific adaptations: (1) the interactive TUI has no prompt argument, so OpenForge writes the prompt into the PTY once Grok's `SessionStart` hook fires; (2) Grok has no `--settings` flag, so lifecycle hooks are installed as one idempotent global file `~/.grok/hooks/openforge.json`, guarded to stay inert for the user's own Grok sessions.

**Tech Stack:** Rust sidecar (`src-tauri/`, portable_pty, serde_json, rusqlite), Svelte 5 + TypeScript renderer (`src/`), vitest, cargo test.

**Design spec:** `docs/superpowers/specs/2026-07-18-grok-provider-support-design.md`

## Global Constraints

- Provider ID string is **`grok`**; binary is **`grok`**. Default provider stays `claude-code`.
- Rust command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`; DB domain files use `impl super::Database`.
- JS/TS IPC payloads use camelCase matching the generated frontend API even when Rust params are snake_case.
- Tests cover business logic only — no assertions on CSS classes, Tailwind utilities, or visual styling.
- No hardcoded hex colors; daisyUI semantic classes only. Svelte 5 runes only. `import type` for types (verbatimModuleSyntax). Nullable fields use `T | null`.
- Never disable ESLint rules or suppress TS errors to silence problems; fix root cause.
- Focused test runs: `pnpm test <path>` or `pnpm exec vitest run <path>` (never `pnpm test -- <path>`). Rust: one `cargo test <filter>` per filter, filter before `--`.
- Commit messages must not mention Claude/Anthropic and must not add a Claude co-author.

---

## Phase 0 — De-risk (gating spike)

### Task 0: Prompt-injection + session-id spike

This is an investigation task (not TDD). It resolves the one genuine unknown before any launch code is written. Do it in a throwaway git worktree, never the user's repo.

**Files:** none (scratch only). Record findings at the bottom of the design spec under a new "## Spike results" heading and commit that.

- [ ] **Step 1: Create a scratch git repo**

```bash
mkdir -p /tmp/grok-spike && cd /tmp/grok-spike && git init -q && echo "# spike" > README.md && git add -A && git commit -qm init
```

- [ ] **Step 2: Confirm `--session-id` is honored in interactive mode**

Run (in a real terminal, since it's a TUI):
```bash
grok --cwd /tmp/grok-spike --session-id 00000000-0000-7000-8000-000000000001
```
Type a one-word prompt, let it respond, quit with `/quit`. Then:
```bash
grok sessions list
```
Expected: a session whose ID is `00000000-0000-7000-8000-000000000001`. **Record whether the preset ID is honored.**

- [ ] **Step 3: Capture a real `SessionStart` hook payload**

```bash
mkdir -p ~/.grok/hooks
cat > ~/.grok/hooks/spike.json <<'JSON'
{ "hooks": {
  "SessionStart": [ { "hooks": [ { "type": "command", "command": "sh -c 'cat >> /tmp/grok-spike/hook.log; echo >> /tmp/grok-spike/hook.log'" } ] } ],
  "Stop":         [ { "hooks": [ { "type": "command", "command": "sh -c 'echo STOP $GROK_SESSION_ID >> /tmp/grok-spike/hook.log'" } ] } ]
} }
JSON
```
Launch `grok --cwd /tmp/grok-spike`, send a prompt, quit. Inspect `/tmp/grok-spike/hook.log`. **Record:** does `SessionStart` fire on launch, does the JSON payload contain `sessionId`, and is `$GROK_SESSION_ID` populated on `Stop`?

- [ ] **Step 4: Decide the injection trigger + whether to preset the session id**

From steps 2-3, decide and record in the spec:
- **Injection trigger:** on `SessionStart` hook receipt (preferred) vs. a fixed short delay after spawn. Note observed latency between launch and the input box accepting typed characters.
- **Session-id source:** preset via `--session-id` (if step 2 honored it) vs. captured from the `SessionStart`/`Stop` hook payload (Claude model). Prefer capture-from-hook if preset is not honored; prefer preset if it is (simpler resume — known at spawn).

- [ ] **Step 5: Clean up + record**

```bash
rm -f ~/.grok/hooks/spike.json
```
Append a "## Spike results" section to the design spec with the four decisions, then:
```bash
git add docs/superpowers/specs/2026-07-18-grok-provider-support-design.md
git commit -m "docs: record Grok launch spike results (AVIV-117)"
```

**Gate:** Do not start Phase 1 until Step 4's decisions are recorded. The rest of the plan assumes **inject-on-SessionStart** and **capture-session-id-from-hook** (adjust Tasks 4/6/8 if the spike says otherwise).

---

## Phase 1 — Backend foundation

### Task 1: `grok_session_id` DB column

**Files:**
- Modify: `src-tauri/src/db/migrations.rs` (add migration near the `pi_session_id` one at ~`:829-839`)
- Modify: `src-tauri/src/db/agents.rs` (`AgentSessionRow` struct `:8-21`, `AGENT_SESSION_SELECT_COLUMNS` `:4`, add `set_agent_session_grok_id`, `set_agent_session_provider_id` match `:144-156`)
- Modify: `src-tauri/src/providers/mod.rs` test `make_session` `:322-343`, `src-tauri/src/providers/claude_code.rs` test `make_session` `:248-264` (add the new field to every `AgentSessionRow { .. }` literal — the compiler lists them all)

**Interfaces:**
- Produces: `AgentSessionRow.grok_session_id: Option<String>`; `Database::set_agent_session_grok_id(&self, session_id: &str, grok_session_id: &str) -> Result<(), String>`; `AGENT_SESSION_SELECT_COLUMNS` includes `grok_session_id`.

- [ ] **Step 1: Write the failing migration test**

In `src-tauri/src/db/migrations.rs` tests, add:
```rust
#[test]
fn agent_sessions_has_grok_session_id_column() {
    let conn = rusqlite::Connection::open_in_memory().unwrap();
    run_migrations(&conn).unwrap();
    let mut stmt = conn.prepare("PRAGMA table_info(agent_sessions)").unwrap();
    let cols: Vec<String> = stmt
        .query_map([], |r| r.get::<_, String>(1))
        .unwrap()
        .map(Result::unwrap)
        .collect();
    assert!(cols.contains(&"grok_session_id".to_string()));
}
```
(Adjust `run_migrations` to the actual entry point used by the neighboring `pi_session_id` test.)

- [ ] **Step 2: Run it — expect FAIL**

Run: `cd src-tauri && cargo test agent_sessions_has_grok_session_id_column`
Expected: FAIL (column absent).

- [ ] **Step 3: Add the migration**

Mirror the `pi_session_id` migration:
```rust
conn.execute(
    "ALTER TABLE agent_sessions ADD COLUMN grok_session_id TEXT",
    [],
)?;
```
Place it as a new, appended migration step (never edit an existing applied migration).

- [ ] **Step 4: Add the row field, column list, setter, and dispatch arm**

- `AGENT_SESSION_SELECT_COLUMNS`: append `, grok_session_id`.
- `AgentSessionRow`: add `pub grok_session_id: Option<String>,` and read it in the row mapper (mirror `pi_session_id`).
- Add:
```rust
pub fn set_agent_session_grok_id(&self, session_id: &str, grok_session_id: &str) -> Result<(), String> {
    self.conn()
        .execute(
            "UPDATE agent_sessions SET grok_session_id = ?1, updated_at = ?2 WHERE id = ?3",
            rusqlite::params![grok_session_id, now_ts(), session_id],
        )
        .map_err(|e| format!("Failed to set grok session id: {e}"))?;
    Ok(())
}
```
(Match the exact shape/`now_ts` helper of `set_agent_session_pi_id`.)
- In `set_agent_session_provider_id`, add: `"grok" => self.set_agent_session_grok_id(session_id, provider_session_id),`.

- [ ] **Step 5: Fix all `AgentSessionRow` literals**

Add `grok_session_id: None,` to every struct literal the compiler flags (test `make_session` helpers in `providers/mod.rs`, `claude_code.rs`, and any others).

- [ ] **Step 6: Run — expect PASS + compile**

Run: `cd src-tauri && cargo test agent_sessions_has_grok_session_id_column && cargo test set_agent_session`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/ src-tauri/src/providers/
git commit -m "feat(db): add grok_session_id column and setter (AVIV-117)"
```

### Task 2: `build_grok_args`

**Files:**
- Modify: `src-tauri/src/pty_manager/commands.rs` (add fn + tests near `build_claude_args`)

**Interfaces:**
- Produces: `pub(crate) fn build_grok_args(resume_session_id: Option<&str>, continue_session: bool, session_id: Option<&str>, permission_mode: Option<&str>, model: Option<&str>) -> Vec<String>`
- Note: **no prompt argument** — the prompt is injected into the PTY later (Task 8). `session_id` is the preset `--session-id` (only used on fresh start when the spike says preset is honored; pass `None` otherwise).

- [ ] **Step 1: Write failing tests**

```rust
#[test]
fn grok_args_fresh_session_presets_id_and_permission_mode() {
    assert_eq!(
        build_grok_args(None, false, Some("11111111-1111-7000-8000-000000000000"), Some("acceptEdits"), None),
        vec![
            "--session-id", "11111111-1111-7000-8000-000000000000",
            "--permission-mode", "acceptEdits",
        ]
    );
}

#[test]
fn grok_args_resume_by_id_ignores_preset_and_default_mode() {
    assert_eq!(
        build_grok_args(Some("grok-session-1"), false, Some("ignored"), Some("default"), None),
        vec!["--resume", "grok-session-1"]
    );
}

#[test]
fn grok_args_continue_without_id() {
    assert_eq!(build_grok_args(None, true, None, None, None), vec!["--continue"]);
}

#[test]
fn grok_args_include_model_when_present() {
    assert_eq!(
        build_grok_args(None, false, None, None, Some("grok-build")),
        vec!["--model", "grok-build"]
    );
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test grok_args`
Expected: FAIL (`build_grok_args` not found).

- [ ] **Step 3: Implement**

```rust
pub(crate) fn build_grok_args(
    resume_session_id: Option<&str>,
    continue_session: bool,
    session_id: Option<&str>,
    permission_mode: Option<&str>,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(id) = resume_session_id {
        args.push("--resume".to_string());
        args.push(id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    } else if let Some(id) = session_id.filter(|v| !v.is_empty()) {
        args.push("--session-id".to_string());
        args.push(id.to_string());
    }
    if let Some(mode) = permission_mode.filter(|m| !m.is_empty() && *m != "default") {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    args
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `cd src-tauri && cargo test grok_args`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty_manager/commands.rs
git commit -m "feat(pty): add build_grok_args (AVIV-117)"
```

### Task 3: `grok_hooks` module

**Files:**
- Create: `src-tauri/src/grok_hooks.rs` (port of `claude_hooks.rs`)
- Modify: `src-tauri/src/lib.rs` (or the module root that declares `mod claude_hooks;`) — add `pub mod grok_hooks;`

**Interfaces:**
- Produces:
  - `pub fn install_openforge_hook() -> Result<PathBuf, Box<dyn std::error::Error>>` — idempotently writes `~/.grok/hooks/openforge.json`.
  - `pub(crate) fn build_hooks_json(port: u16) -> serde_json::Value`
  - `pub(crate) fn grok_lifecycle_kind_from_event(event_type: &str) -> Option<crate::agent_lifecycle::AgentLifecycleEventKind>`
- Reuses `crate::claude_hooks::get_http_server_port()`.

**Design:** each hook is a guarded `"command"` hook that only fires for OpenForge-launched sessions. The command shape (port substituted):
```
[ -n "$OPENFORGE_TASK_ID" ] && curl -s -o /dev/null -X POST 'http://127.0.0.1:{port}/hooks/grok-{endpoint}?task_id='"$OPENFORGE_TASK_ID"'&pty_instance_id='"$OPENFORGE_PTY_INSTANCE_ID"'&session_id='"$GROK_SESSION_ID" -H 'Content-Type: application/json' --data-binary @-
```
Events → endpoints: `SessionStart`→`session-start`, `UserPromptSubmit`→`user-prompt-submit`, `PreToolUse`→`pre-tool-use`, `PostToolUse`→`post-tool-use`, `Stop`→`stop`, `SessionEnd`→`session-end`, `Notification`→`notification-permission` (with `"matcher": "permission_prompt"`).

- [ ] **Step 1: Write failing tests**

Port `claude_hooks.rs` tests, changing expectations to Grok. Key ones:
```rust
#[test]
fn grok_hooks_json_has_session_start_and_stop() {
    let json = build_hooks_json(17422);
    assert!(json["hooks"].get("SessionStart").is_some());
    assert!(json["hooks"].get("Stop").is_some());
    assert!(json["hooks"].get("SessionEnd").is_some());
}

#[test]
fn grok_hook_command_is_guarded_and_targets_grok_endpoint() {
    let json = build_hooks_json(9999);
    let cmd = json["hooks"]["Stop"][0]["hooks"][0]["command"].as_str().unwrap();
    assert!(cmd.contains("[ -n \"$OPENFORGE_TASK_ID\" ]"), "must be inert without OPENFORGE_TASK_ID");
    assert!(cmd.contains("127.0.0.1:9999"));
    assert!(cmd.contains("/hooks/grok-stop"));
    assert!(cmd.contains("$GROK_SESSION_ID"));
    assert!(cmd.contains("--data-binary @-"));
}

#[test]
fn grok_install_writes_hook_file() {
    // Point GROK_HOME/HOME to a tempdir if the impl supports it; otherwise test build_hooks_json only.
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test grok_hook`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `grok_hooks.rs`**

Port `claude_hooks.rs`. Changes: session-id var `$GROK_SESSION_ID`; endpoints `grok-*`; guard prefix `[ -n "$OPENFORGE_TASK_ID" ] &&`; `build_hooks_json` emits the seven events above; `install_openforge_hook()` writes `~/.grok/hooks/openforge.json` (create dir, write pretty JSON, idempotent overwrite). `grok_lifecycle_kind_from_event`: `"session-start"|"user-prompt-submit"|"pre-tool-use"|"post-tool-use" => BecameBusy`, `"stop"|"session-end" => Ended`, `"notification-permission" => RequestedPermission`, else `None`. Declare `pub mod grok_hooks;` in the module root.

- [ ] **Step 4: Run — expect PASS**

Run: `cd src-tauri && cargo test grok_hook`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/grok_hooks.rs src-tauri/src/lib.rs
git commit -m "feat: add grok_hooks lifecycle hook installer (AVIV-117)"
```

### Task 4: `GrokPtyAdapter` + `spawn_grok_pty`

**Files:**
- Modify: `src-tauri/src/pty_manager/session.rs` (add adapter after `PiPtyAdapter`; add `spawn_grok_pty` near `spawn_claude_pty` `:525`; export `build_grok_args` if needed)
- Modify: `src-tauri/src/pty_manager/mod.rs` if it re-exports arg builders (mirror `build_claude_args` export)

**Interfaces:**
- Consumes: `build_grok_args` (Task 2), `crate::grok_hooks::install_openforge_hook` (Task 3).
- Produces: `PtyManager::spawn_grok_pty(&self, task_id, worktree_path, resume_session_id: Option<&str>, continue_session: bool, session_id: Option<&str>, permission_mode: Option<&str>, model: Option<&str>, cols, rows, app_handle, app_event_tx) -> Result<u64, PtyError>` returning the pty instance id. **No `prompt` param** — prompt injection is Task 8.

- [ ] **Step 1: Write failing adapter tests**

Mirror the existing `session.rs` adapter tests (`:1719` etc.):
```rust
#[test]
fn grok_adapter_label_and_command_name() {
    let a = GrokPtyAdapter::new(None, false, Some("id"), Some("acceptEdits"), None);
    assert_eq!(a.label(), "Grok");
    assert_eq!(a.command_name(), "grok");
}

#[test]
fn grok_adapter_extra_env_sets_openforge_task_id() {
    let a = GrokPtyAdapter::new(None, false, None, None, None);
    let env = a.extra_env("T-1", 7);
    assert_eq!(env.get("OPENFORGE_TASK_ID").unwrap(), "T-1");
    assert_eq!(env.get("OPENFORGE_PTY_INSTANCE_ID").unwrap(), "7");
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test grok_adapter`
Expected: FAIL.

- [ ] **Step 3: Implement the adapter**

Mirror `ClaudeCodePtyAdapter`. Fields: `resume_session_id`, `continue_session`, `session_id`, `permission_mode`, `model` (no `prompt`, no `hooks_settings_path`). `command_args()` calls `build_grok_args(...)`. `prepare()` calls `crate::grok_hooks::install_openforge_hook()` (map error to `PtyError::SpawnFailed`) and `crate::claude_hooks::ensure_workspace_trusted` is **not** ported (Grok global hooks need no trust; the trust the adapter cares about is Grok's own project trust, which the global-hook approach avoids). `extra_env()` → `openforge_agent_env(task_id, instance_id)` (the shared helper at `:361`, which already sets `OPENFORGE_TASK_ID`/`OPENFORGE_PTY_INSTANCE_ID`/`OPENFORGE_HTTP_PORT`). `pid_file_name` → `format!("{}-pty.pid", task_id)`. `track_last_output()` → `true`.

- [ ] **Step 4: Implement `spawn_grok_pty`**

Mirror `spawn_claude_pty` (`:525`), constructing `GrokPtyAdapter` and delegating to the shared `spawn_agent_pty`. Drop the `prompt`/`hooks_path` params; add `session_id`/`model`.

- [ ] **Step 5: Run — expect PASS**

Run: `cd src-tauri && cargo test grok_adapter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pty_manager/
git commit -m "feat(pty): add Grok PTY adapter and spawn_grok_pty (AVIV-117)"
```

### Task 5: `GrokProvider` + enum wiring (backend first compiles end-to-end)

**Files:**
- Create: `src-tauri/src/providers/grok.rs` (port of `providers/claude_code.rs`)
- Modify: `src-tauri/src/providers/mod.rs` (`pub mod grok;`, `Grok(GrokProvider)` variant `:86-91`, `from_name` arm `:97-105`, all 8 dispatch matches `:123-308`, tests `:315-588`)

**Interfaces:**
- Consumes: `spawn_grok_pty` (Task 4), `AgentSessionRow.grok_session_id` (Task 1).
- Produces: `GrokProvider` with `new`, `start`, `resume`, `abort`, `cleanup`, `provider_name()->"grok"`, `provider_session_id()->grok_session_id`, `list_commands`, `list_agents`.

- [ ] **Step 1: Write failing enum tests**

Add to `providers/mod.rs` tests (mirror the codex/claude blocks), and extend `make_session` with a `grok_session_id` param:
```rust
#[test]
fn test_from_name_grok() {
    let result = Provider::from_name("grok", crate::pty_manager::PtyManager::new());
    assert!(result.is_ok());
    assert_eq!(result.unwrap().provider_name(), "grok");
}

#[test]
fn test_grok_provider_session_id_some() {
    let p = Provider::Grok(crate::providers::grok::GrokProvider::new(crate::pty_manager::PtyManager::new()));
    let mut session = make_session(None, None, None, "grok");
    session.grok_session_id = Some("grok-abc".to_string());
    assert_eq!(p.provider_session_id(&session), Some("grok-abc".to_string()));
}
```

- [ ] **Step 2: Run — expect FAIL / not compile**

Run: `cd src-tauri && cargo test test_from_name_grok`
Expected: FAIL (variant/provider missing).

- [ ] **Step 3: Implement `grok.rs`**

Port `claude_code.rs`. `provider_name()` → `"grok"`. `provider_session_id()` → `session.grok_session_id.clone()`. `start()`/`resume()`: **stash the prompt for injection** (Task 8) and call `spawn_grok_pty` (no prompt in args). For `start()`: generate a session UUID (only if the spike chose preset mode) via `uuid::Uuid::now_v7()` and pass as `session_id`; else `None`. For `resume()`: `resume_id = session.grok_session_id.as_deref()`, `use_continue = resume_id.is_none()`. `list_commands`/`list_agents`: Grok discovers from `.grok/` and (compat) `.claude/` — for v1, reuse the Claude discovery body (it already scans `.claude`), or return builtin-empty; keep it minimal and note as a follow-up. Return `ProviderSessionResult { port: 0, opencode_session_id: None, pi_session_id: None, pty_instance_id: Some(id) }`.

- [ ] **Step 4: Wire the enum**

`pub mod grok;` + `use grok::GrokProvider;`; add `Grok(GrokProvider)` to the enum; `"grok" => Ok(Provider::Grok(GrokProvider::new(pty_mgr)))` in `from_name`; add a `Provider::Grok(p) => ...` arm to **all 8** dispatch matches (`start`, `resume`, `abort`, `cleanup`, `provider_name`, `provider_session_id`, `list_commands`, `list_agents`). The compiler enumerates any missed arm.

- [ ] **Step 5: Run — expect PASS + full backend compile**

Run: `cd src-tauri && cargo test providers::`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/providers/
git commit -m "feat(providers): add GrokProvider and enum dispatch (AVIV-117)"
```

---

## Phase 2 — Live status + prompt injection

### Task 6: Grok lifecycle HTTP routes + mappings

**Files:**
- Modify: `src-tauri/src/http_server.rs` (add `/hooks/grok-*` routes + per-provider payload handling `:389-604`, `:1230-1339`, route table `:1747-1791`)
- Modify: `src-tauri/src/agent_lifecycle.rs` (`provider_requires_pty_instance` add `"grok"=>true` `:246`; `session_provider_id` arm `:277-282`)
- Modify: `src-tauri/src/provider_runtime.rs` (`provider_commands`/`provider_agents` arms `:39-90`)

**Interfaces:**
- Consumes: `grok_hooks::grok_lifecycle_kind_from_event` (Task 3), `set_agent_session_grok_id` (Task 1).
- Produces: routes `POST /hooks/grok-{session-start,user-prompt-submit,pre-tool-use,post-tool-use,stop,session-end,notification-permission}` that map to `AgentLifecycleEventKind` and (on `session-start`) persist `grok_session_id` from the `session_id` query param and enqueue prompt injection (Task 8).

- [ ] **Step 1: Write a failing route test**

Mirror the existing Claude hook route test in `http_server.rs`. Assert a POST to `/hooks/grok-stop?task_id=T-1&pty_instance_id=1&session_id=s` is accepted (200) and maps to `Ended`. (Use the existing test harness for the local server.)

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test grok`
Expected: FAIL (route missing).

- [ ] **Step 3: Implement routes + mappings**

Add the `grok-*` routes mirroring the Claude `/hooks/{stop,...}` handlers, decode `task_id`/`pty_instance_id`/`session_id` query params, call `grok_lifecycle_kind_from_event`, and dispatch the same lifecycle-update path Claude uses. On `grok-session-start`: persist `grok_session_id` via `set_agent_session_grok_id` and signal the prompt-injection store (Task 8). Add the `agent_lifecycle.rs` and `provider_runtime.rs` arms.

- [ ] **Step 4: Run — expect PASS**

Run: `cd src-tauri && cargo test grok`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server.rs src-tauri/src/agent_lifecycle.rs src-tauri/src/provider_runtime.rs
git commit -m "feat(http): add Grok lifecycle hook routes (AVIV-117)"
```

### Task 8: Prompt injection into the PTY

> Task 7 (install check) is independent and can be done in parallel; numbered after for readability.

**Files:**
- Modify: `src-tauri/src/pty_manager/session.rs` or `terminalPool`-equivalent — add `PtyManager::write_to_pty(&self, instance_id: u64, bytes: &[u8]) -> Result<(), PtyError>` if one does not already exist (the `PtySession.writer` at `:68` is the sink).
- Modify: `src-tauri/src/providers/grok.rs` — stash pending prompt keyed by `task_id`.
- Modify: `src-tauri/src/http_server.rs` — on `grok-session-start`, look up the pending prompt and write `"{prompt}\r"` to the PTY.

**Interfaces:**
- Produces: a pending-prompt store (e.g. `Arc<Mutex<HashMap<String, String>>>` on `PtyManager` or a dedicated struct) with `set_pending_prompt(task_id, prompt)` and `take_pending_prompt(task_id) -> Option<String>`; `write_to_pty(instance_id, bytes)`.

- [ ] **Step 1: Write a failing unit test for the store + writer**

```rust
#[test]
fn pending_prompt_is_taken_once() {
    let mgr = PtyManager::new();
    mgr.set_pending_prompt("T-1", "do the thing");
    assert_eq!(mgr.take_pending_prompt("T-1").as_deref(), Some("do the thing"));
    assert_eq!(mgr.take_pending_prompt("T-1"), None);
}
```

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test pending_prompt`
Expected: FAIL.

- [ ] **Step 3: Implement store, `write_to_pty`, and the wiring**

- Add the pending-prompt map + methods to `PtyManager`.
- `GrokProvider::start`/`resume` call `set_pending_prompt(task_id, prompt)` before spawn (resume only when a new prompt is supplied).
- On `grok-session-start`, `http_server` calls `take_pending_prompt(task_id)`, and if `Some`, `write_to_pty(pty_instance_id, format!("{prompt}\r").as_bytes())`. Apply the spike's timing decision (immediate vs. a short bounded delay/retry).

- [ ] **Step 4: Run — expect PASS**

Run: `cd src-tauri && cargo test pending_prompt`
Expected: PASS.

- [ ] **Step 5: Manual verify (real app)**

Launch a Grok task; confirm the prompt appears and runs in the Grok TUI, and the status pill goes running→done. (Full E2E in Task 14.)

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/pty_manager/ src-tauri/src/providers/grok.rs src-tauri/src/http_server.rs
git commit -m "feat: inject task prompt into Grok TUI on SessionStart (AVIV-117)"
```

### Task 7: Install detection

**Files:**
- Modify: `src-tauri/src/runtime_checks.rs` (add `GrokInstallStatus` + `check_grok_installed` mirroring `check_opencode_installed` `:86-92`; tests `:198-252`)
- Modify: `src-tauri/src/app_invoke/runtime.rs` (register `"check_grok_installed"` `:136-152`)

**Interfaces:**
- Produces: `pub async fn check_grok_installed() -> Result<GrokInstallStatus, String>` with fields `installed/path/version` (no auth probe).

- [ ] **Step 1: Write failing test**

Mirror `check_opencode` install-status mapping test: given a fake `grok` on PATH returning `--version`, `installed == true` and `version` parsed.

- [ ] **Step 2: Run — expect FAIL**

Run: `cd src-tauri && cargo test grok_install`
Expected: FAIL.

- [ ] **Step 3: Implement**

```rust
#[derive(Serialize)]
pub struct GrokInstallStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub version: Option<String>,
}
impl From<VersionedExecutableInstallStatus> for GrokInstallStatus {
    fn from(s: VersionedExecutableInstallStatus) -> Self {
        Self { installed: s.installed, path: s.path, version: s.version }
    }
}
pub async fn check_grok_installed() -> Result<GrokInstallStatus, String> {
    Ok(check_versioned_executable_installed("grok", &user_tool_path()).into())
}
```
Register `"check_grok_installed"` in `app_invoke/runtime.rs`.

- [ ] **Step 4: Run — expect PASS**

Run: `cd src-tauri && cargo test grok_install`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/runtime_checks.rs src-tauri/src/app_invoke/runtime.rs
git commit -m "feat: add check_grok_installed (AVIV-117)"
```

---

## Phase 3 — Frontend

### Task 9: Resume command + status pill (pure TS)

**Files:**
- Modify: `src/lib/agentResumeCommand.ts` (`AgentResumeCommandProvider` union `:3`, `RESUME_COMMANDS` `:7-12`, `ProviderSessionIdKey` `:5`)
- Modify: `src/lib/agentStatusPill.ts` (`getAgentProviderConfig` `:21-32`)
- Test: `src/lib/agentResumeCommand.test.ts`, `src/lib/agentStatusPill.test.ts`

- [ ] **Step 1: Write failing vitest**

```ts
it('builds the grok resume command', () => {
  expect(buildResumeCommand('grok', 'grok-1')).toBe('grok --resume grok-1');
});
```
(Match the existing test's call signature/expected format.)

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm exec vitest run src/lib/agentResumeCommand.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

Add `'grok'` to the union; `RESUME_COMMANDS.grok = { binary: 'grok', flag: '--resume' }`; add `'grok_session_id'` to `ProviderSessionIdKey`; add `case 'grok'` to `getAgentProviderConfig` (running text e.g. `'Grok is working…'`, checkpoint support matching Claude).

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm exec vitest run src/lib/agentResumeCommand.test.ts src/lib/agentStatusPill.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentResumeCommand.ts src/lib/agentStatusPill.ts src/lib/*.test.ts
git commit -m "feat(ui): grok resume command and status pill config (AVIV-117)"
```

### Task 10: IPC wrapper + installation status aggregation

**Files:**
- Modify: `src/lib/ipc.ts` (`checkGrokInstalled` `:274-287`)
- Modify: `src/lib/electronMigrationContracts.ts` (contract row `:96-99`)
- Modify: `src/lib/settingsConfig.ts` (`InstallationStatus` `:4-11`, `loadInstallationStatus` `:139-175`)
- Test: `src/lib/settingsConfig.test.ts`

**Interfaces:**
- Produces: `checkGrokInstalled(): Promise<{ installed: boolean; path: string | null; version: string | null }>` invoking `"check_grok_installed"`.

- [ ] **Step 1: Write failing vitest** for `loadInstallationStatus` including a `grok` entry (mock the IPC).
- [ ] **Step 2: Run — expect FAIL.** `pnpm exec vitest run src/lib/settingsConfig.test.ts`
- [ ] **Step 3: Implement** `checkGrokInstalled` (mirror `checkCodexInstalled`), add its contract row, extend `InstallationStatus` with `grok` + aggregate it in `loadInstallationStatus`.
- [ ] **Step 4: Run — expect PASS.**
- [ ] **Step 5: Commit** `git commit -m "feat(ipc): checkGrokInstalled + installation status (AVIV-117)"`

### Task 11: Settings UI (selection + detection row)

**Files:**
- Modify: `src/components/settings/SettingsGeneralCard.svelte` (`PROVIDER_INSTALL_URLS` `:9-14` → `grok: 'https://x.ai/cli'`; `providerRecoveryInfo` `:99-144` → grok entry with `label: 'Grok'`, install guidance `curl -fsSL https://x.ai/cli/install.sh | bash`, auth guidance `browser login or XAI_API_KEY`; install-status row; Props `grokInstalled`/version)
- Modify: `src/components/settings/SettingsView.svelte` (`grokInstalled`/`grokVersion` `$state` + prop wiring `:58-81`, `:161-169`, `:549-571`)
- Test: `src/components/settings/SettingsGeneralCard.test.ts` (business logic — the grok option is present in the provider list; no CSS assertions)

- [ ] **Step 1: Write failing vitest** asserting the provider dropdown/list includes an option with id `grok` / label `Grok`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the grok entries + state wiring (mirror the Codex block exactly).
- [ ] **Step 4: Run — expect PASS.** `pnpm exec vitest run src/components/settings/SettingsGeneralCard.test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(settings): select and detect Grok provider (AVIV-117)"`

### Task 12: Task-detail wiring (session key + permission mode)

**Files:**
- Modify: `src/components/task-detail/AgentPanel.svelte` (`:36-63` — add a `grok` branch selecting `sessionIdKey = 'grok_session_id'` and a `rootTestId`)
- Modify: `src/components/AddTaskDialog.svelte` (`:574` — extend the permission-mode UI condition to `aiProvider === 'claude-code' || aiProvider === 'grok'`; leave `commandTrigger` as slash — grok uses `/`)
- Test: `src/components/task-detail/AgentPanel.test.ts`

- [ ] **Step 1: Write failing vitest** asserting AgentPanel resolves `grok_session_id` for provider `grok`.
- [ ] **Step 2: Run — expect FAIL.**
- [ ] **Step 3: Implement** the branch + permission-mode condition.
- [ ] **Step 4: Run — expect PASS.** `pnpm exec vitest run src/components/task-detail/AgentPanel.test.ts`
- [ ] **Step 5: Commit** `git commit -m "feat(task-detail): wire Grok session key and permission mode (AVIV-117)"`

---

## Phase 4 — Docs + verification

### Task 13: Documentation

**Files:** `README.md:36`, `CONTRIBUTING.md:11,111`, `docs/roadmap/DEFERRED.md:44-50`

- [ ] **Step 1:** Add "Grok" to the provider lists in each file (e.g. README: "Start Claude Code, OpenCode, Pi, Codex, or Grok agents per task."). Update the `ai_provider ∈ {…}` set in `DEFERRED.md` to include `grok`.
- [ ] **Step 2: Verify** no stale count/enumerations remain: `grep -rn "opencode, or pi\|claude-code, codex, opencode, pi" README.md CONTRIBUTING.md docs/`
- [ ] **Step 3: Commit** `git commit -m "docs: list Grok as a supported provider (AVIV-117)"`

### Task 14: End-to-end verification

- [ ] **Step 1:** Full typecheck + suites: `pnpm exec tsc --noEmit && pnpm test` and `cd src-tauri && cargo test`. Expected: all pass.
- [ ] **Step 2:** `pnpm electron:dev`. In Settings, confirm Grok shows as installed with a version. Select Grok for a project.
- [ ] **Step 3:** Create a task, start it. Confirm: Grok launches in the worktree, the task prompt is injected and runs, the status pill goes running→done on `Stop`.
- [ ] **Step 4:** Stop and resume the task. Confirm it resumes the same Grok session (check `grok sessions list` shows continuity / the stored `grok_session_id`).
- [ ] **Step 5:** As a non-OpenForge sanity check, run `grok` yourself in an unrelated dir and confirm the global hook stays silent (no OpenForge traffic — the `OPENFORGE_TASK_ID` guard holds).
- [ ] **Step 6:** Update the OpenForge task handoff notes (`openforge task update --task-id AVIV-117 --summary ...`) with final status and the deferred follow-up list.

---

## Deferred (create as follow-up tasks depending on AVIV-117 after core lands)

- Headless auto-title generation for Grok (`task_metadata_refresh/providers.rs`).
- Roadmap AI ticket drafting for Grok (`roadmap_ai.rs`).
- Headless `agent_generate` print-mode for Grok (`app_invoke/agent_generate.rs`).
- Skills install target for Grok (`cli_installer.rs` — remember to update the `assert_eq!(targets.len(), …)` count).
- Richer `list_commands`/`list_agents` discovery from `.grok/` (skills, plugins, subagents).

## Self-Review

- **Spec coverage:** select (T11), detect (T7/T10/T11), launch (T2/T4/T5/T8), live status (T3/T6), resume (T1/T5/T9/T12). D1 identity (global constraints + T5), D2 injection (T0/T8), D3 global guarded hook (T3), D4 grok_session_id (T1), D5 permission mode (T2/T12). Deferred items listed. All spec sections map to a task.
- **Placeholder scan:** the one genuine unknown (injection timing/source) is isolated in Task 0 with concrete commands and a recorded decision that parameterizes T8; not a placeholder.
- **Type consistency:** `grok_session_id` (DB col / row field / `ProviderSessionIdKey` / AgentPanel key) and `build_grok_args`/`spawn_grok_pty` signatures are used consistently across T1/T4/T5/T9/T12.
