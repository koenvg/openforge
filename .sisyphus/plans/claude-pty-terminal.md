# Claude Code: PTY Terminal + Hooks Status Channel

## TL;DR

> **Quick Summary**: Replace the custom-rendered Claude Code UI (NDJSON parsing, chat views, tool cards) with a real PTY terminal showing Claude's actual TUI. Use Claude's HTTP hooks system as a side-channel for programmatic status detection.
>
> **Deliverables**:
> - Claude Code running in a real PTY with xterm.js (same experience as OpenCode)
> - HTTP hooks routes on existing server for status detection (running/idle/paused/completed)
> - Auto-generated hooks settings file with `--settings` flag (zero user config)
> - Terminal persistence when navigating between tasks (PTY stays alive, output buffered)
> - All old Claude custom components deleted (clean break)
>
> **Estimated Effort**: Large
> **Parallel Execution**: YES - 4 waves
> **Critical Path**: Task 1 → Task 4 → Task 7 → Task 10 → Task 12 → F1-F4

---

## Context

### Original Request
User expressed frustration with the current Claude Code integration: custom-rendering NDJSON events as chat messages and tool cards means constantly playing catch-up with Claude's features. Requested showing the real terminal output (like OpenCode already does) with direct user interaction, while still detecting status programmatically.

### Interview Summary
**Key Discussions**:
- Claude TUI and `--output-format stream-json` are mutually exclusive — can't have both from one process
- VS Code's own extension uses stream-json + custom UI (same unsustainable approach)
- Claude's hooks system fires at lifecycle events in interactive mode — side-channel for status
- User wants full raw terminal, no custom UI overlays, direct interaction for permissions/questions
- Clean break: delete ALL existing Claude custom components
- TDD approach for all tasks

**Research Findings**:
- HTTP hooks are natively supported by Claude Code (no Unix socket needed) — add routes to existing http_server.rs
- `--settings <path>` flag loads additional settings from a separate file — don't touch `~/.claude/settings.json`
- Known PTY issues: SIGWINCH resize broken, Ctrl+C sends raw 0x03 not SIGINT, CLI can freeze after Ctrl+C
- 17 hook events available — PreToolUse, PostToolUse, Stop, SessionEnd, Notification(idle_prompt), PermissionRequest, etc.
- `claude "prompt"` starts interactive TUI with initial prompt; `claude --resume "id" "msg"` resumes

### Metis Review
**Identified Gaps** (addressed):
- Unix socket approach replaced with HTTP hooks on existing server (simpler, no cleanup issues)
- Global `~/.claude/settings.json` replaced with `--settings` flag + app-managed file (safer)
- Interrupt via SIGINT to PID, not PTY `\x03` (confirmed Claude bug)
- Port stability: regenerate hooks settings file on every app startup after port is known
- Unresponsiveness detection: no output + alive PID for 15s → "possibly frozen" indicator

---

## Work Objectives

### Core Objective
Show Claude Code's real TUI in an xterm.js terminal (identical experience to running `claude` in a terminal) while using HTTP hooks for programmatic status tracking.

### Concrete Deliverables
- HTTP hook routes on existing http_server.rs (`/hooks/{event}`)
- Auto-generated `~/.ai-command-center/claude-hooks-settings.json` on startup
- Claude PTY spawn function in pty_manager.rs (or dedicated module)
- Updated orchestration commands: start_implementation, run_action, abort
- Frontend: ClaudeAgentPanel using xterm.js terminal (same pattern as OpenCodeAgentPanel)
- Deletion of all old Claude custom components

### Definition of Done
- [ ] `claude "prompt"` runs in a PTY visible in xterm.js with full TUI
- [ ] User can type directly in terminal (permissions, follow-ups, questions)
- [ ] Task card badges update from hook events (running/idle/paused/completed)
- [ ] Terminal persists when switching between tasks (PTY alive, output buffered)
- [ ] Session resume works: `claude --resume <id> "msg"` in new PTY
- [ ] All old Claude components deleted, no dead code
- [ ] `cargo build` and `pnpm build` succeed
- [ ] `cargo test` and `pnpm test` pass

### Must Have
- Real PTY terminal with full Claude TUI (ANSI colors, cursor, spinners)
- Direct user interaction (no UI overlays for permissions/questions)
- Status detection via HTTP hooks
- Terminal persistence when navigating away
- Clean deletion of all old custom Claude UI

### Must NOT Have (Guardrails)
- No custom chat message rendering for Claude
- No NDJSON parsing of Claude output
- No writing to `~/.claude/settings.json` (use `--settings` flag)
- No `\x03` PTY write for interrupt (use SIGINT to PID)
- No keeping old stream-json components as fallback
- No over-engineering: AI slop like excessive error types, deep abstraction layers, or verbose JSDoc

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + cargo test)
- **Automated tests**: TDD (RED → GREEN → REFACTOR)
- **Framework**: vitest (frontend), cargo test (Rust)
- **Each task**: Write failing test first, then implement to make it pass

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Backend (Rust)**: Use Bash — cargo test, cargo build, curl hook endpoints
- **Frontend (Svelte)**: Use Bash — pnpm vitest run, pnpm build
- **Integration**: Use Playwright / interactive_bash — spawn Claude, verify terminal renders, check hooks fire

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — all independent, start immediately):
├── Task 1: HTTP hook routes on existing server [quick]
├── Task 2: Hooks settings file generator [quick]
├── Task 3: Claude PTY spawn function [unspecified-high]
└── Task 4: Delete old Claude custom components (backend) [quick]

Wave 2 (Core integration — depends on Wave 1):
├── Task 5: Orchestration commands update (start/run/abort) [deep]
├── Task 6: Hook-to-status mapping + DB persistence [unspecified-high]
├── Task 7: Delete old Claude custom components (frontend) [quick]
└── Task 8: SIGINT interrupt + freeze detection [unspecified-high]

Wave 3 (Frontend terminal + wiring):
├── Task 9: ClaudeAgentPanel as xterm.js terminal [visual-engineering]
├── Task 10: AgentPanel provider routing update [quick]
└── Task 11: Terminal persistence (buffer + reconnect) [deep]

Wave 4 (Integration + polish):
├── Task 12: End-to-end integration test [deep]
└── Task 13: Startup hooks file generation + cleanup [quick]

