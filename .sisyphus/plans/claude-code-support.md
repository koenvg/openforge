# T-392: Add Claude Code Support to the App

## TL;DR

> **Quick Summary**: Add Claude Code as a dual-provider alternative alongside the existing OpenCode integration. Users can switch between providers via a global setting. Claude Code integration uses CLI subprocess with stream-json output for orchestration and PTY with `--resume` for interactive terminal display.
> 
> **Deliverables**:
> - Claude Code process manager (spawn, track, kill subprocesses)
> - Stream-json bridge (parse NDJSON, map events to app statuses, emit Tauri events)
> - Provider-aware orchestration (start_implementation, run_action, abort for both providers)
> - Claude Code PTY support (spawn `claude --resume` for terminal display)
> - DB migration (provider + claude_session_id columns)
> - Frontend global settings dropdown + check_claude_installed
> - All existing OpenCode functionality unchanged
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 (DB migration) → Task 3 (process manager) → Task 4 (bridge) → Task 7 (orchestration) → Task 9 (PTY) → Task 11 (frontend settings) → Task 14 (integration test)

---

## Context

### Original Request
"Can you see if we can add claude code support to the app" — Add Claude Code as an AI agent provider alongside the existing OpenCode integration.

### Interview Summary
**Key Discussions**:
- Provider Strategy: Dual-provider — keep OpenCode working, add Claude Code as alternative
- Integration Depth: Full orchestration + terminal — same level as current OpenCode
- Permission Handling: `--permission-mode acceptEdits` — auto-approve file edits, prompt for bash
- Provider Selection: Global setting only — one setting in app settings for all projects
- Terminal Display: Claude Code interactive TUI in PTY via `claude --resume <session_id>`
- Authentication: Rely on user's existing `claude auth login` — no API key management in app

**Research Findings**:
- Claude Code has NO HTTP server mode — fundamentally different from OpenCode's long-lived server + SSE architecture
- CLI headless mode (`claude -p --output-format stream-json --verbose`) streams NDJSON events to stdout
- Session management: `--resume <session_id>` continues conversations, works cross-mode (headless → interactive TUI)
- **No `--cwd` flag** — must use `Command::current_dir(worktree_path)` instead
- **`--verbose` is required** — without it, only `system.init` and `result` events are emitted (no progress info)
- Agent SDK exists (TypeScript/Python) but requires Node.js sidecar — rejected in favor of direct subprocess approach

### Metis Review
**Identified Gaps** (addressed):
- `--cwd` flag doesn't exist: Use `Command::current_dir()` instead
- `--verbose` needed for progress: Always include `--verbose` flag
- No `result` event on kill: Handle "process exited without result" as `interrupted`
- PTY bridge assumes `opencode_port`: Add separate code path for Claude Code PTY
- Provider locked per session, not global switch mid-task: Add `provider` column to `agent_sessions`
- Startup resume differs: Claude Code tasks get marked interrupted (no server to resume)
- Auth verification: Include `claude auth status` in check_claude_installed
- Zombie cleanup: PID files at `~/.ai-command-center/pids/{task_id}-claude.pid`
- **DB migration system changed**: Rebased onto main which includes `rusqlite_migration` crate. New migrations use `M::up()` entries in `get_migrations()` vec, NOT ad-hoc `pragma_table_info` checks. Task 1 updated to use V2 migration pattern.

---

## Work Objectives

### Core Objective
Add Claude Code as a dual-provider AI agent alongside OpenCode, with full orchestration and interactive terminal support, maintaining identical UX and data flows while preserving all existing OpenCode functionality.

### Concrete Deliverables
- `src-tauri/src/claude_process_manager.rs` — subprocess lifecycle
- `src-tauri/src/claude_bridge.rs` — stream-json event parser + emitter
- Updated `src-tauri/src/commands/orchestration.rs` — provider-aware branching
- Updated `src-tauri/src/pty_manager.rs` — Claude Code PTY spawn
- Updated `src-tauri/src/commands/config.rs` — check_claude_installed
- Updated `src-tauri/src/db/mod.rs` — migration for new columns
- Updated `src-tauri/src/db/agents.rs` — new column operations
- Updated `src-tauri/src/main.rs` — register new state + commands
- Updated `src/lib/types.ts` — new TypeScript interfaces
- Updated `src/lib/ipc.ts` — new IPC wrappers
- Updated frontend settings UI — provider dropdown

### Definition of Done
- [ ] `cargo test` passes with 0 failures (full suite)
- [ ] `pnpm test` passes with 0 failures (full suite)
- [ ] Claude Code task lifecycle works: start → running → completed (with `claude` installed and authed)
- [ ] OpenCode task lifecycle unchanged: all existing tests pass without modification
- [ ] Provider setting persists across app restarts
- [ ] Terminal panel shows Claude Code TUI via `--resume`

### Must Have
- Claude Code subprocess spawning with stream-json output parsing
- Status mapping: running → completed/failed/interrupted
- Session ID capture and storage
- `--resume` PTY for terminal display
- Global provider setting (OpenCode / Claude Code)
- `check_claude_installed` (with auth status)
- PID file management for zombie cleanup
- DB migration for `provider` and `claude_session_id` columns

### Must NOT Have (Guardrails)
- NO provider trait/abstraction — use simple if/else branching in orchestration.rs
- NO renaming existing DB columns — add new columns alongside existing ones
- NO per-task or per-project provider selection — global setting only
- NO cost tracking UI — even though `result` events include `total_cost_usd`
- NO permission prompt UI — rely on `--permission-mode acceptEdits` + PTY for bash
- NO streaming token display panel — PTY terminal handles display
- NO Agent SDK sidecar (Node.js) — pure subprocess approach
- NO `--allowedTools` configuration UI
- NO auth management / "Login to Claude" button
- NO `--no-session-persistence` — sessions must persist for `--resume` to work
- NO changes to the `AgentEventPayload` struct shape — Claude bridge emits compatible events

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + cargo test)
- **Automated tests**: Tests-after (add tests for new modules after implementation)
- **Framework**: vitest (frontend), cargo test (Rust backend)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend modules**: Use Bash (`cargo test`) — run specific test functions, verify output
- **Frontend components**: Use Bash (`pnpm vitest run`) — run specific test files
- **CLI validation**: Use Bash — run `claude` commands, verify output format
- **Integration**: Use Bash — `cargo build`, spawn subprocess, verify events

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — start immediately):
├── Task 1: DB migration (add provider + claude_session_id columns) [quick]
├── Task 2: check_claude_installed command [quick]
└── Task 3: Claude process manager (subprocess spawn + NDJSON reader) [deep]

Wave 2 (Core — after Wave 1):
├── Task 4: Claude bridge (event parser + status mapping + Tauri emit) [deep]
├── Task 5: Frontend types + IPC wrappers [quick]
└── Task 6: DB operations for new columns [quick]

Wave 3 (Integration — after Wave 2):
├── Task 7: Orchestration: provider-aware start_implementation + run_action [deep]
├── Task 8: Orchestration: provider-aware abort_implementation [unspecified-high]
├── Task 9: PTY manager: Claude Code terminal spawn [unspecified-high]
├── Task 10: main.rs: register state, startup cleanup, shutdown [quick]
└── Task 11: Frontend: global settings provider dropdown + check installed [unspecified-high]

