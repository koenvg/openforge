# Learnings — task-view-terminal

## 2026-03-05 Plan Creation
- Full PTY infrastructure already exists (portable-pty 0.8, xterm.js 6.0, terminal pool, Tauri events)
- Existing spawn_pty is OpenCode-specific, spawn_claude_pty is Claude-specific — neither usable for plain shell
- Terminal pool accepts ANY string key — `{task_id}-shell` works without pool code changes
- Existing writePty/resizePty/killPty accept any key string — reusable as-is
- get_user_environment() Rust helper exists for shell env setup
- ClaudeAgentPanel uses pool directly (acquire→attach→detach) — follow this pattern
- DO NOT use usePtyBridge.svelte.ts — it's OpenCode-specific
- Shell terminal has DARK theme (#1C1C1C bg) — different from agent terminal (white bg)
- Tab-based toggle with lucide icons (info, terminal) and green underline active indicator
- PtyManager uses task_id as HashMap key — shell key is `{task_id}-shell`
- Shell cleanup must be added to: update_task_status, delete_task, clear_done_tasks, orchestration
- cleanup_stale_pids() needs extension for -shell.pid files

## 2026-03-05 Terminal Pool Shell Key Validation
- Added 3 new tests to `src/lib/terminalPool.test.ts` validating shell key independence
- Tests confirm: `acquire("T-42")` and `acquire("T-42-shell")` create separate pool entries
- Pool uses `Map<string, PoolEntry>` with string keys — any key format works without code changes
- Releasing agent key (`"T-42"`) does NOT affect shell key entry (`"T-42-shell"`)
- Both entries maintain independent `ptyActive` state — verified via event listener simulation
- Design assumption validated: NO terminal pool code changes needed for shell key support
- All 18 terminalPool tests pass (15 existing + 3 new)

## 2026-03-05 spawn_shell_pty Implementation
- `get_shell_path()` placed as `pub(crate)` free function near `build_claude_args()` — same module level
- Shell session key `{task_id}-shell` threads through all: HashMap, PID file, ring buffer, last_output, events
- Events emitted: `pty-output-{task_id}-shell` and `pty-exit-{task_id}-shell` (no `claude-pty-exited`)
- `spawn_shell_pty` is structurally identical to `spawn_claude_pty` minus: claude_hooks, workspace trust, --resume/--continue args, CLAUDE_TASK_ID env var
- Shell fallback: $SHELL → /bin/zsh → /bin/bash → /bin/sh (checked via Path::exists())
- cargo test requires `dist/` dir to exist due to `tauri::generate_context!()` proc macro; create with `mkdir -p dist`
- TDD pattern: tests fail to compile (E0425) when referencing missing function — valid RED state
- 331 tests pass after implementation (2 new: test_build_shell_command, test_shell_pid_file_naming)

## Task: Add spawnShellPty IPC wrapper (COMPLETED)

**What was done:**
- Added `spawnShellPty(taskId: string, cwd: string, cols: number, rows: number): Promise<number>` to `src/lib/ipc.ts` at line 196-198
- Function calls `invoke<number>("pty_spawn_shell", { taskId, cwd, cols, rows })`
- Placed immediately after existing `spawnPty` function (line 192-194)
- Follows exact same pattern as `spawnPty`

**Key learnings:**
- IPC wrappers in `src/lib/ipc.ts` are simple pass-through functions to Tauri `invoke()`
- Generic type parameter `<number>` specifies return type
- Existing `writePty`, `resizePty`, `killPty` accept any key string — reusable for shell PTY without modification
- Tauri automatically converts JS number to Rust u16 for cols/rows parameters

**Test results:**
- 655 tests passed (no regressions)
- 2 pre-existing failures in AgentPanel.test.ts and TaskDetailView.test.ts (acceptable)
- LSP diagnostics: clean (no errors)

**Status:** ✅ COMPLETE

## Task 2: Shell PTY Cleanup Calls (COMPLETED)

### Summary
Added shell PTY cleanup calls (`kill_pty` with `{id}-shell` key) to all 4 task lifecycle paths and extended `cleanup_stale_pids()` to handle `-shell.pid` files.

### Changes Made
1. **tasks.rs** - Added shell kill calls to:
   - `update_task_status()` (line 75): `let _ = pty_mgr.kill_pty(&format!("{}-shell", id)).await;`
   - `delete_task()` (line 119): `let _ = pty_mgr.kill_pty(&format!("{}-shell", id)).await;`
   - `clear_done_tasks()` (line 167): `let _ = pty_mgr.kill_pty(&format!("{}-shell", id)).await;`

2. **orchestration.rs** - Added shell kill call to:
   - `abort_agent_session()` (line 47): `let _ = pty_mgr.kill_pty(&format!("{}-shell", task_id)).await;`

3. **pty_manager.rs** - Extended `cleanup_stale_pids()`:
   - Modified file filter to check for `-pty.pid`, `-claude.pid`, AND `-shell.pid` files
   - Same cleanup logic applies to all three types (check if running, remove if dead)

### Key Patterns
- Shell session key format: `{task_id}-shell`
- Shell PID file format: `{task_id}-shell.pid`
- `kill_pty()` accepts any string key and handles non-existent keys gracefully with `let _ =`
- All 4 lifecycle paths now consistently clean up both agent PTY and shell PTY

### Test Results
- All 331 cargo tests pass
- Build succeeds with no errors (only pre-existing warnings)
- No LSP errors in modified files

### Verification
- Confirmed all 4 lifecycle paths have shell kill calls
- Confirmed cleanup_stale_pids() processes all 3 PID file types
- Confirmed tests pass and build succeeds

## Task 5: TaskTerminal Component (COMPLETED)

### Summary
Created `src/components/TaskTerminal.svelte` and `src/components/TaskTerminal.test.ts`.

### Key Implementation Details
- Pool key: `taskId + '-shell'` — pool events use `pty-output-{taskId}-shell` and `pty-exit-{taskId}-shell` automatically
- Theme override: after `acquire()`, set `poolEntry.terminal.options.theme = {...dark theme...}` — pool creates white theme by default
- `ptyActive` state variable must be READ somewhere (used as guard in `handleRestart`) to avoid TS "declared but never read" error
- `onDestroy` calls `detach(poolEntry)` NOT `release()` — keeps terminal alive for re-attach
- Shell exit overlay: listen for `pty-exit-{taskId}-shell` event, set `shellExited = true`
- Restart flow: `killPty`, `spawnShellPty`, `poolEntry.needsClear = true`, reset `shellExited = false`

### Test Patterns
- `vi.mock('@tauri-apps/api/event', ...)` captures `listenCallback` to simulate events
- Unused `event` param in listen mock must be `_event` to avoid TS errors
- `calls detach on component destroy` test: must wait for `attach` to be called BEFORE `unmount()` — otherwise `poolEntry` is null and detach is skipped
- `vi.clearAllMocks()` in `beforeEach` resets all mocks between tests — including module-scoped `listenCallback`

### Test Results
- All 8 TaskTerminal tests pass
- 2 pre-existing failures in AgentPanel.test.ts and App.test.ts (unchanged)
- LSP diagnostics: clean

### Status: ✅ COMPLETE

## Tab Toggle Implementation (T-466)

### Files changed
- `src/components/TaskDetailView.svelte`: Added `rightPanelMode` state, tab toggle bar, conditional rendering
- `src/components/TaskDetailView.test.ts`: Added `terminalPool` mock, `spawnShellPty`/`getPtyBuffer` to IPC mock, 4 new tests

### Key patterns
- `rightPanelMode = $state<'info' | 'terminal'>('info')` — typed union state
- Tab bar is `{#if worktreePath !== null}` — only shown when worktree exists
- Tab bar uses `border-b-2 border-primary` for active indicator (green underline)
- Content area: outer div gets `overflow-hidden flex flex-col`, inner `flex-1 overflow-y-auto`
- `rightPanelMode` resets to `'info'` alongside `reviewMode = false` in task-change `$effect`
- TaskTerminal rendered with `taskId={task.id}` and `{worktreePath}` (non-null guaranteed by condition)

### Test mocking pattern
- Tests that need worktree: import `getWorktreeForTask` dynamically inside test, mock with `.mockResolvedValue({ worktree_path: '...', repo_path: '...', branch_name: '...' } as any)`, restore to `null` after
- `terminalPool` mock must provide all Pool entry fields including `options: { theme: {} }` on terminal (TaskTerminal mutates theme)
- `.shell-terminal-wrapper` class is what to query for in terminal view tests

### Pre-existing failures (NOT caused by us)
- `src/App.test.ts` — timeout 
- `src/components/AgentPanel.test.ts` — Claude panel "Implementing" text not found

## Task 7: Shell Exit Handling & Edge Cases Verification (COMPLETED)

### Summary
Verified shell exit/respawn functionality from Task 5 and added missing test for restart button behavior.

### Verification Results

**TaskTerminal.svelte Implementation** ✅
- `shellExited` state initialized at line 20
- `pty-exit-${taskId}-shell` listener (line 63) sets `shellExited = true` and `ptyActive = false`
- "Shell exited" overlay shown at lines 95-102 when `shellExited` is true
- Restart button (line 98) calls `handleRestart`
- `handleRestart` (lines 76-89): calls `killPty`, then `spawnShellPty`, sets `needsClear = true`, resets `shellExited = false`

**Existing Tests** ✅
- Test "shows shell exited overlay when PTY exits" (lines 143-155) — verifies overlay and text
- Test "shows restart button when shell has exited" (lines 157-169) — verifies button visibility

**Added Test** ✅
- Test "restart button calls killPty and spawnShellPty" (lines 171-207)
  - Simulates shell exit event
  - Clicks restart button
  - Verifies `killPty` called with `T-1-shell` key
  - Verifies `spawnShellPty` called twice (mount + restart)
  - Uses `fireEvent.click()` for button interaction

**kill_all() Verification** ✅
- `kill_all()` in pty_manager.rs (lines 940-951) iterates `sessions.keys()` which includes ALL HashMap keys
- Shell entries stored with key format `{taskId}-shell` are automatically included
- No special handling needed — HashMap iteration covers all entry types

### Test Results
- All 9 TaskTerminal tests pass ✅
- No regressions in other tests
- LSP diagnostics: clean

### Key Learnings
- Restart button test pattern: simulate event → wait for button → click → verify IPC calls
- `fireEvent.click()` from `@testing-library/svelte` triggers onclick handlers
- `vi.waitFor()` with `toHaveBeenCalledTimes()` verifies call count across mount and user action
- BDD-style comments in tests (Arrange-Act-Assert) are necessary for test clarity

### Status: ✅ COMPLETE