Wave FINAL (Verification — 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 5 → Task 9 → Task 12 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 4 (Waves 1)
```

### Dependency Matrix

| Task | Blocked By | Blocks |
|------|-----------|--------|
| 1 | — | 5, 6 |
| 2 | — | 5, 13 |
| 3 | — | 5, 8 |
| 4 | — | 5 |
| 5 | 1, 2, 3, 4 | 9, 12 |
| 6 | 1 | 9, 10 |
| 7 | — | 9, 10 |
| 8 | 3 | 12 |
| 9 | 5, 6, 7 | 11, 12 |
| 10 | 6, 7 | 12 |
| 11 | 9 | 12 |
| 12 | 5, 8, 9, 10, 11 | F1-F4 |
| 13 | 2 | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: 4 tasks — T1 `quick`, T2 `quick`, T3 `unspecified-high`, T4 `quick`
- **Wave 2**: 4 tasks — T5 `deep`, T6 `unspecified-high`, T7 `quick`, T8 `unspecified-high`
- **Wave 3**: 3 tasks — T9 `visual-engineering`, T10 `quick`, T11 `deep`
- **Wave 4**: 2 tasks — T12 `deep`, T13 `quick`
- **FINAL**: 4 tasks — F1 `oracle`, F2 `unspecified-high`, F3 `unspecified-high`, F4 `deep`

---

## TODOs

- [x] 1. HTTP Hook Routes on Existing Server

  **What to do**:
  - RED: Write Rust tests for hook route handlers — test that POST `/hooks/stop`, `/hooks/pre-tool-use`, `/hooks/post-tool-use`, `/hooks/session-end`, `/hooks/notification` accept JSON payloads and return 200
  - GREEN: Add hook route handlers to `src-tauri/src/http_server.rs` — parse incoming JSON (contains `session_id`, `tool_name`, `tool_input` etc.), extract `CLAUDE_TASK_ID` from request headers or JSON body, emit Tauri event `claude-hook-event` with `{ task_id, event_type, payload }`
  - REFACTOR: Ensure routes are cleanly organized within the existing server module

  **Must NOT do**:
  - Do not create a separate HTTP server — add routes to the existing one
  - Do not create a Unix socket listener module
  - Do not add excessive error types — use simple `Result<impl Reply, Rejection>`

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Adding routes to an existing HTTP server is a well-scoped single-file task
  - **Skills**: []
    - No specialized skills needed — standard Rust HTTP handler work
  - **Skills Evaluated but Omitted**:
    - `golang`: Not a Go project

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/http_server.rs` — Existing HTTP server implementation. Understand what framework is used (likely warp or axum), how routes are registered, and where to add new ones. Copy the existing route pattern exactly.

  **API/Type References**:
  - Claude hooks JSON schema: `{ "session_id": "...", "tool_name": "...", "tool_input": {...}, "transcript_path": "..." }` — this is what Claude POSTs to the hook URL
  - Hook events list: PreToolUse, PostToolUse, Stop, SessionEnd, Notification — each maps to a route

  **Test References**:
  - `src-tauri/src/http_server.rs` — check if existing tests exist for the HTTP server; follow the same test pattern

  **External References**:
  - Claude Code hooks docs: https://code.claude.com/docs/en/hooks — hook event schema and configuration

  **WHY Each Reference Matters**:
  - `http_server.rs`: Must add routes to THIS file using its existing framework/patterns, not create a new server
  - Hook JSON schema: Need to know the exact payload shape to parse incoming hook events correctly

  **Acceptance Criteria**:

  - [ ] Test file covers all 5 hook routes with JSON payload parsing
  - [ ] `cargo test` → hook route tests PASS
  - [ ] Routes added to existing http_server.rs (no new server module)

  **QA Scenarios**:

  ```
  Scenario: Hook route accepts valid payload
    Tool: Bash (curl)
    Preconditions: App running with HTTP server on known port
    Steps:
      1. curl -X POST http://127.0.0.1:{port}/hooks/stop -H "Content-Type: application/json" -d '{"session_id":"test-123"}'
      2. Assert HTTP 200 response
      3. Check Tauri event log for `claude-hook-event` emission
    Expected Result: 200 OK, event emitted with task_id and event_type "stop"
    Failure Indicators: Non-200 status, no event emitted, JSON parse error in logs
    Evidence: .sisyphus/evidence/task-1-hook-route-valid.txt

  Scenario: Hook route handles malformed JSON
    Tool: Bash (curl)
    Preconditions: App running
    Steps:
      1. curl -X POST http://127.0.0.1:{port}/hooks/stop -H "Content-Type: application/json" -d 'not json'
      2. Assert HTTP 400 response
    Expected Result: 400 Bad Request, no crash
    Evidence: .sisyphus/evidence/task-1-hook-route-malformed.txt
  ```

  **Commit**: YES
  - Message: `feat(hooks): add HTTP hook routes for Claude status events`
  - Files: `src-tauri/src/http_server.rs`
  - Pre-commit: `cargo test`

- [x] 2. Hooks Settings File Generator

  **What to do**:
  - RED: Write Rust tests — given a port number, generate correct JSON settings content; test file creation at `~/.ai-command-center/claude-hooks-settings.json`; test that existing file is overwritten
  - GREEN: Create `src-tauri/src/claude_hooks.rs` module — function `generate_hooks_settings(port: u16) -> Result<PathBuf>` that writes a JSON file with hook URLs pointing to `http://127.0.0.1:{port}/hooks/{event}` for each event (PreToolUse, PostToolUse, Stop, SessionEnd, Notification)
  - REFACTOR: Extract the JSON template as a const or builder

  **Must NOT do**:
  - Do not write to `~/.claude/settings.json` — ONLY write the app-managed settings file
  - Do not hardcode the port — it must be a parameter

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single-file module generating a JSON config file — straightforward
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3, 4)
  - **Blocks**: Tasks 5, 13
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:203-209` — Where the HTTP server is started and port is determined. The hooks settings generator will need this port value.

  **External References**:
  - Claude Code hooks config format: https://code.claude.com/docs/en/hooks — the `hooks` key in settings.json, `type: "http"`, `url`, `timeout` fields
  - `--settings` flag: documented in Claude CLI reference — loads additional settings from arbitrary file path

  **WHY Each Reference Matters**:
  - `main.rs` HTTP server: Need to understand where the port is available to pass to the generator
  - Hooks config format: Must generate valid Claude settings JSON that Claude will accept via `--settings`

  **Acceptance Criteria**:

  - [ ] Test file covers: JSON generation with correct URLs, file creation, file overwrite
  - [ ] `cargo test` → generator tests PASS
  - [ ] Generated JSON is valid Claude hooks config (correct schema)

  **QA Scenarios**:

  ```
  Scenario: Settings file generated with correct hook URLs
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run cargo test for claude_hooks module
      2. Read generated file content, verify JSON has hooks.PreToolUse[0].hooks[0].url == "http://127.0.0.1:19876/hooks/pre-tool-use"
      3. Verify all 5 hook events are present (PreToolUse, PostToolUse, Stop, SessionEnd, Notification)
    Expected Result: Valid JSON with all hook URLs pointing to correct port
    Failure Indicators: Missing hook events, wrong port, invalid JSON
    Evidence: .sisyphus/evidence/task-2-settings-generation.txt

  Scenario: Existing settings file is overwritten on regeneration
    Tool: Bash
    Preconditions: Settings file exists with old port 12345
    Steps:
      1. Call generator with port 19876
      2. Read file, verify port is 19876 not 12345
    Expected Result: File contains new port, old port gone
    Evidence: .sisyphus/evidence/task-2-settings-overwrite.txt
  ```

  **Commit**: YES
  - Message: `feat(hooks): add Claude hooks settings file generator`
  - Files: `src-tauri/src/claude_hooks.rs`
  - Pre-commit: `cargo test`

- [x] 3. Claude PTY Spawn Function

  **What to do**:
  - RED: Write Rust tests — test that `spawn_claude_pty()` constructs correct command args: `claude "prompt"` for new sessions, `claude --resume <id> "msg"` for resume, `--settings <path>` always present, `CLAUDE_TASK_ID` env var set
  - GREEN: Add Claude PTY spawn to `src-tauri/src/pty_manager.rs` (or a new `claude_pty.rs` if cleaner) — function `spawn_claude_pty(task_id, cwd, prompt, resume_session_id, settings_path) -> Result<PtySession>` that spawns `claude` in a PTY with the correct args and env vars
  - The PTY session should: allocate a pty pair, spawn `claude` with args, set `CLAUDE_TASK_ID` env var, return the master handle for reading/writing
  - REFACTOR: Ensure it follows the same session management pattern as existing OpenCode PTY spawn

  **Must NOT do**:
  - Do not use `--output-format` flag (we want interactive TUI)
  - Do not use `-p` flag (that enables headless mode)
  - Do not write `\x03` for interrupt — that's Task 8's concern

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: PTY management is tricky — needs portable-pty knowledge, env var propagation, arg construction
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 5, 8
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/pty_manager.rs:92-200` — Existing PTY spawn for OpenCode. Shows how `portable_pty` is used: `openpty(size)`, `slave.spawn_command(cmd)`, reader thread + async emitter at 60 FPS. Follow this pattern exactly for Claude.
  - `src-tauri/src/pty_manager.rs:202-316` — Session management: how sessions are stored in `HashMap<String, PtySession>`, how reader/emitter tasks are spawned, how cleanup works.

  **API/Type References**:
  - Claude CLI args: `claude "initial prompt"` (new session), `claude --resume <session_id> "follow-up"` (resume), `--settings <path>` (hooks config)
  - `CLAUDE_TASK_ID` env var: set on the spawned process so hooks can identify which task

  **External References**:
  - portable-pty crate docs: CommandBuilder, PtyPair, MasterPty — for PTY spawning API

  **WHY Each Reference Matters**:
  - `pty_manager.rs`: MUST follow the exact same pattern (session HashMap, reader thread, emitter task) for consistency and to work with existing frontend
  - CLI args: Must construct the correct command to get interactive TUI (not headless)

  **Acceptance Criteria**:

  - [ ] Tests verify correct command construction for new/resume scenarios
  - [ ] Tests verify CLAUDE_TASK_ID env var is set
  - [ ] Tests verify `--settings` flag is always present
  - [ ] `cargo test` → spawn function tests PASS

  **QA Scenarios**:

  ```
  Scenario: Claude PTY spawns with correct args for new session
    Tool: Bash (cargo test)
    Preconditions: claude CLI installed
    Steps:
      1. Run unit test that calls spawn_claude_pty with task_id="T-123", prompt="hello", resume=None
      2. Assert command constructed as: claude --settings /path/to/settings.json "hello"
      3. Assert CLAUDE_TASK_ID=T-123 in process env
    Expected Result: Command args and env var are correct
    Failure Indicators: Missing --settings, -p flag present, --output-format present
    Evidence: .sisyphus/evidence/task-3-spawn-new.txt

  Scenario: Claude PTY spawns with resume args
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run unit test with resume_session_id=Some("ses-abc")
      2. Assert command: claude --resume ses-abc --settings /path "follow-up msg"
    Expected Result: --resume flag present with session ID
    Evidence: .sisyphus/evidence/task-3-spawn-resume.txt
  ```

  **Commit**: YES
  - Message: `feat(pty): add Claude Code PTY spawn support`
  - Files: `src-tauri/src/pty_manager.rs` (or `src-tauri/src/claude_pty.rs`)
  - Pre-commit: `cargo test`