Wave 4 (Polish — after Wave 3):
├── Task 12: Frontend: AgentPanel PTY bridge for Claude Code [unspecified-high]
├── Task 13: Startup resume handling for Claude Code tasks [quick]
└── Task 14: Full regression test (cargo test + pnpm test) [unspecified-high]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 3 → Task 4 → Task 7 → Task 9 → Task 12 → Task 14 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 4, 6, 7, 8 | 1 |
| 2 | — | 7, 11 | 1 |
| 3 | — | 4, 7, 8, 9, 10 | 1 |
| 4 | 1, 3 | 7, 8 | 2 |
| 5 | — | 11, 12 | 2 |
| 6 | 1 | 7, 8 | 2 |
| 7 | 2, 3, 4, 6 | 9, 12, 14 | 3 |
| 8 | 3, 4, 6 | 14 | 3 |
| 9 | 3, 7 | 12 | 3 |
| 10 | 3 | 14 | 3 |
| 11 | 2, 5 | 14 | 3 |
| 12 | 5, 9 | 14 | 4 |
| 13 | 3, 6 | 14 | 4 |
| 14 | 7-13 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: **3** — T1 → `quick`, T2 → `quick`, T3 → `deep`
- **Wave 2**: **3** — T4 → `deep`, T5 → `quick`, T6 → `quick`
- **Wave 3**: **5** — T7 → `deep`, T8 → `unspecified-high`, T9 → `unspecified-high`, T10 → `quick`, T11 → `unspecified-high`
- **Wave 4**: **3** — T12 → `unspecified-high`, T13 → `quick`, T14 → `unspecified-high`
- **FINAL**: **4** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [ ] 1. DB Migration: Add `provider` and `claude_session_id` columns to `agent_sessions`

  **What to do**:
  - Add a V2 migration to `src-tauri/src/db/mod.rs` inside the `get_migrations()` function's `Migrations::new(vec![...])` array. Append a new `M::up(...)` entry after the existing V1 migration:
    ```rust
    M::up(r#"
        ALTER TABLE agent_sessions ADD COLUMN provider TEXT NOT NULL DEFAULT 'opencode';
        ALTER TABLE agent_sessions ADD COLUMN claude_session_id TEXT;
        INSERT OR IGNORE INTO config (key, value) VALUES ('ai_provider', 'opencode');
    "#),
    ```
  - This will automatically bump `user_version` from 1 to 2
  - Update `AgentSessionRow` struct in `src-tauri/src/db/agents.rs` to include `provider: String` and `claude_session_id: Option<String>`
  - Update ALL `SELECT` queries in `agents.rs` that read from `agent_sessions` to include the two new columns (get_agent_session, get_latest_session_for_ticket, get_sessions_for_ticket, get_latest_sessions_for_tickets, mark_running_sessions_interrupted)
  - Update `create_agent_session` to accept a `provider` parameter and insert it
  - Add `set_agent_session_claude_id(&self, id: &str, claude_session_id: &str) -> Result<()>` method (mirrors existing `set_agent_session_opencode_id`)
  - Add unit test: `test_agent_session_with_claude_provider` — creates a session with `provider="claude-code"`, reads it back, verifies both new fields
  - Update the `test_database_initialization` test: change expected config_count from 15 to 16 (new `ai_provider` config key) and update user_version assertions from 1 to 2 where applicable

  **Must NOT do**:
  - Do NOT rename the existing `opencode_session_id` column
  - Do NOT change the signature of existing methods — add the `provider` parameter to `create_agent_session` only
  - Do NOT add a `provider` trait or enum — use plain strings (`"opencode"`, `"claude-code"`)
  - Do NOT modify the V1 migration — add a NEW V2 entry to the migrations vec
  - Do NOT use the old ad-hoc `pragma_table_info` + `ALTER TABLE` pattern — use `rusqlite_migration` `M::up()`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: SQLite migration + struct update is a well-defined, mechanical task
  - **Skills**: []
    - No specialized skills needed — standard Rust/SQL
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 4, 6, 7, 8, 13
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/db/mod.rs:89-318` — `get_migrations()` function with V1 `M::up_with_hook(...)` entry — add V2 `M::up(...)` at the end of the `vec![]`
  - `src-tauri/src/db/mod.rs:114-125` — `agent_sessions` CREATE TABLE in V1 schema for column context
  - `src-tauri/src/db/mod.rs:243-257` — Default config INSERT pattern in V1 SQL (the V2 migration adds `ai_provider` config inline)
  - `src-tauri/src/db/mod.rs:320-340` — `test_helpers` module with `make_test_db` helper

  **API/Type References** (contracts to implement against):
  - `src-tauri/src/db/agents.rs:6-16` — `AgentSessionRow` struct to update with new fields
  - `src-tauri/src/db/agents.rs:29-48` — `create_agent_session` method to add `provider` param
  - `src-tauri/src/db/agents.rs:70-77` — `set_agent_session_opencode_id` — pattern to follow for `set_agent_session_claude_id`

  **Test References** (testing patterns to follow):
  - `src-tauri/src/db/mod.rs:348-386` — `test_database_initialization` test (update expected counts)
  - `src-tauri/src/db/mod.rs:519-523` — `test_migrations_validate` test (validates migration chain)
  - `src-tauri/src/db/mod.rs:553-567` — `test_new_db_user_version` test (update expected version from 1 to 2)

  **WHY Each Reference Matters**:
  - `mod.rs:89-318`: The migration system — V2 entry must follow V1 pattern. `rusqlite_migration` handles versioning automatically via `PRAGMA user_version`
  - `agents.rs:6-16`: The struct that must be extended — all SELECT queries mapping to this struct must be updated
  - `agents.rs:70-77`: The exact `set_opencode_id` pattern to clone for `set_claude_id`
  - `mod.rs:348-386`: Test assertions on config count and table count MUST be updated for the new config key

  **Acceptance Criteria**:
  - [ ] `cargo test test_agent_session_with_claude_provider` → PASS
  - [ ] `cargo test` → all existing tests still pass (no regressions)
  - [ ] `cargo build` → clean compilation with no warnings about new fields

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: New columns exist after migration
    Tool: Bash
    Preconditions: Fresh database (delete existing DB file)
    Steps:
      1. Run `cargo test test_agent_session_with_claude_provider -- --nocapture`
      2. Verify output contains test pass indication
      3. Run `cargo build` and verify clean compile
    Expected Result: Test creates session with provider="claude-code" and claude_session_id="ses_abc", reads it back, asserts both fields match
    Failure Indicators: Compilation error mentioning `provider` or `claude_session_id`, test assertion failure
    Evidence: .sisyphus/evidence/task-1-migration-test.txt

  Scenario: Existing sessions get default provider value
    Tool: Bash
    Preconditions: Database with existing agent_sessions rows (from other tests)
    Steps:
      1. Run `cargo test` (full suite) to verify all existing tests pass
      2. Check no test creates agent_session without provider and fails
    Expected Result: All existing tests pass because DEFAULT 'opencode' handles missing provider
    Failure Indicators: Any test failure mentioning provider column or argument count mismatch
    Evidence: .sisyphus/evidence/task-1-regression.txt
  ```

  **Commit**: YES (group with Wave 1)
  - Message: `feat(db): add provider and claude_session_id columns to agent_sessions`
  - Files: `src-tauri/src/db/mod.rs`, `src-tauri/src/db/agents.rs`
  - Pre-commit: `cargo test`

---

- [ ] 2. `check_claude_installed` command

  **What to do**:
  - Add a new struct `ClaudeInstallStatus` in `src-tauri/src/commands/config.rs` with fields: `installed: bool`, `path: Option<String>`, `version: Option<String>`, `authenticated: bool`
  - Add a new Tauri command `check_claude_installed` in `src-tauri/src/commands/config.rs` that:
    1. Runs `which claude` — if not found, return `{ installed: false, path: None, version: None, authenticated: false }`
    2. If found, runs `claude --version` to capture version string
    3. Runs `claude auth status` — check exit code: 0 = authenticated, non-zero = not authenticated
    4. Returns `ClaudeInstallStatus { installed: true, path, version, authenticated }`
  - Register the command in `src-tauri/src/main.rs` `generate_handler!` macro (add `commands::config::check_claude_installed`)
  - Add IPC wrapper in `src/lib/ipc.ts`: `checkClaudeInstalled()` returning `Promise<{ installed: boolean; path: string | null; version: string | null; authenticated: boolean }>`

  **Must NOT do**:
  - Do NOT add any login/auth management (no `claude auth login` trigger)
  - Do NOT modify `check_opencode_installed` — keep it exactly as-is

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small command addition following exact existing pattern
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 7, 11
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/commands/config.rs:6-45` — `OpenCodeInstallStatus` struct + `check_opencode_installed` command — CLONE this exact pattern for Claude
  - `src-tauri/src/main.rs:248` — Where `check_opencode_installed` is registered — add `check_claude_installed` nearby

  **API/Type References** (contracts to implement against):
  - `src/lib/ipc.ts:119-121` — `checkOpenCodeInstalled()` IPC wrapper — clone pattern for `checkClaudeInstalled()`

  **External References**:
  - Claude CLI: `claude --version` prints version, `claude auth status` returns exit code 0 if authed

  **WHY Each Reference Matters**:
  - `config.rs:6-45`: The EXACT pattern to replicate — same struct shape, same `which`/`--version` pattern, just add `authenticated` field and `auth status` check
  - `main.rs:248`: Registration location — must add new command next to existing check
  - `ipc.ts:119-121`: TypeScript wrapper pattern to clone

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] New command registered in `main.rs` `generate_handler!`
  - [ ] IPC wrapper exists in `ipc.ts`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Claude CLI is installed and authenticated
    Tool: Bash
    Preconditions: `claude` CLI is installed and `claude auth login` has been run
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Run `which claude` — verify path exists
      3. Run `claude --version` — verify version output
      4. Run `claude auth status` — verify exit code is 0
    Expected Result: Build succeeds, all 3 commands return valid output; the Tauri command would return { installed: true, path: "/path/to/claude", version: "X.Y.Z", authenticated: true }
    Failure Indicators: Compile error, command not found, auth status exit code non-zero
    Evidence: .sisyphus/evidence/task-2-check-claude.txt

  Scenario: Claude CLI is NOT installed
    Tool: Bash
    Preconditions: `claude` not in PATH (or test with a non-existent binary name)
    Steps:
      1. Run `which nonexistent-binary-claude-test` — verify it fails
      2. Verify the code path handles `which` failure gracefully (returns installed: false)
    Expected Result: No panic or error — graceful fallback to { installed: false, ... }
    Failure Indicators: Panic, unwrap failure, non-graceful error
    Evidence: .sisyphus/evidence/task-2-not-installed.txt
  ```

  **Commit**: YES (group with Wave 1)
  - Message: `feat(config): add check_claude_installed command`
  - Files: `src-tauri/src/commands/config.rs`, `src-tauri/src/main.rs`, `src/lib/ipc.ts`
  - Pre-commit: `cargo build`

