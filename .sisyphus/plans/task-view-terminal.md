# Task View Terminal — User Shell in Task Detail View

## TL;DR

> **Quick Summary**: Add an embedded terminal to the task detail view where users can run arbitrary shell commands in the task's worktree. The terminal replaces the TaskInfoPanel in the 30% right column via a toggle, running concurrently with the agent terminal.
> 
> **Deliverables**:
> - New Rust `spawn_shell_pty()` method + Tauri command
> - New `spawnShellPty` IPC wrapper
> - New `TaskTerminal.svelte` component using terminal pool pattern
> - Toggle UI in TaskDetailView (info ↔ terminal) in right column
> - Shell PTY cleanup integrated into existing task lifecycle
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES — 3 waves
> **Critical Path**: Task 1 → Task 3 → Task 5 → Task 6 → Task 7 → F1-F4

---

## Context

### Original Request
"I want to have a little terminal window on the task view where I can run commands."

### Interview Summary
**Key Discussions**:
- **Placement**: Terminal replaces TaskInfoPanel in the 30% right column (toggle between info and terminal)
- **Concurrent PTYs**: User shell and agent terminal run simultaneously — PTY key: `{task_id}-shell`
- **Shell**: User's default `$SHELL` in the task's worktree directory

**Research Findings**:
- Full PTY infrastructure exists (portable-pty 0.8, xterm.js 6.0, terminal pool, Tauri event system)
- Existing spawn methods are agent-specific (`spawn_pty` for OpenCode, `spawn_claude_pty` for Claude) — cannot be reused for a plain shell
- Terminal pool (`terminalPool.ts`) handles any string key — `{task_id}-shell` works without pool code changes
- Existing `writePty`, `resizePty`, `killPty` IPC commands accept any key string — reusable as-is
- `get_user_environment()` Rust helper already exists for shell environment setup

### Metis Review
**Identified Gaps** (addressed):
- Shell PTY cleanup missing from task done/delete/clear paths → Added cleanup task
- `cleanup_stale_pids()` only handles `-pty.pid` files → Extended for `-shell.pid`
- Shell exit edge case (user types `exit`) → Handle with respawn indicator
- No worktree edge case → Gate toggle on `worktreePath !== null`
- PID file naming → Use `{task_id}-shell.pid` pattern

---

## Work Objectives

### Core Objective
Enable users to run arbitrary shell commands from within the task detail view, using an embedded terminal that runs in the task's worktree directory alongside (not replacing) the agent terminal.

### Concrete Deliverables
- `src-tauri/src/pty_manager.rs`: New `spawn_shell_pty()` method
- `src-tauri/src/commands/pty.rs`: New `pty_spawn_shell` Tauri command
- `src/lib/ipc.ts`: New `spawnShellPty()` wrapper
- `src/components/TaskTerminal.svelte`: New terminal component
- `src/components/TaskDetailView.svelte`: Toggle between info and terminal in right column
- Shell cleanup in existing task lifecycle paths (done/delete/clear/shutdown)

### Definition of Done
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `pnpm test` passes
- [ ] Shell terminal visible in task detail view when toggled
- [ ] Shell runs in worktree directory with user's `$SHELL`
- [ ] Agent terminal and shell terminal work simultaneously
- [ ] Shell cleaned up on task done/delete/clear

### Must Have
- Shell spawns in task worktree with user's `$SHELL`
- Toggle between info panel and terminal in right column
- Agent and shell PTYs coexist (different keys)
- Shell survives detach/re-attach (terminal pool pattern)
- Shell cleaned up on task lifecycle events
- Handle shell exit gracefully (user types `exit`)

### Must NOT Have (Guardrails)
- DO NOT modify existing `spawn_pty()` or `spawn_claude_pty()` methods — new method only
- DO NOT add shell terminal to `reviewMode` layout (SelfReviewView)
- DO NOT change the 70/30 split ratio or touch AgentPanel
- DO NOT add keyboard shortcuts, split panes, multiple shells, or shell customization
- DO NOT add shell indicator to board/task list views
- DO NOT extract/refactor shared PTY spawn helpers from existing methods
- DO NOT use `usePtyBridge.svelte.ts` — it's OpenCode-specific
- DO NOT add `@xterm/addon-web-links` or other addons beyond what exists

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest for frontend, cargo test for backend)
- **Automated tests**: TDD (tests first, per AGENTS.md)
- **Framework**: vitest (frontend), cargo test (backend)
- **Each task follows**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Rust backend**: Use Bash (cargo test) — Run tests, assert output
- **Integration**: Use interactive_bash (tmux) — Launch app, interact with terminal

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — backend foundation):
├── Task 1: Rust spawn_shell_pty + Tauri command + tests [quick]
├── Task 2: Rust shell PTY cleanup in task lifecycle + stale PID cleanup + tests [quick]