- [x] 4. Delete Old Claude Backend Modules

  **What to do**:
  - Delete these files entirely: `src-tauri/src/claude_sdk_manager.rs`, `src-tauri/src/claude_sdk_protocol.rs`, `src-tauri/src/claude_bridge.rs`, `src-tauri/src/claude_process_manager.rs`
  - Delete `src-tauri/src/commands/claude_sdk.rs`
  - Remove `mod` declarations from `src-tauri/src/main.rs` for deleted modules
  - Remove command handler registrations from `generate_handler![]` in main.rs
  - Remove any `use` imports of deleted modules throughout `src-tauri/src/`
  - RED: Write a test that `cargo build` succeeds after deletion (compilation test)
  - GREEN: Delete files, fix all compilation errors
  - REFACTOR: Clean up any orphaned imports or dead code

  **Must NOT do**:
  - Do not delete `pty_manager.rs` — that's staying
  - Do not delete orchestration.rs — that gets updated in Task 5
  - Do not touch frontend files — that's Task 7

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion + fixing imports — straightforward cleanup
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `git-master`: Not needed for deletions within a single task

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 3)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs` — Contains `mod` declarations and `generate_handler![]` macro. Must remove entries for deleted modules here.
  - `src-tauri/src/commands/mod.rs` — Module declarations for command handlers. Must remove `claude_sdk` entry.

  **WHY Each Reference Matters**:
  - `main.rs`: All module wiring lives here — if you miss a `mod` or `generate_handler` entry, cargo build fails
  - `commands/mod.rs`: Command handler module declarations — must stay in sync

  **Acceptance Criteria**:

  - [ ] All 5 files deleted
  - [ ] No `mod claude_sdk_manager`, `mod claude_sdk_protocol`, `mod claude_bridge`, `mod claude_process_manager` in main.rs
  - [ ] `cargo build` → SUCCESS (zero compilation errors)
  - [ ] `grep -r "claude_sdk" src-tauri/src/` → no results

  **QA Scenarios**:

  ```
  Scenario: Codebase compiles after deletion
    Tool: Bash
    Preconditions: Files deleted, imports cleaned up
    Steps:
      1. cargo build 2>&1
      2. Assert exit code 0
      3. grep -r "claude_sdk_manager\|claude_sdk_protocol\|claude_bridge\|claude_process_manager" src-tauri/src/ --include="*.rs"
      4. Assert no matches
    Expected Result: Clean build, no references to deleted modules
    Failure Indicators: Compilation errors, stale imports found
    Evidence: .sisyphus/evidence/task-4-build-after-delete.txt

  Scenario: No dead command registrations
    Tool: Bash
    Preconditions: Files deleted
    Steps:
      1. grep "claude_sdk" src-tauri/src/main.rs
      2. Assert no matches in generate_handler!
    Expected Result: No claude_sdk commands registered
    Evidence: .sisyphus/evidence/task-4-no-dead-commands.txt
  ```

  **Commit**: YES
  - Message: `refactor(claude): delete old SDK backend modules`
  - Files: deleted files + src-tauri/src/main.rs, src-tauri/src/commands/mod.rs
  - Pre-commit: `cargo build`

- [x] 5. Update Orchestration Commands for PTY

  **What to do**:
  - RED: Write tests — `start_implementation` with `provider=claude-code` spawns a Claude PTY (not SDK), `run_action` sends follow-up via PTY resume, `abort_implementation` sends SIGINT
  - GREEN: Rewrite the `claude-code` branches in `src-tauri/src/commands/orchestration.rs`:
    - `start_implementation`: Instead of calling `claude_sdk_manager.start_session()`, call the new Claude PTY spawn function with `--settings` flag, create agent session in DB, emit task-changed event
    - `run_action` (follow-up): Instead of SDK `send_input()`, spawn a new PTY with `--resume <session_id> "action_prompt"` (Claude's own resume mechanism)
    - `abort_implementation`: Instead of SDK process kill, send SIGINT to PTY child PID, then clean up PTY session
  - REFACTOR: Remove any remaining SDK references from orchestration, ensure OpenCode path is untouched

  **Must NOT do**:
  - Do not modify the OpenCode (`else`) branch — only touch the `claude-code` branch
  - Do not use `build_task_prompt()` for Claude — pass the raw action prompt directly
  - Do not import any deleted SDK modules

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Orchestration is the central coordination point — must correctly wire PTY spawn, DB updates, event emission, and cleanup across start/run/abort flows
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Not applicable

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2 (with Tasks 6, 7, 8 — but depends on all of Wave 1)
  - **Blocks**: Tasks 9, 12
  - **Blocked By**: Tasks 1, 2, 3, 4

  **References**:

  **Pattern References**:
  - `src-tauri/src/commands/orchestration.rs:298-585` — The existing `if provider == "claude-code"` block. This entire block needs rewriting to use PTY spawn instead of SDK. Study the OpenCode branch (the `else` block starting ~line 586) for the general flow pattern.
  - `src-tauri/src/commands/orchestration.rs:586-785` — The OpenCode path. This is the reference for how start/run/abort work with OpenCode — the Claude path should follow a similar structure but using PTY.

  **API/Type References**:
  - Task 3's `spawn_claude_pty()` function signature — the PTY spawn function being called here
  - `db.create_agent_session()` — existing DB method for creating sessions
  - `db.update_agent_session()` — existing DB method for status updates

  **WHY Each Reference Matters**:
  - `orchestration.rs` claude-code block: This IS the code being rewritten — must understand current structure to replace it
  - OpenCode path: Shows the proven pattern for PTY-based orchestration that Claude should mirror

  **Acceptance Criteria**:

  - [ ] `start_implementation` with claude-code spawns PTY, creates agent session, emits events
  - [ ] `run_action` resumes existing Claude session via new PTY
  - [ ] `abort_implementation` sends SIGINT to Claude PTY process
  - [ ] OpenCode path unchanged (diff shows no modifications in else block)
  - [ ] `cargo test` → orchestration tests PASS
  - [ ] `cargo build` → SUCCESS

  **QA Scenarios**:

  ```
  Scenario: Start implementation spawns Claude PTY
    Tool: Bash (cargo test)
    Preconditions: PTY spawn function available (Task 3), hooks routes available (Task 1)
    Steps:
      1. Call start_implementation with provider=claude-code, task_id="T-TEST", action_prompt="implement feature X"
      2. Assert Claude PTY session created in pty_manager
      3. Assert agent_session record created in DB with provider="claude-code", status="running"
      4. Assert task status updated to "doing"
    Expected Result: PTY running, DB updated, events emitted
    Failure Indicators: SDK function called instead of PTY, missing DB records
    Evidence: .sisyphus/evidence/task-5-start-pty.txt

  Scenario: OpenCode path not affected
    Tool: Bash
    Preconditions: Orchestration updated
    Steps:
      1. git diff src-tauri/src/commands/orchestration.rs
      2. Verify changes are ONLY within the `if provider == "claude-code"` block
      3. Verify the `else` (OpenCode) block has zero modifications
    Expected Result: Only claude-code block changed
    Evidence: .sisyphus/evidence/task-5-opencode-untouched.txt
  ```

  **Commit**: YES
  - Message: `refactor(orchestration): route Claude tasks through PTY instead of SDK`
  - Files: `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cargo test`

- [x] 6. Hook-to-Status Mapping + DB Persistence

  **What to do**:
  - RED: Write tests — when hook route receives "Stop" event with task_id, agent session status updates to "completed"; when "PreToolUse" received, status stays "running"; when process exits, status = "completed" or "interrupted"
  - GREEN: In the hook route handlers (Task 1), after emitting the Tauri event, also update the agent session in the DB:
    - `PreToolUse` / `PostToolUse` → ensure status is `running`
    - `Stop` → status = `completed` (Claude finished its turn, waiting for input)
    - `SessionEnd` → status = `completed`
    - `Notification` → could indicate idle state
  - Map `CLAUDE_TASK_ID` from the hook request to look up the active agent session
  - Emit `agent-status-changed` Tauri event so frontend badges update

  **Must NOT do**:
  - Do not create a new status enum — reuse existing agent session statuses (running, paused, completed, failed, interrupted)
  - Do not create a complex state machine — simple event-to-status mapping

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Status mapping touches DB layer, event emission, and needs careful thought about edge cases
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7, 8)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/sse_bridge.rs` — How OpenCode SSE events map to agent session statuses. This is the exact same pattern: external event → DB status update → Tauri emit. Follow this mapping approach.
  - `src-tauri/src/db/agents.rs` — `update_agent_session()` method signature and usage

  **API/Type References**:
  - Existing session statuses: `running`, `paused`, `completed`, `failed`, `interrupted` — from `AGENTS.md` documentation
  - Hook event types: PreToolUse, PostToolUse, Stop, SessionEnd, Notification

  **WHY Each Reference Matters**:
  - `sse_bridge.rs`: Shows the proven pattern for external-event-to-status mapping — Claude hooks should work identically
  - `db/agents.rs`: The DB method being called — need to match its signature

  **Acceptance Criteria**:

  - [ ] Hook events correctly map to agent session statuses in DB
  - [ ] `agent-status-changed` Tauri event emitted on status transitions
  - [ ] `cargo test` → status mapping tests PASS

  **QA Scenarios**:

  ```
  Scenario: Stop hook updates session to completed
    Tool: Bash (curl + cargo test)
    Preconditions: Agent session exists in DB with status "running", app HTTP server running
    Steps:
      1. POST /hooks/stop with {"session_id": "test", "CLAUDE_TASK_ID": "T-123"}
      2. Query DB for agent session where task_id = "T-123"
      3. Assert status = "completed"
    Expected Result: DB updated, Tauri event emitted
    Failure Indicators: Status still "running", no event emitted
    Evidence: .sisyphus/evidence/task-6-stop-hook-status.txt

  Scenario: PreToolUse hook keeps status as running
    Tool: Bash (cargo test)
    Preconditions: Session with status "running"
    Steps:
      1. POST /hooks/pre-tool-use with tool info
      2. Assert status remains "running" (no unnecessary DB writes)
    Expected Result: No status change, event still emitted for frontend awareness
    Evidence: .sisyphus/evidence/task-6-pretool-noop.txt
  ```

  **Commit**: YES
  - Message: `feat(hooks): map hook events to agent session status`
  - Files: `src-tauri/src/http_server.rs`, `src-tauri/src/db/agents.rs` (if needed)
  - Pre-commit: `cargo test`