---

- [ ] 3. Claude Process Manager (subprocess spawn + NDJSON stdout reader)

  **What to do**:
  - Create new file `src-tauri/src/claude_process_manager.rs`
  - Define error enum `ClaudeProcessError` with variants: `SpawnFailed(String)`, `AlreadyRunning(String)`, `ProcessNotFound(String)`, `IoError(io::Error)` — follow `ServerError` pattern from `server_manager.rs`
  - Define `ManagedClaudeProcess` struct holding: `child: Child` (tokio), `pid: u32`, `worktree_path: PathBuf`, `task_id: String`
  - Define `ClaudeProcessManager` struct with `processes: Arc<Mutex<HashMap<String, ManagedClaudeProcess>>>` and `pid_dir_override: Option<PathBuf>` — follow `ServerManager` pattern
  - Implement methods:
    1. `pub fn new() -> Self`
    2. `pub async fn spawn_claude(&self, task_id: &str, worktree_path: &Path, prompt: &str) -> Result<(u32, tokio::process::ChildStdout), ClaudeProcessError>`
       - Build command: `claude` with args: `-p`, the prompt string, `--output-format`, `stream-json`, `--verbose`, `--permission-mode`, `acceptEdits`
       - Set `current_dir(worktree_path)` on the `Command` — NOT `--cwd` (flag doesn't exist)
       - Set stdout to `Stdio::piped()`, stderr to `Stdio::piped()`
       - Get user environment via `get_user_environment()` pattern from `pty_manager.rs`  
       - Spawn the child process
       - Write PID file to `~/.ai-command-center/pids/{task_id}-claude.pid`
       - Store `ManagedClaudeProcess` in the HashMap
       - Return `(pid, child_stdout)` — stdout is consumed by the bridge (Task 4)
    3. `pub async fn spawn_claude_resume(&self, task_id: &str, worktree_path: &Path, claude_session_id: &str, prompt: &str) -> Result<(u32, tokio::process::ChildStdout), ClaudeProcessError>`
       - Same as above but adds `--resume` and `claude_session_id` args before `-p`
    4. `pub async fn kill_process(&self, task_id: &str) -> Result<(), ClaudeProcessError>`
       - Remove from HashMap, kill child, remove PID file
    5. `pub async fn kill_all(&self)`
       - Kill all tracked processes, remove all PID files
    6. `pub fn cleanup_stale_pids(&self) -> Result<(), io::Error>`
       - On startup, read PID dir, kill stale processes, remove PID files — follow `server_manager.rs` pattern
    7. `pub async fn is_running(&self, task_id: &str) -> bool`
  - Add `mod claude_process_manager;` to `main.rs`
  - Add helper function `get_user_environment()` — either reuse from `pty_manager.rs` or extract to shared location if it's private there

  **Must NOT do**:
  - Do NOT use `--cwd` flag (it doesn't exist in Claude CLI)
  - Do NOT forget `--verbose` flag (without it, only `system.init` and `result` events are emitted)
  - Do NOT create a shared trait/interface between ServerManager and ClaudeProcessManager
  - Do NOT start an HTTP server — Claude Code IS the process

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: New module from scratch with async process management, stdout piping, PID lifecycle — requires careful design
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 7, 8, 9, 10
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/server_manager.rs:1-80` — Error enum, struct layout, HashMap pattern, PID dir — CLONE structure
  - `src-tauri/src/server_manager.rs:81-200` — `spawn_server` method for process spawn + PID file write pattern
  - `src-tauri/src/pty_manager.rs:130-148` — `get_user_environment()` helper + env var setup pattern

  **API/Type References** (contracts to implement against):
  - Return type: `(u32, tokio::process::ChildStdout)` — the stdout handle is consumed by `claude_bridge.rs` (Task 4)

  **External References**:
  - Claude CLI args: `claude -p "prompt" --output-format stream-json --verbose --permission-mode acceptEdits`
  - Resume: `claude --resume <session_id> -p "prompt" --output-format stream-json --verbose --permission-mode acceptEdits`

  **WHY Each Reference Matters**:
  - `server_manager.rs`: Exact structural pattern — error type, HashMap of managed processes, PID files, kill/cleanup. Clone this, replace HTTP server with subprocess.
  - `pty_manager.rs:130-148`: User environment setup — critical on macOS where GUI apps don't inherit shell PATH. Without this, `claude` binary won't be found.

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] Module declared in `main.rs`
  - [ ] `spawn_claude` builds correct command with `--verbose`, `--permission-mode`, `--output-format stream-json`, `current_dir`
  - [ ] PID file written on spawn, removed on kill
  - [ ] Unit test: `test_claude_process_manager_new` (verify empty state)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Process manager compiles and creates correctly
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Verify `src-tauri/src/claude_process_manager.rs` exists
      3. Verify `mod claude_process_manager;` exists in main.rs (grep)
    Expected Result: Clean build, new file exists, module declared
    Failure Indicators: Compile errors, missing file, missing mod declaration
    Evidence: .sisyphus/evidence/task-3-compile.txt

  Scenario: Command construction includes all required flags
    Tool: Bash
    Preconditions: Code is compiled
    Steps:
      1. Read `claude_process_manager.rs` and verify command construction contains:
         - `-p` arg for prompt
         - `--output-format` `stream-json`
         - `--verbose`
         - `--permission-mode` `acceptEdits`
         - `current_dir(worktree_path)` (NOT `--cwd`)
      2. Verify `spawn_claude_resume` also includes `--resume` arg
    Expected Result: All 5 required flags/settings present in spawn_claude, plus --resume in spawn_claude_resume
    Failure Indicators: Missing any flag, using --cwd instead of current_dir
    Evidence: .sisyphus/evidence/task-3-flags-check.txt
  ```

  **Commit**: YES (group with Wave 1)
  - Message: `feat(backend): add claude process manager for subprocess lifecycle`
  - Files: `src-tauri/src/claude_process_manager.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

---

- [ ] 4. Claude Bridge (NDJSON event parser + status mapping + Tauri event emitter)

  **What to do**:
  - Create new file `src-tauri/src/claude_bridge.rs`
  - Define `ClaudeBridgeManager` struct with `bridges: Arc<Mutex<HashMap<String, BridgeHandle>>>` — mirrors `SseBridgeManager`
  - Define private `BridgeHandle` struct with `cancel_tx: tokio::sync::oneshot::Sender<()>`
  - Implement methods:
    1. `pub fn new() -> Self`
    2. `pub async fn start_bridge(&self, app: AppHandle, task_id: String, stdout: tokio::process::ChildStdout) -> Result<(), ClaudeBridgeError>`
       - Spawn a tokio task that reads stdout line-by-line (`BufReader::new(stdout).lines()`)
       - Each line is a JSON object — parse with `serde_json::from_str::<serde_json::Value>`
       - Extract `type` field from each JSON object to determine event type
       - **Status mapping** (from JSON `type` field to app session status):
         - `"system"` with `subtype: "init"` → Extract `session_id` from `properties.session_id`, store it via `set_agent_session_claude_id()`, set status `"running"`
         - Any `"assistant"` or `"tool_use"` or `"tool_result"` → status stays `"running"`, emit `agent-event` with event_type matching the JSON type
         - `"result"` with `subtype: "success"` → call `persist_session_completed()` pattern, emit `action-complete` event
         - `"result"` with `subtype: "error_max_turns"` or `"error_tool_fail"` or any error → set status `"failed"`, emit `implementation-failed`
       - When stdout EOF reached without a `result` event: set session status to `"interrupted"` (process was killed)
       - **Emit events** using the SAME `AgentEventPayload` struct from `sse_bridge.rs` — import it, don't recreate
       - Use the same `CompletionPayload` and `FailurePayload` from `sse_bridge.rs`
    3. `pub async fn stop_bridge(&self, task_id: &str)`
       - Send cancel signal, remove from HashMap
    4. `pub async fn stop_all(&self)`
  - Add `mod claude_bridge;` to `main.rs`
  - Persist session status changes to DB (same pattern as `sse_bridge.rs` `persist_session_completed`)

  **Must NOT do**:
  - Do NOT create new event payload structs — reuse `AgentEventPayload`, `CompletionPayload`, `FailurePayload` from `sse_bridge.rs`
  - Do NOT change the `AgentEventPayload` struct shape
  - Do NOT connect to any HTTP/SSE endpoint — this reads from a piped stdout

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Core integration module with async streaming, JSON parsing, event mapping, DB persistence — complex error handling required
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2, with Tasks 5, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 7, 8
  - **Blocked By**: Tasks 1 (DB schema for claude_session_id), 3 (process manager provides stdout)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/sse_bridge.rs:1-100` — `SseBridgeManager` struct, `BridgeHandle`, error types — CLONE this structure
  - `src-tauri/src/sse_bridge.rs:73-82` — `persist_session_completed()` helper — reuse directly or clone pattern
  - `src-tauri/src/sse_bridge.rs:43-67` — `AgentEventPayload`, `CompletionPayload`, `FailurePayload` — IMPORT these, don't recreate

  **API/Type References** (contracts to implement against):
  - Input: `tokio::process::ChildStdout` from `claude_process_manager.rs` (Task 3)
  - Output events: `agent-event` (with `AgentEventPayload`), `action-complete` (with `CompletionPayload`), `implementation-failed` (with `FailurePayload`)
  - DB operations: `set_agent_session_claude_id()`, `update_agent_session()` from `db/agents.rs`

  **External References**:
  - Claude Code stream-json format: NDJSON lines with `type` field. Key types: `system` (init), `assistant` (text), `tool_use` (tool calls), `tool_result` (tool output), `result` (final outcome)
  - Example: `{"type":"system","subtype":"init","session_id":"abc123","tools":[...]}`
  - Example: `{"type":"result","subtype":"success","cost_usd":0.05,"duration_ms":30000,"session_id":"abc123"}`

  **WHY Each Reference Matters**:
  - `sse_bridge.rs:1-100`: The structural pattern to mirror — same Manager/Handle/Error pattern ensures consistency and makes the two bridges interchangeable from orchestration's perspective
  - `sse_bridge.rs:43-67`: MUST reuse these exact structs so the frontend receives identical event shapes regardless of provider
  - `sse_bridge.rs:73-82`: DB persistence pattern — same approach ensures session status is always persisted as source of truth

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] Module declared in `main.rs`
  - [ ] Reuses `AgentEventPayload` from `sse_bridge.rs` (no duplicate struct)
  - [ ] Handles EOF-without-result as "interrupted" status
  - [ ] Emits `action-complete` on `result.success`
  - [ ] Emits `implementation-failed` on `result.error_*`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Bridge compiles and reuses SSE bridge types
    Tool: Bash
    Preconditions: Tasks 1, 3 completed
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Grep `claude_bridge.rs` for `use crate::sse_bridge::AgentEventPayload` — verify it imports, not recreates
      3. Grep for `pub struct AgentEventPayload` — verify it appears ONLY in sse_bridge.rs (not duplicated)
    Expected Result: Clean build, single definition of AgentEventPayload in sse_bridge.rs, imported in claude_bridge.rs
    Failure Indicators: Compile error, duplicate struct definition, missing import
    Evidence: .sisyphus/evidence/task-4-compile.txt

  Scenario: Event mapping covers all Claude event types
    Tool: Bash
    Preconditions: Code is compiled
    Steps:
      1. Read `claude_bridge.rs` and verify match arms exist for: `system` (init), `assistant`, `tool_use`, `tool_result`, `result` (success + error variants)
      2. Verify EOF handling sets status to "interrupted"
      3. Verify `session_id` is extracted from `system.init` event
    Expected Result: All 5 event types handled, EOF handled, session_id captured
    Failure Indicators: Missing match arm, no EOF handling, session_id not captured
    Evidence: .sisyphus/evidence/task-4-event-mapping.txt
  ```

  **Commit**: YES (group with Wave 2)
  - Message: `feat(backend): add claude bridge for stream-json event parsing`
  - Files: `src-tauri/src/claude_bridge.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

---

- [ ] 5. Frontend Types + IPC Wrappers for Claude Code

  **What to do**:
  - Update `src/lib/types.ts`:
    - Add `claude_session_id: string | null` and `provider: string` fields to the `AgentSession` interface
    - Add new interface `ClaudeInstallStatus { installed: boolean; path: string | null; version: string | null; authenticated: boolean }`
  - Update `src/lib/ipc.ts`:
    - Add `checkClaudeInstalled()` wrapper (if not already added by Task 2 — coordinate)
    - Verify existing `spawnPty` IPC can handle the new PTY variant (it should — Task 9 handles backend)
  - NO changes needed to event listeners — `AgentEventPayload` shape is unchanged, frontend already listens to `agent-event`, `action-complete`, `implementation-failed`

  **Must NOT do**:
  - Do NOT change any existing interface field names
  - Do NOT create separate Claude-specific event types on the frontend — the bridge ensures compatibility

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding 2 fields to an interface + 1 new interface + 1 IPC wrapper is trivial
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: No UI changes in this task

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2, with Tasks 4, 6)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: None (types can be added independently)

  **References**:

  **Pattern References** (existing code to follow):
  - `src/lib/types.ts:16-26` — `AgentSession` interface to extend with new fields
  - `src/lib/ipc.ts:119-121` — `checkOpenCodeInstalled()` pattern to clone

  **WHY Each Reference Matters**:
  - `types.ts:16-26`: The interface that maps 1:1 to `AgentSessionRow` in Rust — must stay in sync
  - `ipc.ts:119-121`: Exact invoke wrapper pattern to follow

  **Acceptance Criteria**:
  - [ ] `pnpm build` → compiles cleanly (TypeScript strict mode)
  - [ ] `AgentSession` has `provider: string` and `claude_session_id: string | null`
  - [ ] `ClaudeInstallStatus` interface exists
  - [ ] `checkClaudeInstalled()` IPC wrapper exists

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TypeScript compiles with new types
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run `pnpm build` — verify clean compilation
      2. Grep `types.ts` for `provider: string` in AgentSession
      3. Grep `types.ts` for `ClaudeInstallStatus`
      4. Grep `ipc.ts` for `checkClaudeInstalled`
    Expected Result: Build succeeds, all 3 additions found
    Failure Indicators: TypeScript errors, missing types
    Evidence: .sisyphus/evidence/task-5-ts-build.txt

  Scenario: Existing frontend tests still pass
    Tool: Bash
    Preconditions: Types updated
    Steps:
      1. Run `pnpm test` — verify all existing tests pass
    Expected Result: 0 failures — new optional fields with `| null` don't break existing code
    Failure Indicators: Test failures mentioning new fields
    Evidence: .sisyphus/evidence/task-5-test-regression.txt
  ```

  **Commit**: YES (group with Wave 2)
  - Message: `feat(frontend): add claude code types and IPC wrappers`
  - Files: `src/lib/types.ts`, `src/lib/ipc.ts`
  - Pre-commit: `pnpm build`

---

- [ ] 6. DB Operations for New Columns

  **What to do**:
  - Add method to `src-tauri/src/db/agents.rs`:
    - `pub fn get_sessions_by_provider(&self, provider: &str) -> Result<Vec<AgentSessionRow>>` — query sessions filtered by provider column
    - `pub fn get_running_claude_sessions(&self) -> Result<Vec<AgentSessionRow>>` — returns sessions where `provider = 'claude-code' AND status = 'running'` (used by startup resume in Task 13)
  - Update `mark_running_sessions_interrupted` to be provider-aware: mark ALL running sessions as interrupted (both providers), not just OpenCode ones. The existing behavior already does this since it doesn't filter by provider. Just verify the new `provider` column doesn't cause issues.
  - Add unit test `test_get_sessions_by_provider` — creates sessions with both providers, queries each, asserts correct filtering
  - Add unit test `test_get_running_claude_sessions` — creates running + completed Claude sessions, verifies only running ones returned

  **Must NOT do**:
  - Do NOT modify existing method signatures (except `create_agent_session` which was updated in Task 1)
  - Do NOT filter `mark_running_sessions_interrupted` by provider — ALL running sessions should be interrupted on startup

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple SQL queries following existing patterns
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 2, with Tasks 4, 5)
  - **Parallel Group**: Wave 2
  - **Blocks**: Tasks 7, 8, 13
  - **Blocked By**: Task 1 (DB schema must exist first)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/db/agents.rs:79-100` — `get_agent_session` query pattern — clone and add `WHERE provider = ?`
  - `src-tauri/src/db/agents.rs` bottom — existing test patterns

  **WHY Each Reference Matters**:
  - `agents.rs:79-100`: The exact query + struct mapping pattern to follow for new queries

  **Acceptance Criteria**:
  - [ ] `cargo test test_get_sessions_by_provider` → PASS
  - [ ] `cargo test test_get_running_claude_sessions` → PASS
  - [ ] `cargo test` → all existing tests still pass

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Provider filtering works correctly
    Tool: Bash
    Preconditions: Task 1 completed (schema exists)
    Steps:
      1. Run `cargo test test_get_sessions_by_provider -- --nocapture`
      2. Verify test creates sessions with both 'opencode' and 'claude-code' providers
      3. Verify each query returns only matching sessions
    Expected Result: Test passes with correct filtering
    Failure Indicators: Test failure, wrong session count
    Evidence: .sisyphus/evidence/task-6-provider-filter.txt

  Scenario: Running Claude sessions query
    Tool: Bash
    Preconditions: Task 1 completed
    Steps:
      1. Run `cargo test test_get_running_claude_sessions -- --nocapture`
    Expected Result: Only running claude-code sessions returned, not completed ones or opencode ones
    Failure Indicators: Wrong results
    Evidence: .sisyphus/evidence/task-6-running-claude.txt
  ```

  **Commit**: YES (group with Wave 2)
  - Message: `feat(db): add provider-aware session queries`
  - Files: `src-tauri/src/db/agents.rs`
  - Pre-commit: `cargo test`

---

- [ ] 7. Orchestration: Provider-aware `start_implementation` + `run_action`

  **What to do**:
  - Modify `src-tauri/src/commands/orchestration.rs`:
  - At the start of both `start_implementation` and `run_action`, read the global provider setting from DB: `db.get_config("ai_provider")` — default to `"opencode"` if not set
  - Add an `if provider == "claude-code"` branch in both commands that:
    **For `start_implementation` (Claude Code path):**
    1. Create git worktree (same as existing)
    2. Create worktree record in DB (same as existing)
    3. Do NOT spawn OpenCode server (skip `server_mgr.spawn_server`)
    4. Do NOT create OpenCode session (skip `client.create_session`)
    5. Build prompt using existing `build_task_prompt()` function
    6. Spawn Claude process: `claude_process_mgr.spawn_claude(task_id, worktree_path, prompt)`
    7. Start Claude bridge: `claude_bridge_mgr.start_bridge(app, task_id, stdout)`
    8. Create agent session with `provider: "claude-code"` and `opencode_session_id: None`
    9. Update task status to `"doing"`
    10. Return same JSON shape: `{ task_id, worktree_path, port: 0, session_id }`
    **For `run_action` (Claude Code path):**
    1. Check existing session — if `provider == "claude-code"` on the session:
       - If `status == "running"`: return "Agent is busy"
       - If `status == "completed" | "failed" | "interrupted"` AND `claude_session_id` exists:
         - Spawn Claude with `--resume claude_session_id` and new prompt
         - Start bridge with new stdout
         - Update session status to `"running"`
    2. If no existing session or no claude_session_id, fall through to new start (same as start_implementation Claude path but reuse worktree)
  - The `else` branch keeps ALL existing OpenCode logic UNCHANGED
  - Update function signatures to accept new State params: `claude_process_mgr: State<'_, ClaudeProcessManager>` and `claude_bridge_mgr: State<'_, ClaudeBridgeManager>`

  **Must NOT do**:
  - Do NOT create a provider trait/interface — plain if/else branching
  - Do NOT modify any OpenCode-path logic — the else branch must be identical to current code
  - Do NOT change function return types or remove existing parameters

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Critical integration point — must carefully branch between two providers while preserving existing logic exactly
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3, with Tasks 8, 9, 10, 11)
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 9, 12, 14
  - **Blocked By**: Tasks 2, 3, 4, 6

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/commands/orchestration.rs:71-180` — Current `start_implementation` — the OpenCode path to preserve in `else` branch
  - `src-tauri/src/commands/orchestration.rs:182-373` — Current `run_action` — the OpenCode path with session reuse logic
  - `src-tauri/src/commands/orchestration.rs:5-27` — `build_task_prompt` — reuse as-is for both providers

  **API/Type References** (contracts to implement against):
  - `claude_process_manager.rs` `spawn_claude()` returns `(pid, stdout)` — pass `stdout` to bridge
  - `claude_bridge.rs` `start_bridge(app, task_id, stdout)` — starts event processing
  - `db/agents.rs` `create_agent_session()` now accepts `provider` param (Task 1)

  **WHY Each Reference Matters**:
  - `orchestration.rs:71-180`: This is the code being branched — Claude path mirrors it but replaces server/client/SSE with process/bridge
  - `orchestration.rs:182-373`: The `run_action` session-reuse logic is complex — Claude variant must handle `--resume` instead of `prompt_async`

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] OpenCode path code unchanged (diff should show only additions, no deletions in OpenCode sections)
  - [ ] Claude path spawns process and starts bridge
  - [ ] Session created with `provider: "claude-code"`
  - [ ] `run_action` with existing Claude session uses `--resume`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Orchestration compiles with both code paths
    Tool: Bash
    Preconditions: Tasks 1-4, 6 completed
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Run `cargo test` — verify existing orchestration tests still pass
      3. Grep orchestration.rs for `"claude-code"` — verify branch exists
      4. Grep orchestration.rs for `claude_process_mgr.spawn_claude` — verify spawn call
      5. Grep orchestration.rs for `claude_bridge_mgr.start_bridge` — verify bridge call
    Expected Result: Compiles, tests pass, both provider paths exist
    Failure Indicators: Compile error, test failure, missing Claude branch
    Evidence: .sisyphus/evidence/task-7-orchestration-compile.txt

  Scenario: OpenCode path preserved exactly
    Tool: Bash
    Preconditions: Code compiled
    Steps:
      1. Run existing orchestration tests: `cargo test test_build_task_prompt` — all 6 tests
      2. Verify no `server_mgr` or `sse_mgr` calls were removed from the else branch
    Expected Result: All existing prompt tests pass, OpenCode logic unchanged
    Failure Indicators: Test failures, missing OpenCode calls in else branch
    Evidence: .sisyphus/evidence/task-7-opencode-preserved.txt
  ```

  **Commit**: YES (group with Wave 3)
  - Message: `feat(orchestration): add claude code provider branching in start_implementation and run_action`
  - Files: `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cargo test`

---

- [ ] 8. Orchestration: Provider-aware `abort_implementation`

  **What to do**:
  - Modify `abort_task_agent()` helper and `abort_implementation` command in `src-tauri/src/commands/orchestration.rs`:
  - Read the latest session for the task, check its `provider` field
  - If `provider == "claude-code"`:
    1. Kill Claude process: `claude_process_mgr.kill_process(task_id)`
    2. Stop Claude bridge: `claude_bridge_mgr.stop_bridge(task_id)`
    3. Update session status to `"failed"` with error "Aborted by user" (same as OpenCode path)
    4. Update worktree status to `"stopped"`
  - Else (OpenCode): keep existing logic unchanged
  - Update `abort_task_agent` signature to accept `claude_process_mgr: &State<'_, ClaudeProcessManager>` and `claude_bridge_mgr: &State<'_, ClaudeBridgeManager>`
  - Update `abort_implementation` to pass the new state params through

  **Must NOT do**:
  - Do NOT modify the OpenCode abort path
  - Do NOT remove the PTY kill call — it should still kill PTY for both providers

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Modifying existing function with careful branching, but less complex than Task 7
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 3, 4, 6

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/commands/orchestration.rs:29-68` — Current `abort_task_agent` — OpenCode abort flow to preserve
  - `src-tauri/src/commands/orchestration.rs:375-386` — Current `abort_implementation` command

  **WHY Each Reference Matters**:
  - `orchestration.rs:29-68`: The abort flow that must be branched — Claude path replaces `client.abort_session` + `sse_mgr.stop_bridge` + `server_mgr.stop_server` with `claude_process_mgr.kill_process` + `claude_bridge_mgr.stop_bridge`

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] Claude abort kills process and stops bridge
  - [ ] OpenCode abort unchanged
  - [ ] PTY kill runs for both providers

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Abort compiles with both paths
    Tool: Bash
    Preconditions: Task 7 completed (orchestration already updated)
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Grep abort_task_agent for provider check
      3. Verify `pty_mgr.kill_pty` is called regardless of provider (in abort_implementation)
    Expected Result: Both paths exist, PTY kill unconditional
    Failure Indicators: Missing provider branch, PTY kill removed
    Evidence: .sisyphus/evidence/task-8-abort.txt
  ```

  **Commit**: YES (group with Wave 3)
  - Message: `feat(orchestration): add claude code abort support`
  - Files: `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cargo build`

---

- [ ] 9. PTY Manager: Claude Code Terminal Spawn

  **What to do**:
  - Add a new method to `PtyManager` in `src-tauri/src/pty_manager.rs`:
    ```
    pub async fn spawn_claude_pty(
        &self,
        task_id: &str,
        worktree_path: &Path,
        claude_session_id: &str,
        cols: u16,
        rows: u16,
        app_handle: tauri::AppHandle,
    ) -> Result<u64, PtyError>
    ```
  - This method spawns `claude --resume <claude_session_id>` in a PTY (interactive TUI mode)
  - Use `current_dir(worktree_path)` on the command
  - Follow exact same PTY setup pattern as `spawn_pty`: native_pty_system, PtySize, CommandBuilder, env setup, spawn, reader/writer, PID file, stdout bridge task
  - The command is different: `CommandBuilder::new("claude")` with args: `--resume`, `<claude_session_id>`
  - No `--output-format`, no `--verbose`, no `-p` — this is interactive mode
  - Update `src-tauri/src/commands/pty.rs` to add a new command:
    ```
    #[tauri::command]
    pub async fn pty_spawn_claude(
        pty_mgr: State<'_, PtyManager>,
        app: tauri::AppHandle,
        task_id: String,
        worktree_path: String,
        claude_session_id: String,
        cols: u16,
        rows: u16,
    ) -> Result<u64, String>
    ```
  - Register `commands::pty::pty_spawn_claude` in `main.rs` `generate_handler!`
  - Add IPC wrapper in `src/lib/ipc.ts`: `spawnClaudePty(taskId, worktreePath, claudeSessionId, cols, rows): Promise<number>`

  **Must NOT do**:
  - Do NOT modify existing `spawn_pty` method
  - Do NOT use `--output-format stream-json` in PTY mode — this is interactive TUI
  - Do NOT remove or change `opencode_session_id` parameter from existing `spawn_pty`

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Cloning existing PTY spawn with different command args — moderate complexity
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 3, 7

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/pty_manager.rs:92-179` — `spawn_pty` method — CLONE this entire method, change the command from `opencode attach` to `claude --resume`
  - `src-tauri/src/commands/pty.rs:4-18` — `pty_spawn` command — clone for `pty_spawn_claude` with different params

  **API/Type References** (contracts to implement against):
  - `src/lib/ipc.ts:187-189` — `spawnPty` IPC wrapper — clone for `spawnClaudePty`

  **WHY Each Reference Matters**:
  - `pty_manager.rs:92-179`: The PTY spawn code to clone — same PTY pair setup, same env, same reader/writer, same PID file — only the command changes
  - `commands/pty.rs:4-18`: The Tauri command wrapper pattern — new command needs different params (worktree_path + claude_session_id instead of server_port + opencode_session_id)

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] `spawn_claude_pty` exists with correct signature
  - [ ] `pty_spawn_claude` command registered in `main.rs`
  - [ ] IPC wrapper `spawnClaudePty` exists in `ipc.ts`
  - [ ] Existing `spawn_pty` method unchanged

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PTY command compiles and is registered
    Tool: Bash
    Preconditions: Tasks 3, 7 completed
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Grep main.rs for `pty_spawn_claude` — verify registered
      3. Grep pty_manager.rs for `spawn_claude_pty` — verify method exists
      4. Grep ipc.ts for `spawnClaudePty` — verify IPC wrapper exists
      5. Verify `spawn_claude_pty` command uses `CommandBuilder::new("claude")` with `--resume` arg
    Expected Result: All registrations present, correct command construction
    Failure Indicators: Missing registration, wrong command args
    Evidence: .sisyphus/evidence/task-9-pty-claude.txt

  Scenario: Existing PTY spawn unmodified
    Tool: Bash
    Preconditions: Code compiled
    Steps:
      1. Verify `spawn_pty` method signature unchanged (still takes server_port + opencode_session_id)
      2. Run `pnpm test` — verify AgentPanel PTY tests still pass
    Expected Result: Existing method intact, tests pass
    Failure Indicators: Signature change, test failure
    Evidence: .sisyphus/evidence/task-9-existing-pty.txt
  ```

  **Commit**: YES (group with Wave 3)
  - Message: `feat(pty): add claude code interactive terminal spawn`
  - Files: `src-tauri/src/pty_manager.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/main.rs`, `src/lib/ipc.ts`
  - Pre-commit: `cargo build && pnpm build`

---

- [ ] 10. `main.rs`: Register Claude State, Startup Cleanup, Shutdown

  **What to do**:
  - In `src-tauri/src/main.rs` `.setup()` closure:
    1. Create `ClaudeProcessManager::new()` and `ClaudeBridgeManager::new()`
    2. `app.manage(claude_process_manager)` and `app.manage(claude_bridge_manager)`
    3. Add PID cleanup: `ClaudeProcessManager::new().cleanup_stale_pids()` (same pattern as line 177-183)
  - In the `RunEvent::Exit` handler:
    1. Get `claude_process_mgr` from state
    2. Get `claude_bridge_mgr` from state
    3. Add `claude_bridge_mgr.stop_all().await` after SSE bridge stop
    4. Add `claude_process_mgr.kill_all().await` after bridge stop
  - Order in shutdown: PTY → SSE Bridge → Claude Bridge → OpenCode Servers → Claude Processes

  **Must NOT do**:
  - Do NOT change existing state registrations or shutdown order for OpenCode components
  - Do NOT remove any existing shutdown steps

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Mechanical additions to main.rs following existing patterns exactly
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14
  - **Blocked By**: Task 3 (ClaudeProcessManager must exist)

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/main.rs:164-175` — State registration pattern (manage calls)
  - `src-tauri/src/main.rs:177-183` — PID cleanup pattern on startup
  - `src-tauri/src/main.rs:290-311` — Shutdown handler with ordered cleanup

  **WHY Each Reference Matters**:
  - `main.rs:164-175`: Where to add new manage() calls — after existing managers
  - `main.rs:177-183`: Stale PID cleanup pattern to clone for Claude PIDs
  - `main.rs:290-311`: Shutdown order — must add Claude cleanup in correct position

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] `ClaudeProcessManager` and `ClaudeBridgeManager` registered as state
  - [ ] Stale PID cleanup runs on startup
  - [ ] Shutdown handler kills Claude processes and stops bridges

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: State registration and shutdown integration
    Tool: Bash
    Preconditions: Task 3 (process manager) and Task 4 (bridge) completed
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Grep main.rs for `claude_process_manager` — verify state registration
      3. Grep main.rs for `claude_bridge_manager` — verify state registration
      4. Grep main.rs for `cleanup_stale_pids` — verify appears twice (server + claude)
      5. Grep main.rs for `kill_all` in shutdown handler — verify Claude cleanup present
    Expected Result: Both managers registered, both cleanups present
    Failure Indicators: Missing registrations, missing cleanup
    Evidence: .sisyphus/evidence/task-10-main-setup.txt
  ```

  **Commit**: YES (group with Wave 3)
  - Message: `feat(app): register claude managers and add shutdown cleanup`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

---

- [ ] 11. Frontend: Global Settings Provider Dropdown + Check Installed Status

  **What to do**:
  - Modify `src/components/GlobalSettingsPanel.svelte`:
    1. Add new section "AI Provider" between existing sections
    2. Add a `<select>` dropdown with options: "OpenCode" (value: `opencode`) and "Claude Code" (value: `claude-code`)
    3. Load current value on mount: `aiProvider = (await getConfig('ai_provider')) || 'opencode'`
    4. Save on save: `await setConfig('ai_provider', aiProvider)`
    5. Below the dropdown, show install status:
       - Call `checkOpenCodeInstalled()` and `checkClaudeInstalled()` on mount
       - Show green checkmark + version for installed provider, red X for not installed
       - For Claude Code, also show auth status ("Authenticated" / "Not authenticated")
    6. If selected provider is not installed, show a warning message

  **Must NOT do**:
  - Do NOT add per-project or per-task provider selection
  - Do NOT add auth management (login/logout buttons)
  - Do NOT add cost tracking display
  - Do NOT add Claude API key input field

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: UI component updates with async data loading and conditional rendering — moderate frontend work
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Settings panel UI with status indicators, dropdown, warning messages
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed — QA uses code inspection, not browser testing for this settings panel

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 3)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 2, 5

  **References**:

  **Pattern References** (existing code to follow):
  - `src/components/GlobalSettingsPanel.svelte:1-97` — ENTIRE file — existing settings panel structure with sections, load/save pattern, state variables
  - `src/components/GlobalSettingsPanel.svelte:22-31` — `loadConfig()` pattern to extend
  - `src/components/GlobalSettingsPanel.svelte:33-48` — `save()` pattern to extend

  **API/Type References** (contracts to implement against):
  - `src/lib/ipc.ts` — `getConfig('ai_provider')`, `setConfig('ai_provider', value)`, `checkClaudeInstalled()`, `checkOpenCodeInstalled()`
  - `src/lib/types.ts` — `ClaudeInstallStatus` interface (added in Task 5)

  **WHY Each Reference Matters**:
  - `GlobalSettingsPanel.svelte`: The file being modified — must match existing section layout, daisyUI classes, load/save flow

  **Acceptance Criteria**:
  - [ ] `pnpm build` → compiles cleanly
  - [ ] Dropdown renders with 2 options (OpenCode, Claude Code)
  - [ ] Provider setting loads on mount and saves on save
  - [ ] Install status shown for both providers

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Settings panel compiles with new section
    Tool: Bash
    Preconditions: Tasks 2, 5 completed
    Steps:
      1. Run `pnpm build` — verify clean compile
      2. Grep GlobalSettingsPanel.svelte for `ai_provider` — verify config key used
      3. Grep GlobalSettingsPanel.svelte for `checkClaudeInstalled` — verify status check
      4. Grep GlobalSettingsPanel.svelte for `<select` or `select` — verify dropdown exists
    Expected Result: Compiles, all new elements present
    Failure Indicators: TypeScript errors, missing elements
    Evidence: .sisyphus/evidence/task-11-settings.txt

  Scenario: Existing settings still functional
    Tool: Bash
    Preconditions: New section added
    Steps:
      1. Run `pnpm test` — verify all existing tests pass
      2. Verify JIRA and GitHub sections still present in GlobalSettingsPanel.svelte
    Expected Result: No regressions in existing settings
    Failure Indicators: Test failures, missing sections
    Evidence: .sisyphus/evidence/task-11-regression.txt
  ```

  **Commit**: YES (group with Wave 3)
  - Message: `feat(settings): add AI provider dropdown with install status`
  - Files: `src/components/GlobalSettingsPanel.svelte`
  - Pre-commit: `pnpm build`