Wave 2 (After Wave 1 — frontend foundation):
├── Task 3: Frontend IPC wrapper spawnShellPty [quick]
├── Task 4: Terminal pool shell-key independence test [quick]
├── Task 5: TaskTerminal.svelte component + tests [unspecified-high]

Wave 3 (After Wave 2 — integration):
├── Task 6: TaskDetailView toggle (info ↔ terminal) + tests [unspecified-high]
├── Task 7: Shell exit handling + respawn + no-worktree guard [quick]

Wave FINAL (After ALL tasks — independent review):
├── Task F1: Plan compliance audit [oracle]
├── Task F2: Code quality review [unspecified-high]
├── Task F3: Real QA with Playwright [unspecified-high]
├── Task F4: Scope fidelity check [deep]

Critical Path: Task 1 → Task 3 → Task 5 → Task 6 → F1-F4
Parallel Speedup: ~40% faster than sequential
Max Concurrent: 2 (Waves 1 & 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| 1 | — | 2, 3, 5, 6, 7 | 1 |
| 2 | 1 | 7 | 1 |
| 3 | 1 | 5, 6 | 2 |
| 4 | — | — | 2 |
| 5 | 3 | 6 | 2 |
| 6 | 5 | 7 | 3 |
| 7 | 2, 6 | F1-F4 | 3 |
| F1-F4 | 7 | — | FINAL |

### Agent Dispatch Summary

- **Wave 1**: 2 tasks — T1 → `quick`, T2 → `quick`
- **Wave 2**: 3 tasks — T3 → `quick`, T4 → `quick`, T5 → `unspecified-high`
- **Wave 3**: 2 tasks — T6 → `unspecified-high`, T7 → `quick`
- **FINAL**: 4 tasks — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Rust: `spawn_shell_pty()` method + Tauri command + tests

  **What to do**:
  - **TDD RED**: Write a unit test `test_build_shell_command` in `pty_manager.rs` `#[cfg(test)]` module that verifies the shell command is built with correct env vars (`TERM=xterm-256color`, `COLORTERM=truecolor`, `TERM_PROGRAM=vscode`) and uses `$SHELL` (falling back to `/bin/zsh` → `/bin/bash` → `/bin/sh`)
  - **TDD RED**: Write a unit test that validates the PID file is named `{task_id}-shell.pid`
  - **TDD GREEN**: Implement `spawn_shell_pty(&self, task_id: &str, cwd: &Path, cols: u16, rows: u16, app_handle: tauri::AppHandle) -> Result<u64, PtyError>` in `pty_manager.rs` as a **new standalone method**
    - Use key `format!("{}-shell", task_id)` for the sessions HashMap
    - Spawn user's `$SHELL` via `CommandBuilder::new(shell_path)` with `cmd.cwd(cwd)`
    - Reuse `get_user_environment()` for env setup
    - Set `TERM`, `COLORTERM`, `TERM_PROGRAM` env vars (same as existing spawners)
    - Use the same ring buffer (256KB), event batching (16ms/64KB), and UTF-8 boundary handling as `spawn_claude_pty()`
    - Emit events on `pty-output-{task_id}-shell` and `pty-exit-{task_id}-shell`
    - Write PID file to `{task_id}-shell.pid`
    - Shell fallback chain: `$SHELL` → `/bin/zsh` → `/bin/bash` → `/bin/sh`
  - Add `pty_spawn_shell` Tauri command in `commands/pty.rs` following the pattern of `pty_spawn` (line 4-18)
  - Register `commands::pty::pty_spawn_shell` in `main.rs` invoke_handler at line ~403 (after `get_pty_buffer`)

  **Must NOT do**:
  - DO NOT modify `spawn_pty()` or `spawn_claude_pty()` methods
  - DO NOT extract shared helper code from existing spawn methods
  - DO NOT add any new crate dependencies

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Follows established patterns closely — the new method mirrors `spawn_claude_pty()` structure
  - **Skills**: []
    - No special skills needed — Rust command pattern is well-documented in references
  - **Skills Evaluated but Omitted**:
    - `golang`: Not relevant — this is Rust

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Tasks 2, 3, 5, 6, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/pty_manager.rs:391-630` — `spawn_claude_pty()` method: Follow this structure exactly for the new method. Copy the PTY creation, reader/writer setup, ring buffer, event batching, and emitter task patterns. The key differences: no `claude_hooks`, no `--resume`/`--continue`, no `workspace_trust`, simpler CommandBuilder
  - `src-tauri/src/pty_manager.rs:957-1008` — `get_user_environment()`: Reuse this for shell env setup
  - `src-tauri/src/pty_manager.rs:170-174` — `CommandBuilder::new("opencode")` pattern: Use same pattern but with `$SHELL` path
  - `src-tauri/src/pty_manager.rs:1185-1285` — `build_claude_args` tests: Follow this pattern for new shell-related unit tests

  **API/Type References**:
  - `src-tauri/src/pty_manager.rs:59-65` — `PtyError` enum: Use for error returns
  - `src-tauri/src/pty_manager.rs:90-97` — `PtySession` struct: Same session type used for shell
  - `src-tauri/src/commands/pty.rs:4-18` — `pty_spawn` command: Follow this exact pattern for new `pty_spawn_shell`

  **Registration Reference**:
  - `src-tauri/src/main.rs:399-403` — PTY command registration: Add new command after `get_pty_buffer`

  **Acceptance Criteria**:

  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml -- shell` → passes (new shell tests)
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` → all existing tests still pass

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shell command builds with correct env vars
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cargo test --manifest-path src-tauri/Cargo.toml -- test_build_shell_command --nocapture`
      2. Verify test output shows TERM=xterm-256color, COLORTERM=truecolor
    Expected Result: Test passes, env vars verified
    Failure Indicators: Test fails or env vars missing
    Evidence: .sisyphus/evidence/task-1-shell-command-test.txt

  Scenario: Shell fallback chain works when $SHELL is invalid
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cargo test --manifest-path src-tauri/Cargo.toml -- test_shell_fallback --nocapture`
      2. Verify fallback to /bin/zsh or /bin/bash
    Expected Result: Test passes with valid shell path
    Failure Indicators: PtyError::SpawnFailed
    Evidence: .sisyphus/evidence/task-1-shell-fallback-test.txt
  ```

  **Commit**: YES (groups with Task 2)
  - Message: `feat(pty): add spawn_shell_pty for user terminal in task view`
  - Files: `src-tauri/src/pty_manager.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 2. Rust: Shell PTY cleanup in task lifecycle + stale PID handling + tests

  **What to do**:
  - **TDD RED**: Write test that verifies `kill_pty` for shell key is called during task status change to "done"
  - **TDD GREEN**: In `commands/tasks.rs`, add `pty_mgr.kill_pty(&format!("{}-shell", id))` alongside each existing `kill_pty(&id)` call:
    - Line 74: `update_task_status` — after existing kill_pty call
    - Line 117: `delete_task` — after existing kill_pty call
    - Line 165: `clear_done_tasks` — inside the loop after existing kill_pty call
  - In `commands/orchestration.rs` line 46: Add shell kill alongside existing agent kill
  - In `pty_manager.rs` `cleanup_stale_pids()`: Extend to also process `-shell.pid` files (currently only `-pty.pid`). For shell PIDs, check if process command contains the user's shell binary name, not "opencode"
  - In `pty_manager.rs` `kill_all()`: Already iterates all HashMap keys — `{task_id}-shell` entries are included automatically. Verify with a test.

  **Must NOT do**:
  - DO NOT modify the existing kill_pty method signature
  - DO NOT change how agent PTYs are cleaned up
  - DO NOT add conditional logic to kill_pty — just add extra call with shell key

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple additions of kill_pty calls to existing cleanup paths
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1, but depends on Task 1 for shell PID naming)
  - **Blocks**: Task 7
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/commands/tasks.rs:70-80` — `update_task_status` with existing `kill_pty`: Add shell kill here
  - `src-tauri/src/commands/tasks.rs:113-120` — `delete_task` with existing `kill_pty`: Add shell kill here
  - `src-tauri/src/commands/tasks.rs:160-170` — `clear_done_tasks` loop: Add shell kill here
  - `src-tauri/src/commands/orchestration.rs:40-50` — orchestration kill: Add shell kill here
  - `src-tauri/src/pty_manager.rs:777-851` — `cleanup_stale_pids()`: Extend for `-shell.pid` files
  - `src-tauri/src/pty_manager.rs:712-724` — `kill_all()`: Verify shell entries included

  **Acceptance Criteria**:

  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass
  - [ ] Shell kill added to all 4 cleanup paths (update_task_status, delete_task, clear_done_tasks, orchestration)
  - [ ] `cleanup_stale_pids()` handles `-shell.pid` files

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shell cleanup calls present in all lifecycle paths
    Tool: Bash (grep)
    Preconditions: Task 1 complete
    Steps:
      1. Run `grep -n 'shell.*kill_pty\|kill_pty.*shell' src-tauri/src/commands/tasks.rs src-tauri/src/commands/orchestration.rs`
      2. Verify matches in update_task_status, delete_task, clear_done_tasks, orchestration
    Expected Result: 4 matches across the files
    Failure Indicators: Fewer than 4 matches
    Evidence: .sisyphus/evidence/task-2-cleanup-paths.txt

  Scenario: Stale shell PID cleanup works
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cargo test --manifest-path src-tauri/Cargo.toml -- cleanup_stale --nocapture`
      2. Verify `-shell.pid` files are processed
    Expected Result: Test passes, shell PID files cleaned
    Failure Indicators: Test fails or shell PID files ignored
    Evidence: .sisyphus/evidence/task-2-stale-pid-cleanup.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(pty): add spawn_shell_pty for user terminal in task view`
  - Files: `src-tauri/src/commands/tasks.rs`, `src-tauri/src/commands/orchestration.rs`, `src-tauri/src/pty_manager.rs`
  - Pre-commit: `cd src-tauri && cargo test`

- [x] 3. Frontend: IPC wrapper `spawnShellPty` in ipc.ts

  **What to do**:
  - Add new IPC wrapper function `spawnShellPty(taskId: string, cwd: string, cols: number, rows: number): Promise<number>` in `ipc.ts`
  - Follow the exact pattern of `spawnPty()` at lines 192-194
  - The function calls `invoke<number>("pty_spawn_shell", { taskId, cwd, cols, rows })`
  - **No new wrappers needed for write/resize/kill** — existing `writePty`, `resizePty`, `killPty` accept any key string, so just pass `{taskId}-shell` from the component

  **Must NOT do**:
  - DO NOT add shell-specific write/resize/kill wrappers — reuse existing
  - DO NOT modify existing IPC functions

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single function addition following established pattern
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 4, 5)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src/lib/ipc.ts:192-211` — Existing PTY IPC wrappers: Follow this exact pattern

  **Acceptance Criteria**:

  - [ ] `spawnShellPty` function exists in `src/lib/ipc.ts`
  - [ ] Function signature matches: `(taskId: string, cwd: string, cols: number, rows: number) => Promise<number>`
  - [ ] `pnpm test` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: IPC wrapper exists with correct signature
    Tool: Bash (grep)
    Preconditions: None
    Steps:
      1. Run `grep -n 'spawnShellPty' src/lib/ipc.ts`
      2. Verify function signature includes taskId, cwd, cols, rows
      3. Verify it calls invoke("pty_spawn_shell", ...)
    Expected Result: Function found with correct signature and invoke call
    Failure Indicators: Function missing or wrong signature
    Evidence: .sisyphus/evidence/task-3-ipc-wrapper.txt
  ```

  **Commit**: YES (groups with Tasks 4, 5)
  - Message: `feat(terminal): add TaskTerminal component with shell PTY integration`
  - Files: `src/lib/ipc.ts`
  - Pre-commit: `pnpm test`