- [x] 7. Delete Old Claude Frontend Components

  **What to do**:
  - Delete these files: `src/components/ClaudeChatView.svelte`, `src/components/ClaudeToolCard.svelte`, `src/components/ClaudeChatMessage.svelte` (and any other Claude-specific chat/tool components)
  - Delete: `src/lib/useClaudeSession.svelte.ts`, `src/lib/formatClaudeEvent.ts`
  - Remove imports of deleted components from `src/components/ClaudeAgentPanel.svelte` (this file gets rewritten in Task 9, but must compile after deletion)
  - Remove any Claude-specific types from `src/lib/types.ts` that are only used by deleted components (e.g., ClaudeChatMessage, ClaudeToolCall types)
  - Remove IPC wrappers in `src/lib/ipc.ts` that called deleted SDK commands (e.g., `sendClaudeInput`, `interruptClaude`, `approveClaudeTool`)
  - RED: `pnpm build` must succeed after deletion
  - GREEN: Delete files, fix all import/type errors
  - REFACTOR: Ensure no orphaned exports in types.ts or ipc.ts

  **Must NOT do**:
  - Do not delete `ClaudeAgentPanel.svelte` — it gets rewritten in Task 9
  - Do not delete `useTerminal.svelte.ts` — that's the xterm composable being reused
  - Do not touch OpenCode components

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: File deletion + import cleanup — straightforward
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8)
  - **Blocks**: Tasks 9, 10
  - **Blocked By**: None (frontend deletions are independent of backend)

  **References**:

  **Pattern References**:
  - `src/components/ClaudeAgentPanel.svelte` — Lists all imports of components being deleted. Check every import statement.
  - `src/lib/ipc.ts` — Contains SDK command wrappers. Search for `claude` or `Claude` to find all wrappers to remove.
  - `src/lib/types.ts` — Contains Claude-specific types. Search for `Claude` prefix.

  **WHY Each Reference Matters**:
  - `ClaudeAgentPanel.svelte`: Must know what it imports to clean up, and must leave it in a compilable state (even if empty/stub) for Task 9
  - `ipc.ts` and `types.ts`: Shared files that may have Claude-specific entries mixed with OpenCode entries — must be surgical

  **Acceptance Criteria**:

  - [ ] All Claude chat/tool components deleted
  - [ ] `useClaudeSession.svelte.ts` and `formatClaudeEvent.ts` deleted
  - [ ] Claude-specific IPC wrappers removed from ipc.ts
  - [ ] Claude-specific types removed from types.ts (if only used by deleted components)
  - [ ] `pnpm build` → SUCCESS
  - [ ] `grep -r "ClaudeChatView\|ClaudeToolCard\|useClaudeSession\|formatClaudeEvent" src/` → no results

  **QA Scenarios**:

  ```
  Scenario: Frontend builds after deletion
    Tool: Bash
    Preconditions: Files deleted, imports cleaned
    Steps:
      1. pnpm build 2>&1
      2. Assert exit code 0
      3. grep -r "ClaudeChatView\|ClaudeToolCard\|useClaudeSession\|formatClaudeEvent" src/ --include="*.ts" --include="*.svelte"
      4. Assert no matches
    Expected Result: Clean build, no references to deleted components
    Failure Indicators: Build errors, stale imports
    Evidence: .sisyphus/evidence/task-7-frontend-build.txt
  ```

  **Commit**: YES
  - Message: `refactor(claude): delete old custom frontend components`
  - Files: deleted files + src/lib/ipc.ts, src/lib/types.ts, src/components/ClaudeAgentPanel.svelte
  - Pre-commit: `pnpm build`