---

- [ ] 12. Frontend: AgentPanel PTY Bridge for Claude Code

  **What to do**:
  - Modify `src/lib/usePtyBridge.svelte.ts`:
    - The current `attachPty` reads `opencode_port` from worktree and calls `spawnPty(taskId, port, sessionId, cols, rows)`
    - Add provider-aware logic: accept a `provider` parameter in the `createPtyBridge` deps or determine it from the session
    - If `provider === 'claude-code'`:
      1. Get the `claude_session_id` from the session (passed in or fetched)
      2. Get `worktree_path` from worktree record
      3. Call `spawnClaudePty(taskId, worktreePath, claudeSessionId, cols, rows)` instead of `spawnPty`
    - If `provider === 'opencode'` (or default): keep existing behavior unchanged
  - Update `createPtyBridge` deps interface:
    - Add optional `provider?: string` and `claudeSessionId?: string` and `worktreePath?: string`
    - The `setOpencodePort` callback is only called for OpenCode provider
  - Update consumer(s) that call `createPtyBridge` to pass provider info from the `AgentSession`
  - Minimal changes — the PTY bridge pattern (output listener, exit listener, kill, dispose) stays exactly the same regardless of provider

  **Must NOT do**:
  - Do NOT change the PTY output/exit event format — both `spawn_pty` and `spawn_claude_pty` emit the same events
  - Do NOT break existing OpenCode PTY flow
  - Do NOT remove `setOpencodePort` callback

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Modifying a reactive composable with careful branching — must preserve existing reactive behavior
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Understanding Svelte 5 composable patterns and reactive state

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 4, with Tasks 13, 14)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 5, 9

  **References**:

  **Pattern References** (existing code to follow):
  - `src/lib/usePtyBridge.svelte.ts:1-100` — ENTIRE file — current PTY bridge composable
  - `src/lib/usePtyBridge.svelte.ts:48-75` — `attachPty` method — the function to branch
  - `src/lib/ipc.ts:187-189` — `spawnPty` call to keep for OpenCode, `spawnClaudePty` for Claude (added in Task 9)

  **API/Type References** (contracts to implement against):
  - `src/lib/types.ts` — `AgentSession` with `provider` and `claude_session_id` fields (added in Task 5)
  - `src/lib/ipc.ts` — `spawnClaudePty(taskId, worktreePath, claudeSessionId, cols, rows)` (added in Task 9)

  **WHY Each Reference Matters**:
  - `usePtyBridge.svelte.ts:48-75`: The exact function being branched — Claude path calls different IPC but same PTY listeners
  - `ipc.ts:187-189`: Shows current PTY spawn call — Claude variant has different params

  **Acceptance Criteria**:
  - [ ] `pnpm build` → compiles cleanly
  - [ ] `pnpm test` → existing PTY bridge tests still pass
  - [ ] Claude path calls `spawnClaudePty` with correct params
  - [ ] OpenCode path unchanged

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: PTY bridge compiles with provider branching
    Tool: Bash
    Preconditions: Tasks 5, 9 completed
    Steps:
      1. Run `pnpm build` — verify clean compile
      2. Run `pnpm test` — verify existing tests pass
      3. Grep usePtyBridge.svelte.ts for `spawnClaudePty` — verify Claude branch exists
      4. Grep usePtyBridge.svelte.ts for `spawnPty` — verify OpenCode branch preserved
    Expected Result: Both branches exist, tests pass
    Failure Indicators: Compile error, test failure, missing branch
    Evidence: .sisyphus/evidence/task-12-pty-bridge.txt

  Scenario: Existing PTY bridge tests pass
    Tool: Bash
    Preconditions: Code updated
    Steps:
      1. Run `pnpm vitest run src/lib/usePtyBridge.test.ts`
    Expected Result: All existing tests pass (ptySpawned behavior, kill, attach)
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-12-pty-test.txt
  ```

  **Commit**: YES (group with Wave 4)
  - Message: `feat(frontend): add claude code PTY bridge support`
  - Files: `src/lib/usePtyBridge.svelte.ts`
  - Pre-commit: `pnpm test`

---

- [ ] 13. Startup Resume Handling for Claude Code Tasks

  **What to do**:
  - Modify `resume_task_servers` in `src-tauri/src/main.rs`:
    - Currently resumes OpenCode servers for all active worktrees
    - Add provider-aware logic:
      1. For each resumable worktree, check the latest session's `provider` field
      2. If `provider == "opencode"`: existing logic (spawn server, start SSE bridge)
      3. If `provider == "claude-code"`: mark session as `"interrupted"` (Claude processes don't survive app restart)
         - Emit a `server-resumed` event with `{ task_id, port: 0 }` so frontend knows the worktree exists but Claude needs to be re-triggered
  - The rationale: Claude Code processes are ephemeral. When the app restarts, Claude subprocess is gone. The session persists on disk (Claude's own persistence), so user can re-run with `--resume` via `run_action`.
  - Add `get_session_provider` helper or inline the DB query

  **Must NOT do**:
  - Do NOT try to resume Claude Code processes on startup (they're dead after app restart)
  - Do NOT remove the worktree or mark the task as done — the worktree is still valid for re-running

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple provider check and branch in existing function
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES (within Wave 4)
  - **Parallel Group**: Wave 4
  - **Blocks**: Task 14
  - **Blocked By**: Tasks 3, 6

  **References**:

  **Pattern References** (existing code to follow):
  - `src-tauri/src/main.rs:31-107` — `resume_task_servers` function — the function to modify with provider branching

  **API/Type References** (contracts to implement against):
  - `src-tauri/src/db/agents.rs` — `get_latest_session_for_ticket(task_id)` returns `AgentSessionRow` with `provider` field (from Task 1)

  **WHY Each Reference Matters**:
  - `main.rs:31-107`: The startup resume logic — must branch on provider before attempting to spawn OpenCode server

  **Acceptance Criteria**:
  - [ ] `cargo build` → compiles cleanly
  - [ ] OpenCode worktrees still get server resumed
  - [ ] Claude Code worktrees get sessions marked as interrupted
  - [ ] No crash if session has `provider == "claude-code"`

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Startup resume handles both providers
    Tool: Bash
    Preconditions: Tasks 3, 6 completed
    Steps:
      1. Run `cargo build` — verify clean compile
      2. Grep resume_task_servers for `provider` or `claude-code` — verify branching exists
      3. Verify OpenCode branch still calls `spawn_server` and `start_bridge`
      4. Verify Claude branch marks session as `interrupted`
    Expected Result: Both paths exist, correct behavior for each
    Failure Indicators: Missing branch, trying to spawn OpenCode server for Claude task
    Evidence: .sisyphus/evidence/task-13-resume.txt
  ```

  **Commit**: YES (group with Wave 4)
  - Message: `feat(startup): handle claude code task resume gracefully`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