- [x] 4. Frontend: Terminal pool shell-key independence tests

  **What to do**:
  - **TDD RED**: Add tests to `src/lib/terminalPool.test.ts` verifying:
    - `acquire("T-42")` and `acquire("T-42-shell")` create separate pool entries
    - Releasing `"T-42"` does not affect `"T-42-shell"` entry
    - Both entries have independent `ptyActive` state
  - **TDD GREEN**: These tests should PASS without any pool code changes (the pool uses a `Map<string, PoolEntry>` with string keys — any key works). If they don't pass, investigate why.
  - This task confirms the design assumption that no terminal pool modifications are needed.

  **Must NOT do**:
  - DO NOT modify `terminalPool.ts` — only add tests
  - If tests fail, report the failure but DO NOT fix it in this task

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Test-only task, no implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 5)
  - **Blocks**: None (validation only)
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/lib/terminalPool.test.ts` — Existing pool tests: Follow these patterns for new tests
  - `src/lib/terminalPool.ts:40-150` — `acquire()` function: The function under test

  **Acceptance Criteria**:

  - [ ] New tests exist in `src/lib/terminalPool.test.ts`
  - [ ] Tests verify separate pool entries for `"task-id"` vs `"task-id-shell"`
  - [ ] `pnpm test -- terminalPool` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Pool independence tests pass
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Run `pnpm test -- --reporter=verbose terminalPool`
      2. Verify new shell-key independence tests pass
    Expected Result: All tests pass, shell and agent keys are independent
    Failure Indicators: Tests fail, or pool entries interfere
    Evidence: .sisyphus/evidence/task-4-pool-independence.txt
  ```

  **Commit**: YES (groups with Tasks 3, 5)
  - Message: `feat(terminal): add TaskTerminal component with shell PTY integration`
  - Files: `src/lib/terminalPool.test.ts`
  - Pre-commit: `pnpm test`