- [x] 8. SIGINT Interrupt + Freeze Detection

  **What to do**:
  - RED: Write tests — sending interrupt to Claude PTY sends SIGINT to child PID (not \x03 to PTY), freeze detection triggers after 15s of no output while process alive
  - GREEN: Add to pty_manager (or claude_pty module):
    - `interrupt_claude(task_id)`: Look up PTY session, get child PID, send `SIGINT` via `nix::sys::signal::kill(pid, Signal::SIGINT)` (or `libc::kill`)
    - Freeze detection: background task monitors each Claude PTY — if no output for 15+ seconds while process is alive, emit `claude-frozen` Tauri event (but do NOT auto-kill)
  - REFACTOR: Make freeze detection configurable (threshold as const)

  **Must NOT do**:
  - Do not write `\x03` to the PTY for interrupt (known Claude bug — it gets ignored)
  - Do not auto-kill frozen processes — only emit a warning event
  - Do not modify OpenCode PTY handling

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Signal handling and process monitoring are system-level concerns requiring careful implementation
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 7)
  - **Blocks**: Task 12
  - **Blocked By**: Task 3

  **References**:

  **Pattern References**:
  - `src-tauri/src/pty_manager.rs` — The PtySession struct holds child process info. Need access to PID for SIGINT.
  - Existing `kill_pty()` function — shows how sessions are cleaned up. Follow similar lookup pattern.

  **External References**:
  - Claude Code GitHub issue #17724 — Ctrl+C sends raw 0x03 not SIGINT, confirming why we need direct SIGINT
  - `nix` crate or `libc::kill` — for sending signals to processes on Unix

  **WHY Each Reference Matters**:
  - `pty_manager.rs`: Need to access the child PID from the session — must understand the data structures
  - Issue #17724: Documents the bug motivating this approach — SIGINT must bypass PTY

  **Acceptance Criteria**:

  - [ ] `interrupt_claude()` sends SIGINT to child PID
  - [ ] Freeze detection emits event after 15s of no output
  - [ ] No `\x03` write anywhere in the interrupt path
  - [ ] `cargo test` → interrupt tests PASS

  **QA Scenarios**:

  ```
  Scenario: Interrupt sends SIGINT to process
    Tool: Bash (cargo test)
    Preconditions: Claude PTY session active
    Steps:
      1. Start a mock child process in a PTY
      2. Call interrupt_claude(task_id)
      3. Assert SIGINT was sent (process received signal, not \x03 byte on PTY)
    Expected Result: Process receives SIGINT signal
    Failure Indicators: PTY receives \x03 instead, process doesn't get signal
    Evidence: .sisyphus/evidence/task-8-sigint.txt

  Scenario: No auto-kill on freeze detection
    Tool: Bash (cargo test)
    Preconditions: Claude PTY with no output for 20s, process alive
    Steps:
      1. Simulate PTY with no output for 20s
      2. Assert `claude-frozen` event emitted
      3. Assert process is STILL alive (not killed)
    Expected Result: Warning emitted, process untouched
    Evidence: .sisyphus/evidence/task-8-freeze-detection.txt
  ```

  **Commit**: YES
  - Message: `feat(pty): add SIGINT interrupt and freeze detection for Claude`
  - Files: `src-tauri/src/pty_manager.rs` (or `claude_pty.rs`)
  - Pre-commit: `cargo test`