---

- [ ] 14. Full Regression Test (cargo test + pnpm test + build)

  **What to do**:
  - Run full test and build suite to verify zero regressions:
    1. `cargo build --release` — must succeed
    2. `cargo test` — all tests must pass, including new tests from Tasks 1, 6
    3. `pnpm build` — TypeScript compilation must succeed
    4. `pnpm test` — all frontend tests must pass, including any new tests
  - If any test fails, identify the regression and fix it
  - Verify no warnings about unused imports, dead code, or unused variables in new modules
  - Run `cargo clippy` if available for additional lint checks
  - Verify the complete list of new files:
    - `src-tauri/src/claude_process_manager.rs` (Task 3)
    - `src-tauri/src/claude_bridge.rs` (Task 4)
  - Verify all modifications:
    - `src-tauri/src/db/mod.rs` (Task 1)
    - `src-tauri/src/db/agents.rs` (Tasks 1, 6)
    - `src-tauri/src/commands/config.rs` (Task 2)
    - `src-tauri/src/commands/orchestration.rs` (Tasks 7, 8)
    - `src-tauri/src/commands/pty.rs` (Task 9)
    - `src-tauri/src/pty_manager.rs` (Task 9)
    - `src-tauri/src/main.rs` (Tasks 2, 3, 4, 9, 10, 13)
    - `src/lib/types.ts` (Task 5)
    - `src/lib/ipc.ts` (Tasks 2, 5, 9)
    - `src/lib/usePtyBridge.svelte.ts` (Task 12)
    - `src/components/GlobalSettingsPanel.svelte` (Task 11)

  **Must NOT do**:
  - Do NOT skip any failing test — fix the regression
  - Do NOT add `#[allow(unused)]` or `@ts-ignore` to suppress warnings

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Comprehensive verification requiring build + test + manual review
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO (must run after all other tasks)
  - **Parallel Group**: Sequential (after Tasks 7-13)
  - **Blocks**: F1-F4 (Final Verification)
  - **Blocked By**: Tasks 7, 8, 9, 10, 11, 12, 13

  **References**:

  **Pattern References**:
  - All files listed above — review each for compilation issues

  **Acceptance Criteria**:
  - [ ] `cargo build --release` → SUCCESS
  - [ ] `cargo test` → ALL PASS (0 failures)
  - [ ] `pnpm build` → SUCCESS
  - [ ] `pnpm test` → ALL PASS (0 failures)
  - [ ] No compiler warnings about new code (unused imports, dead code)

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Full build and test suite passes
    Tool: Bash
    Preconditions: All tasks 1-13 completed
    Steps:
      1. Run `cargo build --release` — capture output
      2. Run `cargo test` — capture output, count pass/fail
      3. Run `pnpm build` — capture output
      4. Run `pnpm test` — capture output, count pass/fail
    Expected Result: 0 errors, 0 failures across all commands
    Failure Indicators: Any error or test failure
    Evidence: .sisyphus/evidence/task-14-full-regression.txt

  Scenario: No compiler warnings in new modules
    Tool: Bash
    Preconditions: Build succeeds
    Steps:
      1. Run `cargo build 2>&1` and check for warnings mentioning claude_process_manager or claude_bridge
      2. Run `pnpm build 2>&1` and check for TypeScript warnings
    Expected Result: Zero warnings related to new code
    Failure Indicators: Unused imports, dead code, type mismatches
    Evidence: .sisyphus/evidence/task-14-warnings.txt
  ```

  **Commit**: YES (final commit)
  - Message: `chore: verify full build and test regression for claude code integration`
  - Files: any fixes needed
  - Pre-commit: `cargo test && pnpm test`

---
## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build` + `cargo test` + `pnpm test`. Review all new/changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names. Verify no provider trait was created. Verify no existing columns were renamed.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. If `claude` is installed: switch provider to "Claude Code" in settings, run an action on a task, verify status tracking, verify terminal opens with `--resume`, abort and verify interrupted status. If `claude` is NOT installed: verify graceful degradation (check_claude_installed shows not installed, attempting to run shows clear error). Test switching back to OpenCode and verify it still works.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff. Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes. Specifically verify: no provider trait exists, no columns renamed, no per-task provider selection, no cost tracking UI.
  Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