- [x] 5. Frontend: `TaskTerminal.svelte` component + tests

  **What to do**:
  - **TDD RED**: Create `src/components/TaskTerminal.test.ts` with tests:
    - Renders terminal wrapper div
    - Calls `acquire(taskId + '-shell')` on mount
    - Calls `attach()` with the pool entry and wrapper element
    - Calls `detach()` on component destroy
    - Shows "Shell exited" indicator when PTY exits
    - Shows "No worktree" state when worktreePath is null (should not render terminal)
  - **TDD GREEN**: Create `src/components/TaskTerminal.svelte`:
    - Props: `interface Props { taskId: string; worktreePath: string }`
    - On mount: `poolEntry = await acquire(taskId + '-shell')`, then `attach(poolEntry, terminalEl)`
    - If pool entry's `ptyActive` is false and no shell running: call `spawnShellPty(taskId + '-shell', worktreePath, terminal.cols, terminal.rows)` to start shell
    - On destroy: `detach(poolEntry)` (NOT release — keep alive for re-attach)
    - Listen for `pty-exit-{taskId}-shell` event to detect shell exit
    - Show respawn button when shell exits
    - Import `@xterm/xterm/css/xterm.css`
    - **Design spec** (from Pencil design `55gN9`):
      - Terminal wrapper: dark background `#1C1C1C` (use `bg-[#1C1C1C]`), 12px padding, full height/width
      - The terminal itself is xterm.js — the dark background comes from the xterm theme already in use (`background: '#ffffff'` in useTerminal — but for the SHELL terminal, override theme background to `'#1C1C1C'` and foreground to `'#E0E0E0'` to match the design)
      - NOTE: The xterm.js terminal theme in the design uses dark background with light text — this differs from the agent terminal (white background). Create the terminal with a dark theme for the shell.
    - Use same scrollbar styles as `ClaudeAgentPanel.svelte:162-184`

  **Must NOT do**:
  - DO NOT use `usePtyBridge.svelte.ts` — it's OpenCode-specific
  - DO NOT add web-links addon or other addons
  - DO NOT release pool entry on destroy (only detach)
  - DO NOT add `<style>` blocks — use the existing global xterm styles pattern from ClaudeAgentPanel

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Component with lifecycle management, PTY integration, and error states — more complex than a simple change
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 3, 4 — but depends on Task 3 for IPC)
  - **Blocks**: Task 6
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `src/components/ClaudeAgentPanel.svelte:1-63` — **PRIMARY PATTERN**: Follow this exactly for pool lifecycle (acquire→attach on mount, detach on destroy)
  - `src/components/ClaudeAgentPanel.svelte:115-160` — Template structure: terminal wrapper, status indicator, empty state
  - `src/components/ClaudeAgentPanel.svelte:162-184` — Styles: Copy `.terminal-wrapper` and scrollbar styles exactly

  **API/Type References**:
  - `src/lib/terminalPool.ts:40-50` — `acquire(taskId)` returns `PoolEntry`
  - `src/lib/terminalPool.ts:152-202` — `attach(entry, wrapperEl)` mounts terminal
  - `src/lib/terminalPool.ts:204-226` — `detach(entry)` unmounts without disposing
  - `src/lib/ipc.ts` — `spawnShellPty`, `killPty` for shell lifecycle

  **Test References**:
  - `src/components/ClaudeAgentPanel.test.ts` — If exists, follow this pattern for mocking pool
  - `src/components/AgentPanel.test.ts` — Component test pattern with mocks

  **Acceptance Criteria**:

  - [ ] `src/components/TaskTerminal.svelte` exists
  - [ ] `src/components/TaskTerminal.test.ts` exists with ≥4 tests
  - [ ] `pnpm test -- TaskTerminal` passes
  - [ ] Component uses terminal pool acquire/attach/detach pattern
  - [ ] Shell spawned via `spawnShellPty` with `{taskId}-shell` key

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: TaskTerminal component tests pass
    Tool: Bash (pnpm test)
    Preconditions: Tasks 3 and 4 complete
    Steps:
      1. Run `pnpm test -- --reporter=verbose TaskTerminal`
      2. Verify all tests pass including mount, detach, and exit handling
    Expected Result: All tests pass (≥4 tests, 0 failures)
    Failure Indicators: Test failures or missing test cases
    Evidence: .sisyphus/evidence/task-5-component-tests.txt

  Scenario: Component follows pool lifecycle pattern
    Tool: Bash (grep)
    Preconditions: Component implemented
    Steps:
      1. Run `grep -n 'acquire\|attach\|detach' src/components/TaskTerminal.svelte`
      2. Verify acquire called with taskId + '-shell'
      3. Verify attach on mount, detach on destroy
    Expected Result: Pool lifecycle calls present in correct order
    Failure Indicators: Missing pool calls or wrong key
    Evidence: .sisyphus/evidence/task-5-lifecycle-pattern.txt
  ```

  **Commit**: YES (groups with Tasks 3, 4)
  - Message: `feat(terminal): add TaskTerminal component with shell PTY integration`
  - Files: `src/components/TaskTerminal.svelte`, `src/components/TaskTerminal.test.ts`
  - Pre-commit: `pnpm test`

- [x] 6. Frontend: TaskDetailView toggle (info ↔ terminal) + tests

  **What to do**:
  - **TDD RED**: Add tests to `src/components/TaskDetailView.test.ts`:
    - Toggle button "terminal_view" renders only when `worktreePath !== null`
    - Toggle button "info_view" is active by default
    - Clicking "terminal_view" renders `TaskTerminal` component
    - Clicking "info_view" renders `TaskInfoPanel` component
    - Toggle buttons are NOT shown in reviewMode
  - **TDD GREEN**: Modify `src/components/TaskDetailView.svelte`:
    - Add `let rightPanelMode = $state<'info' | 'terminal'>('info')` state
    - In the right column (30%), conditionally render `TaskInfoPanel` or `TaskTerminal` based on `rightPanelMode`
    - Add a **Panel Toggle Bar** at the top of the right column (above the panel content)
    - Gate the terminal tab on `worktreePath !== null` (only show toggle when worktree exists)
    - Reset `rightPanelMode` to `'info'` when task changes (in the existing `$effect` at line 32-41)
    - Pass `worktreePath` to `TaskTerminal` as prop
    - Import `TaskTerminal` component
    - Toggle is only visible in code_view mode (not reviewMode)
    - **Design spec** (from Pencil design `55gN9` node `NDkhf`):
      - Tab bar: `bg-base-200` background, 40px height, bottom border `border-b border-base-300`, horizontal padding 4px
      - Two tabs side by side:
        - **Info tab**: Lucide `info` icon (14px) + "Info" text (JetBrains Mono 12px)
          - Inactive: icon and text `text-base-content/50` (gray), normal weight
          - Active: icon and text `text-base-content` (dark), font-semibold, green bottom border (2px, `border-b-2 border-primary`)
        - **Terminal tab**: Lucide `terminal` icon (14px) + "Terminal" text (JetBrains Mono 12px)
          - Same active/inactive states as Info tab
      - Each tab: horizontal padding 14px, gap 6px between icon and text, fill container height
      - Active indicator: 2px bottom border in primary green (`#00D084`)

  **Must NOT do**:
  - DO NOT change the 70/30 split ratio
  - DO NOT touch AgentPanel or its container
  - DO NOT add terminal toggle in review_view mode
  - DO NOT add keyboard shortcuts for the toggle

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Modifying existing component with new state, conditional rendering, and test updates
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 7
  - **Blocked By**: Task 5

  **References**:

  **Pattern References**:
  - `src/components/TaskDetailView.svelte:158-170` — Right column rendering: Modify this to add toggle bar + conditionally render TaskInfoPanel or TaskTerminal
  - `src/components/TaskDetailView.svelte:32-41` — Task change effect: Add rightPanelMode reset here

  **API/Type References**:
  - `src/components/TaskInfoPanel.svelte` — Existing right panel component (stays unchanged)
  - `src/components/TaskTerminal.svelte` — New component from Task 5

  **Design References**:
  - Pencil design `design.pen` frame `55gN9` ("Open Forge — Task View [Terminal]") — Full design mockup
  - Node `NDkhf` ("Panel Toggle Bar") — Tab-based toggle with lucide icons, green underline active state
  - Node `GTupA` ("Shell Terminal Area") — Dark terminal (#1C1C1C bg, 12px padding, JetBrains Mono 11px)
  - Node `a24X4` ("Terminal Tab") — Active tab with `#00D084` bottom border, bold text
  - Node `kD7fK` ("Info Tab") — Inactive tab with gray text (#888888)

  **Test References**:
  - `src/components/TaskDetailView.test.ts` — Existing tests: Add new toggle tests following existing patterns

  **Acceptance Criteria**:

  - [ ] Toggle buttons render in right column when worktreePath exists
  - [ ] Default mode is "info" (TaskInfoPanel shown)
  - [ ] Clicking "terminal" shows TaskTerminal component
  - [ ] Toggle hidden in reviewMode
  - [ ] `pnpm test -- TaskDetailView` passes

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Toggle renders correctly with worktree
    Tool: Bash (pnpm test)
    Preconditions: Task 5 complete
    Steps:
      1. Run `pnpm test -- --reporter=verbose TaskDetailView`
      2. Verify toggle button tests pass
    Expected Result: All tests pass including new toggle tests
    Failure Indicators: Toggle button not found in DOM, or wrong default state
    Evidence: .sisyphus/evidence/task-6-toggle-tests.txt

  Scenario: Toggle hidden without worktree
    Tool: Bash (pnpm test)
    Preconditions: Task 5 complete
    Steps:
      1. Run `pnpm test -- --reporter=verbose TaskDetailView`
      2. Verify test for "toggle hidden when no worktree" passes
    Expected Result: Toggle button absent when worktreePath is null
    Failure Indicators: Toggle visible without worktree
    Evidence: .sisyphus/evidence/task-6-no-worktree-toggle.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `feat(task-view): add terminal toggle and shell lifecycle handling`
  - Files: `src/components/TaskDetailView.svelte`, `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm test`

- [x] 7. Frontend: Shell exit handling + respawn + edge cases

  **What to do**:
  - **TDD RED**: Add tests to `TaskTerminal.test.ts`:
    - When `pty-exit-{taskId}-shell` event fires, show "Shell exited" indicator
    - Respawn button spawns new shell PTY
    - Terminal resets (clears) before respawn
  - **TDD GREEN**: Enhance `TaskTerminal.svelte`:
    - Track `shellExited` state, set to `true` on `pty-exit-{taskId}-shell` event
    - Show overlay with "Shell exited — Restart" button when shellExited is true
    - On restart: call `killPty(taskId + '-shell')` (cleanup), then `spawnShellPty(...)` to start fresh
    - Set `poolEntry.needsClear = true` before respawn (existing pool pattern from terminalPool.ts:127-128)
    - Reset `shellExited = false` on successful respawn
  - Verify edge cases work:
    - Rapid toggle between info/terminal while shell is active (detach/attach idempotent — already handled by pool)
    - App shutdown kills shell (already handled by `kill_all()` — verify with grep)

  **Must NOT do**:
  - DO NOT persist shell history to disk
  - DO NOT add auto-restart behavior (user must click restart)
  - DO NOT add terminal customization UI

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small additions to existing component — exit state + respawn button
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6, but depends on it)
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 2, 6

  **References**:

  **Pattern References**:
  - `src/lib/terminalPool.ts:136-139` — `pty-exit` listener: Sets `ptyActive = false` and `needsClear = true`
  - `src/components/ClaudeAgentPanel.svelte:146-158` — Empty/status state overlay: Follow this pattern for "Shell exited" overlay

  **API References**:
  - `src/lib/ipc.ts:205-207` — `killPty(taskId)`: Call with `{taskId}-shell` for cleanup before respawn
  - `src/lib/ipc.ts` — `spawnShellPty`: Call for respawn

  **Acceptance Criteria**:

  - [ ] Shell exit shows indicator with restart button
  - [ ] Restart button spawns new shell
  - [ ] `pnpm test -- TaskTerminal` passes with exit/respawn tests

  **QA Scenarios (MANDATORY):**

  ```
  Scenario: Shell exit shows restart option
    Tool: Bash (pnpm test)
    Preconditions: Task 6 complete
    Steps:
      1. Run `pnpm test -- --reporter=verbose TaskTerminal`
      2. Verify shell exit and respawn tests pass
    Expected Result: All exit/respawn tests pass
    Failure Indicators: Missing exit indicator or respawn failure
    Evidence: .sisyphus/evidence/task-7-exit-respawn.txt

  Scenario: Edge case — shell kill_all includes shell keys
    Tool: Bash (grep)
    Preconditions: None
    Steps:
      1. Run `grep -n 'kill_all\|sessions.keys' src-tauri/src/pty_manager.rs`
      2. Verify kill_all iterates ALL HashMap keys (including -shell keys)
    Expected Result: kill_all uses sessions.keys() which includes all entries
    Failure Indicators: Shell entries filtered out
    Evidence: .sisyphus/evidence/task-7-kill-all-coverage.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `feat(task-view): add terminal toggle and shell lifecycle handling`
  - Files: `src/components/TaskTerminal.svelte`, `src/components/TaskTerminal.test.ts`
  - Pre-commit: `pnpm test`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in `.sisyphus/evidence/`. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm test` + `cargo test --manifest-path src-tauri/Cargo.toml`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state with `pnpm tauri:dev`. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (terminal toggle + agent session). Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec was built. Check "Must NOT do" compliance. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Commit 1** (after Task 1+2): `feat(pty): add spawn_shell_pty for user terminal in task view`
  - Files: `src-tauri/src/pty_manager.rs`, `src-tauri/src/commands/pty.rs`, `src-tauri/src/main.rs`, task cleanup files
  - Pre-commit: `cd src-tauri && cargo test`

- **Commit 2** (after Task 3+4+5): `feat(terminal): add TaskTerminal component with shell PTY integration`
  - Files: `src/lib/ipc.ts`, `src/components/TaskTerminal.svelte`, `src/components/TaskTerminal.test.ts`, `src/lib/terminalPool.test.ts`
  - Pre-commit: `pnpm test`

- **Commit 3** (after Task 6+7): `feat(task-view): add terminal toggle and shell lifecycle handling`
  - Files: `src/components/TaskDetailView.svelte`, `src/components/TaskDetailView.test.ts`
  - Pre-commit: `pnpm test`

---

## Success Criteria

### Verification Commands
```bash
cargo test --manifest-path src-tauri/Cargo.toml  # Expected: all tests pass
pnpm test                                         # Expected: all tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Shell terminal visible and functional in task detail view
- [ ] Agent and shell coexist without interference