- [x] 9. Rewrite ClaudeAgentPanel as xterm.js Terminal

  **What to do**:
  - RED: Write vitest tests — component renders an xterm.js terminal, listens to `pty-output-{task_id}` events, writes data to terminal, sends user input to PTY via `writeToPty`
  - GREEN: Rewrite `src/components/ClaudeAgentPanel.svelte` to follow the exact same pattern as `src/components/OpenCodeAgentPanel.svelte`:
    - Use `createTerminal()` from `useTerminal.svelte.ts`
    - Listen to `pty-output-{task_id}` Tauri events, write data to terminal
    - On user input (terminal.onData), call `writeToPty(taskId, data)` IPC
    - On resize, call `resizePty(taskId, cols, rows)` IPC
    - Show session status from store (running/completed/paused badge)
  - REFACTOR: Extract any common patterns between OpenCode and Claude panels if they emerge

  **Must NOT do**:
  - Do not render custom chat messages or tool cards
  - Do not import or use `useClaudeSession` (deleted in Task 7)
  - Do not add UI overlays for permissions — user interacts in the terminal directly

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: Svelte 5 component with xterm.js integration, terminal rendering, event handling
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Terminal UI integration with proper sizing, resize handling, and visual polish

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Tasks 11, 12
  - **Blocked By**: Tasks 5, 6, 7

  **References**:

  **Pattern References**:
  - `src/components/OpenCodeAgentPanel.svelte` — THE reference. This is exactly what ClaudeAgentPanel should look like. Copy the structure: terminal setup, PTY event listener, input handler, resize handler, status display.
  - `src/lib/useTerminal.svelte.ts` — The xterm.js composable. Shows how to create terminal, attach to DOM, handle resize with FitAddon, configure scrollback.

  **API/Type References**:
  - `writeToPty(taskId, data)` — IPC wrapper in `src/lib/ipc.ts` for sending user input to PTY
  - `resizePty(taskId, cols, rows)` — IPC wrapper for terminal resize
  - `pty-output-{task_id}` — Tauri event name pattern for PTY output

  **WHY Each Reference Matters**:
  - `OpenCodeAgentPanel.svelte`: This IS the proven pattern being replicated — every line is relevant
  - `useTerminal.svelte.ts`: The composable provides terminal creation — must use it correctly (onData callback, onResize callback)

  **Acceptance Criteria**:

  - [ ] Component renders xterm.js terminal
  - [ ] PTY output displays in terminal
  - [ ] User input goes to PTY
  - [ ] Terminal resizes correctly
  - [ ] Status badge shows from hook events
  - [ ] `pnpm vitest run src/components/ClaudeAgentPanel.test.ts` → PASS
  - [ ] `pnpm build` → SUCCESS

  **QA Scenarios**:

  ```
  Scenario: Terminal renders and receives PTY output
    Tool: Playwright
    Preconditions: Claude PTY running for a task, app open
    Steps:
      1. Navigate to task with Claude provider
      2. Wait for `.xterm-screen` element to appear
      3. Assert terminal canvas is visible and has content (not blank)
      4. Take screenshot
    Expected Result: xterm.js terminal visible with Claude TUI content
    Failure Indicators: Blank terminal, missing xterm-screen element, custom chat UI visible
    Evidence: .sisyphus/evidence/task-9-terminal-render.png

  Scenario: User input reaches Claude
    Tool: Playwright + interactive_bash
    Preconditions: Claude PTY running, waiting for input
    Steps:
      1. Focus the terminal element
      2. Type "hello" into the terminal
      3. Assert PTY receives the input (check Claude output changes)
    Expected Result: Claude responds to typed input
    Failure Indicators: Input not sent, terminal unresponsive
    Evidence: .sisyphus/evidence/task-9-terminal-input.png
  ```

  **Commit**: YES
  - Message: `feat(frontend): rewrite ClaudeAgentPanel as xterm.js terminal`
  - Files: `src/components/ClaudeAgentPanel.svelte`, `src/components/ClaudeAgentPanel.test.ts`
  - Pre-commit: `pnpm test`