- **After Wave 1**: `feat(backend): add claude code DB migration and process manager` — db/mod.rs, claude_process_manager.rs, commands/config.rs
- **After Wave 2**: `feat(backend): add claude code stream-json bridge and DB operations` — claude_bridge.rs, db/agents.rs, types.ts, ipc.ts
- **After Wave 3**: `feat: integrate claude code into orchestration, PTY, and frontend settings` — orchestration.rs, pty_manager.rs, main.rs, settings UI
- **After Wave 4**: `feat: complete claude code integration with agent panel and resume handling` — AgentPanel changes, startup resume, regression tests

---

## Success Criteria

### Verification Commands
```bash
cargo test                          # Expected: all tests pass, 0 failures
pnpm test                           # Expected: all tests pass, 0 failures
cargo build --release               # Expected: builds successfully
which claude && claude --version    # Expected: shows version (if installed)
```

### Final Checklist
- [ ] All "Must Have" items present and functional
- [ ] All "Must NOT Have" items absent (no trait, no renamed columns, no cost UI)
- [ ] All `cargo test` pass (including new tests)
- [ ] All `pnpm test` pass (including new tests)
- [ ] OpenCode flow completely unchanged (regression-free)
- [ ] Provider setting persists and takes effect on next task
- [ ] Claude Code happy path works end-to-end (if `claude` installed)
- [ ] Graceful degradation when `claude` not installed