- [x] 10. Update AgentPanel Provider Routing

  **What to do**:
  - RED: Write test — AgentPanel routes to ClaudeAgentPanel (now a terminal) when provider is "claude-code", routes to OpenCodeAgentPanel when provider is "opencode"
  - GREEN: Update `src/components/AgentPanel.svelte` (or wherever the routing happens) to conditionally render the correct panel based on provider. Since both panels are now terminals, the routing may simplify — but keep them separate components for provider-specific logic (PTY event names, status sources)
  - REFACTOR: Ensure clean conditional rendering with no dead branches

  **Must NOT do**:
  - Do not merge Claude and OpenCode panels into one — keep separate for maintainability
  - Do not change OpenCode panel behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Simple conditional rendering update in a routing component
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 9, 11)
  - **Blocks**: Task 12
  - **Blocked By**: Tasks 6, 7

  **References**:

  **Pattern References**:
  - `src/components/AgentPanel.svelte` (or equivalent routing component) — The current provider routing. Update the claude-code branch to render the rewritten ClaudeAgentPanel.
  - `src/lib/stores.ts` — Where provider preference is stored, if applicable

  **WHY Each Reference Matters**:
  - `AgentPanel.svelte`: This is the file being modified — must understand current routing logic

  **Acceptance Criteria**:

  - [ ] Claude tasks render ClaudeAgentPanel (terminal)
  - [ ] OpenCode tasks render OpenCodeAgentPanel (terminal) — unchanged
  - [ ] `pnpm test` → routing tests PASS
  - [ ] `pnpm build` → SUCCESS

  **QA Scenarios**:

  ```
  Scenario: Provider routing renders correct panel
    Tool: Bash (vitest)
    Preconditions: None
    Steps:
      1. pnpm vitest run src/components/AgentPanel.test.ts
      2. Assert tests for claude-code provider → ClaudeAgentPanel
      3. Assert tests for opencode provider → OpenCodeAgentPanel
    Expected Result: All routing tests pass
    Evidence: .sisyphus/evidence/task-10-routing.txt
  ```

  **Commit**: YES
  - Message: `refactor(frontend): update AgentPanel provider routing`
  - Files: `src/components/AgentPanel.svelte` (or equivalent)
  - Pre-commit: `pnpm build`

- [x] 11. Terminal Persistence (Buffer + Reconnect)

  **What to do**:
  - RED: Write tests — when user navigates away from a task, PTY stays alive and output is buffered; when user returns, buffered output is flushed to terminal; when process exits while away, status updates correctly
  - GREEN: Implement terminal persistence in the PTY manager:
    - PTY process keeps running when user switches tasks (don't kill on navigate-away)
    - Buffer PTY output when no frontend listener is active (store in-memory ring buffer, e.g. last 50KB)
    - When frontend reconnects (user navigates back), flush buffer to the terminal
    - When process exits while user is away, mark session as completed via normal hook flow
  - Frontend: ClaudeAgentPanel should on mount check if PTY session exists and reconnect (listen to events, request buffer flush)
  - REFACTOR: Make buffer size configurable, ensure memory doesn't grow unbounded

  **Must NOT do**:
  - Do not kill the PTY when user navigates away
  - Do not persist raw ANSI bytes to the SQLite DB (too much data, not useful for replay)
  - Do not buffer more than 50KB of output (memory guard)

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Involves PTY lifecycle management, buffer strategies, reconnection logic across frontend/backend boundary
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 12
  - **Blocked By**: Task 9

  **References**:

  **Pattern References**:
  - `src-tauri/src/pty_manager.rs` — Existing PTY output emission (reader thread + emitter task). The buffering needs to integrate here — when no listener is active, buffer instead of emit.
  - `src/components/OpenCodeAgentPanel.svelte` — How OpenCode handles mount/unmount and PTY reconnection. Follow similar lifecycle.

  **WHY Each Reference Matters**:
  - `pty_manager.rs`: The buffering logic lives in the emitter task — must understand the current output flow to add conditional buffering
  - `OpenCodeAgentPanel.svelte`: Shows the reconnection pattern on component mount

  **Acceptance Criteria**:

  - [ ] PTY stays alive when user navigates away
  - [ ] Output buffered (max 50KB ring buffer) while no listener active
  - [ ] Buffer flushed to terminal on reconnect
  - [ ] Process exit while away correctly updates session status
  - [ ] `cargo test` → buffer tests PASS

  **QA Scenarios**:

  ```
  Scenario: PTY survives tab switch and reconnects
    Tool: Playwright
    Preconditions: Claude PTY running, producing output
    Steps:
      1. Navigate to task, verify terminal has content
      2. Switch to a different task (navigate away)
      3. Wait 5 seconds (Claude produces more output)
      4. Navigate back to original task
      5. Assert terminal shows content that was produced while away
    Expected Result: Terminal shows buffered output, no gaps
    Failure Indicators: Terminal blank on return, PTY killed, output lost
    Evidence: .sisyphus/evidence/task-11-persistence.png

  Scenario: Buffer doesn't grow unbounded
    Tool: Bash (cargo test)
    Preconditions: Buffer configured at 50KB
    Steps:
      1. Write 100KB of data to buffer
      2. Assert buffer size <= 50KB (oldest data dropped)
    Expected Result: Ring buffer stays within bounds
    Evidence: .sisyphus/evidence/task-11-buffer-limit.txt
  ```

  **Commit**: YES
  - Message: `feat(pty): add terminal persistence with output buffering`
  - Files: `src-tauri/src/pty_manager.rs`, `src/components/ClaudeAgentPanel.svelte`
  - Pre-commit: `cargo test && pnpm build`

- [ ] 12. End-to-End Integration Test

  **What to do**:
  - Write an integration test that exercises the full flow:
    1. App starts, HTTP server running, hooks settings file generated
    2. Start implementation for a task with provider=claude-code
    3. Claude PTY spawns, terminal renders in frontend
    4. Hook events fire and update session status
    5. Status badge on task card reflects current state
    6. User can type in terminal
    7. Interrupt works (SIGINT)
    8. Session resume works after process exits
  - This is the capstone test ensuring all pieces work together

  **Must NOT do**:
  - Do not require a real Claude API key — mock Claude or use a simple script that behaves like Claude
  - Do not test OpenCode — only test Claude PTY flow

  **Recommended Agent Profile**:
  - **Category**: `deep`
    - Reason: Integration test spanning backend (PTY, hooks, DB) and frontend (terminal, status) — needs holistic understanding
  - **Skills**: [`playwright`]
    - `playwright`: For browser-based verification of terminal rendering and interaction

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4
  - **Blocks**: F1-F4
  - **Blocked By**: Tasks 5, 8, 9, 10, 11

  **References**:

  **Pattern References**:
  - All previous tasks — this test exercises every component built in Tasks 1-11
  - `src-tauri/src/commands/orchestration.rs` — The entry point for starting Claude implementation

  **WHY Each Reference Matters**:
  - This test validates the entire integration — references are to every component being tested

  **Acceptance Criteria**:

  - [ ] Integration test passes end-to-end
  - [ ] `cargo test` + `pnpm test` → ALL PASS
  - [ ] `cargo build` + `pnpm build` → SUCCESS

  **QA Scenarios**:

  ```
  Scenario: Full Claude PTY flow
    Tool: Playwright + interactive_bash
    Preconditions: App running, Claude CLI installed (or mocked)
    Steps:
      1. Create a task with provider=claude-code
      2. Click "Start Implementation" with a simple prompt
      3. Wait for xterm.js terminal to appear with Claude TUI content
      4. Verify task card badge shows "running"
      5. Wait for Claude to finish (or mock completion)
      6. Verify task card badge updates to "completed"
      7. Navigate away and back — verify terminal still has content
      8. Start a follow-up action — verify resume works
    Expected Result: Complete flow works without custom UI, pure terminal experience
    Failure Indicators: Custom chat UI appears, terminal blank, status not updating
    Evidence: .sisyphus/evidence/task-12-e2e-flow.png

  Scenario: Interrupt flow
    Tool: Playwright + interactive_bash
    Preconditions: Claude PTY running
    Steps:
      1. While Claude is executing, trigger abort
      2. Verify SIGINT sent (Claude shows interrupt message in TUI)
      3. Verify session status changes to "interrupted"
    Expected Result: Claude interrupted cleanly, status updated
    Evidence: .sisyphus/evidence/task-12-interrupt.png
  ```

  **Commit**: YES
  - Message: `test(integration): add end-to-end Claude PTY + hooks test`
  - Files: test files
  - Pre-commit: `cargo test && pnpm test`

- [x] 13. Startup Hooks File Generation + Cleanup

  **What to do**:
  - RED: Write test — on app startup, after HTTP server port is known, `generate_hooks_settings(port)` is called and file is written
  - GREEN: In `src-tauri/src/main.rs` (or the setup function), after the HTTP server starts and port is determined, call the hooks settings generator (Task 2) to write/overwrite `~/.ai-command-center/claude-hooks-settings.json`
  - Ensure this runs on every startup (handles port changes)
  - REFACTOR: Clean ordering — HTTP server starts first, then hooks file generated

  **Must NOT do**:
  - Do not generate the file before the HTTP server port is known
  - Do not skip generation if file already exists (port may have changed)

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Single function call in the startup sequence — trivial wiring
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 4 (with Task 12)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `src-tauri/src/main.rs:203-209` — Where HTTP server starts. The hooks generation call goes after this.
  - Task 2's `generate_hooks_settings(port)` function — the function being called here

  **WHY Each Reference Matters**:
  - `main.rs`: Must add the call at the right point in the startup sequence — after HTTP server, before any Claude PTY spawn

  **Acceptance Criteria**:

  - [ ] Hooks file generated on every startup
  - [ ] File contains correct port (matching HTTP server)
  - [ ] `cargo test` → startup sequence test PASS

  **QA Scenarios**:

  ```
  Scenario: Hooks file generated on startup
    Tool: Bash
    Preconditions: App not running
    Steps:
      1. Delete ~/.ai-command-center/claude-hooks-settings.json if exists
      2. Start the app (pnpm tauri:dev or cargo run)
      3. Wait for startup complete
      4. Assert file exists at ~/.ai-command-center/claude-hooks-settings.json
      5. Read file, verify hook URLs contain the correct HTTP server port
    Expected Result: File exists with correct hook configuration
    Failure Indicators: File missing, wrong port, invalid JSON
    Evidence: .sisyphus/evidence/task-13-startup-hooks.txt
  ```

  **Commit**: YES
  - Message: `feat(startup): generate Claude hooks settings on app launch`
  - Files: `src-tauri/src/main.rs`
  - Pre-commit: `cargo build`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, curl endpoint, run command). For each "Must NOT Have": search codebase for forbidden patterns (NDJSON parsing of Claude, writes to ~/.claude/settings.json, \x03 for interrupt) — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build` + `cargo test` + `pnpm build` + `pnpm test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names (data/result/item/temp). Verify no dead code from deleted Claude components remains.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill if UI)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (hooks fire while terminal displays, status badges update while Claude runs). Test edge cases: empty state, invalid input, rapid tab switching. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination: Task N touching Task M's files. Flag unaccounted changes. Verify ALL old Claude components are deleted with no remnants.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Task 1**: `feat(hooks): add HTTP hook routes for Claude status events` — src-tauri/src/http_server.rs
- **Task 2**: `feat(hooks): add Claude hooks settings file generator` — src-tauri/src/claude_hooks.rs
- **Task 3**: `feat(pty): add Claude Code PTY spawn support` — src-tauri/src/pty_manager.rs
- **Task 4**: `refactor(claude): delete old SDK backend modules` — multiple src-tauri files
- **Task 5**: `refactor(orchestration): route Claude tasks through PTY instead of SDK` — src-tauri/src/commands/orchestration.rs
- **Task 6**: `feat(hooks): map hook events to agent session status` — src-tauri/src/commands/agents.rs, db
- **Task 7**: `refactor(claude): delete old custom frontend components` — src/components/, src/lib/
- **Task 8**: `feat(pty): add SIGINT interrupt and freeze detection for Claude` — src-tauri/src/pty_manager.rs
- **Task 9**: `feat(frontend): rewrite ClaudeAgentPanel as xterm.js terminal` — src/components/ClaudeAgentPanel.svelte
- **Task 10**: `refactor(frontend): update AgentPanel provider routing` — src/components/AgentPanel.svelte
- **Task 11**: `feat(pty): add terminal persistence with output buffering` — src-tauri/src/pty_manager.rs, frontend
- **Task 12**: `test(integration): add end-to-end Claude PTY + hooks test` — tests
- **Task 13**: `feat(startup): generate Claude hooks settings on app launch` — src-tauri/src/main.rs

---

## Success Criteria

### Verification Commands
```bash
cargo build                    # Expected: success, no errors
cargo test                     # Expected: all tests pass
pnpm build                     # Expected: success, no errors
pnpm test                      # Expected: all tests pass
grep -r "claude_sdk" src-tauri/src/  # Expected: no results (deleted)
grep -r "ClaudeChatView" src/        # Expected: no results (deleted)
grep -r "stream-json" src-tauri/     # Expected: no results related to Claude
```

### Final Checklist
- [ ] Claude TUI renders in xterm.js terminal
- [ ] User can interact directly (type, approve permissions)
- [ ] Hook events update task card badges
- [ ] Terminal persists when switching tasks
- [ ] Session resume works
- [ ] All old Claude components deleted
- [ ] All tests pass
- [ ] No dead code remnants
