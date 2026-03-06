# MCP Server + Dynamic Task Titles & TLDR Summaries

## TL;DR

> **Quick Summary**: Build an MCP server that enables AI agents to dynamically update task titles and TLDR summaries. Separate the concept of "prompt" (user instruction) from "title" (agent-generated). Migrate the existing `create_task` OpenCode plugin into the MCP server.
> 
> **Deliverables**:
> - MCP server (TypeScript, stdio transport) with `create_task`, `update_task`, `get_task_info` tools
> - DB migration adding `prompt` and `summary` fields to tasks table
> - Auto-configuration for both Claude Code and OpenCode providers
> - Frontend updates: AddTaskDialog prompt field, kanban card TLDR subtitle, task detail summary section
> - Updated `build_task_prompt` to use new `prompt` field
> 
> **Estimated Effort**: Large
> **Parallel Execution**: YES — 3 waves + final verification
> **Critical Path**: Task 1 (DB migration) → Task 4 (HTTP endpoint) → Task 7 (MCP server) → Task 9 (auto-config) → Final verification

---

## Context

### Original Request
User wants task titles to update dynamically based on what the AI agent discovers during work. Currently the task "title" IS the prompt sent to the agent — these need to be separated. Also wants TLDR summaries for context when switching between tasks. User asked whether to use MCP, CLI, or extend the existing OpenCode plugin approach.

### Interview Summary
**Key Discussions**:
- **Architecture**: MCP server chosen over extending tools or CLI — standard protocol, both providers support it, single integration point
- **Title generation**: Agent-driven (via tool call), progressive updates during work
- **Prompt/title split**: Rename UI field from "Title" to "Prompt". Title starts empty, agent generates it.
- **TLDR display**: Kanban card subtitle + task detail info panel (popover deferred)
- **Migration**: Move existing `create_task` plugin into MCP server
- **Auto-config**: App writes MCP config for both providers on startup
- **Runtime**: Node.js for MCP server (users already have it via pnpm)

**Research Findings**:
- `plugin_installer.rs`: Existing `create_task.ts` plugin has auth bug (missing bearer token header)
- `orchestration.rs:5-28`: `build_task_prompt()` uses `task.title` as prompt — must change
- `orchestration.rs:169,327`: `slugify_branch_name(&task_id, &task.title)` — must use prompt field
- `db/mod.rs:109`: `title TEXT NOT NULL` constraint — keep constraint, use empty string default
- `TaskInfoPanel.svelte:67`: Already labels title as "INITIAL_PROMPT" — semantic intent exists
- Test infrastructure: vitest + cargo test both present, AGENTS.md mandates TDD

### Metis Review
**Identified Gaps** (addressed):
- **Auth bug in create_task plugin**: Moot — migrating to MCP which handles auth correctly
- **Branch naming with empty title**: Use prompt field for `slugify_branch_name`
- **`title NOT NULL` constraint**: Keep constraint, empty string default, UI shows fallback
- **Existing data migration**: Copy `title → prompt` for all rows, keep title as-is
- **MCP config merge**: Must merge, not overwrite user's existing config
- **Token regeneration**: MCP server reads token at invocation time via env var, not at config parse time
- **Task-switching popover scope creep**: Deferred — TLDR on card + detail only

---

## Work Objectives

### Core Objective
Enable AI agents to dynamically update task titles and summaries via an MCP server, while separating the immutable user prompt from the evolving agent-generated title.

### Concrete Deliverables
- `src-tauri/src/mcp-server/` — TypeScript MCP server with 3 tools
- DB migration V6 adding `prompt TEXT` and `summary TEXT` columns
- Updated Rust backend: new `TaskRow` fields, `build_task_prompt` change, HTTP endpoint
- Updated frontend: AddTaskDialog, TaskCard, TaskInfoPanel, IPC wrappers
- Auto-config installer replacing `plugin_installer.rs`

### Definition of Done
- [ ] `cargo test` passes (all existing + new tests)
- [ ] `pnpm test -- --run` passes
- [ ] MCP server responds to JSON-RPC initialize + tool calls
- [ ] Creating a task from UI stores prompt, shows it in detail view
- [ ] Agent can update title and summary via MCP tools
- [ ] Both Claude Code and OpenCode configs are written on app startup

### Must Have
- Prompt field stored separately, immutable after creation
- Agent can update title via `update_task` MCP tool
- Agent can set summary via `update_task` MCP tool
- TLDR visible on kanban card as subtitle
- TLDR visible in task detail info panel
- `build_task_prompt` uses prompt field (not title)
- Branch naming uses prompt field
- Backward compat: existing tasks get prompt backfilled from title
- MCP auto-configured for both providers on startup
- `create_task` migrated to MCP server

### Must NOT Have (Guardrails)
- Task-switching popover (deferred to separate task)
- Chat/streaming from MCP server
- Agent auto-start or notification system for title updates
- Undo/history for title changes
- Summary editing UI
- Changes to Jira sync, GitHub polling, PR review, self-review, whisper, or any other subsystem
- Over-abstracted "tool framework" — just the 3 specific MCP tools needed
- Overwriting user's existing MCP configuration — must merge

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + cargo test)
- **Automated tests**: TDD (per AGENTS.md)
- **Framework**: vitest (frontend), cargo test (Rust)
- **Each task follows**: RED (failing test) → GREEN (minimal impl) → REFACTOR

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Rust backend**: Use Bash (`cargo test`) — run specific test modules, verify pass/fail
- **Frontend**: Use Bash (`pnpm test`) — run vitest, verify component behavior
- **MCP server**: Use Bash (echo JSON-RPC | node) — send initialize + tool calls, verify responses
- **HTTP API**: Use Bash (curl) — send requests, assert status + response fields
- **DB**: Use Bash (sqlite3) — verify schema, query data

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — data layer + MCP scaffolding):
├── Task 1: DB migration V6 — add prompt + summary columns [quick]
├── Task 2: Update Rust TaskRow + query functions [quick]
├── Task 3: MCP server scaffolding (package.json, tsconfig, stdio transport) [unspecified-high]
└── Task 4: HTTP /update_task endpoint [quick]

Wave 2 (After Wave 1 — core logic + MCP tools + frontend):
├── Task 5: Update build_task_prompt + branch naming [quick]
├── Task 6: MCP create_task tool [unspecified-high]
├── Task 7: MCP update_task + get_task_info tools [unspecified-high]
├── Task 8: Frontend — AddTaskDialog prompt field + IPC [visual-engineering]
├── Task 9: Frontend — TaskCard TLDR subtitle [visual-engineering]
└── Task 10: Frontend — TaskInfoPanel summary + prompt display [visual-engineering]

Wave 3 (After Wave 2 — auto-config + cleanup):
├── Task 11: MCP auto-config installer (replace plugin_installer) [unspecified-high]
├── Task 12: Update frontend IPC + stores for new fields [quick]
└── Task 13: Build verification + integration test [deep]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 2 → Task 5 → Task 4 → Task 7 → Task 11 → Task 13 → F1-F4
Parallel Speedup: ~60% faster than sequential
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks |
|------|-----------|--------|
| 1 | — | 2, 5, 8, 9, 10, 12 |
| 2 | 1 | 4, 5, 12 |
| 3 | — | 6, 7 |
| 4 | 2 | 6, 7, 11, 13 |
| 5 | 1, 2 | 13 |
| 6 | 3, 4 | 11, 13 |
| 7 | 3, 4 | 11, 13 |
| 8 | 1 | 13 |
| 9 | 1 | 13 |
| 10 | 1 | 13 |
| 11 | 4, 6, 7 | 13 |
| 12 | 1, 2 | 13 |
| 13 | all above | F1-F4 |

### Agent Dispatch Summary

- **Wave 1**: **4 tasks** — T1 → `quick`, T2 → `quick`, T3 → `unspecified-high`, T4 → `quick`
- **Wave 2**: **6 tasks** — T5 → `quick`, T6 → `unspecified-high`, T7 → `unspecified-high`, T8-T10 → `visual-engineering`
- **Wave 3**: **3 tasks** — T11 → `unspecified-high`, T12 → `quick`, T13 → `deep`
- **FINAL**: **4 tasks** — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. DB Migration V6 — Add prompt + summary columns

  **What to do**:
  - Write a failing test for V6 migration: verify `prompt` and `summary` columns exist after migration
  - Add migration V6 to `ensure_latest_schema()` in `src-tauri/src/db/mod.rs`:
    - `ALTER TABLE tasks ADD COLUMN prompt TEXT;`
    - `ALTER TABLE tasks ADD COLUMN summary TEXT;`
    - `UPDATE tasks SET prompt = title WHERE prompt IS NULL;` (backfill existing data)
  - Update the `CURRENT_VERSION` constant to 6
  - Verify test passes

  **Must NOT do**:
  - Do NOT change the `title NOT NULL` constraint
  - Do NOT drop or rename any existing columns
  - Do NOT touch any tables other than `tasks`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - Simple ALTER TABLE + data backfill, follows existing V5 migration pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3, 4)
  - **Blocks**: Tasks 2, 5, 8, 9, 10, 12
  - **Blocked By**: None (can start immediately)

  **References**:
  **Pattern References**:
  - `src-tauri/src/db/mod.rs:406-419` — V5 migration pattern (ALTER TABLE + UPDATE backfill + version bump)
  - `src-tauri/src/db/mod.rs:109` — Current schema showing `title TEXT NOT NULL` constraint

  **Test References**:
  - `src-tauri/src/db/mod.rs:440-475` — Existing migration tests pattern (`test_ensure_latest_schema_*`)

  **WHY Each Reference Matters**:
  - V5 migration shows the exact pattern: ALTER TABLE, backfill UPDATE, version bump. Follow this exactly for V6.
  - Schema line confirms title constraint stays untouched.

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test file: add `test_migration_v6_adds_prompt_and_summary` to `src-tauri/src/db/mod.rs` tests
  - [ ] `cd src-tauri && cargo test test_migration_v6` → PASS

  **QA Scenarios:**

  ```
  Scenario: Migration adds both columns to existing database
    Tool: Bash (cargo test)
    Preconditions: Fresh test database at schema V5
    Steps:
      1. Run `cd src-tauri && cargo test test_migration_v6 -- --nocapture`
      2. Verify test creates V5 DB, runs migration, checks PRAGMA table_info for prompt and summary
    Expected Result: Test passes, both columns present
    Failure Indicators: Test fails, column missing from PRAGMA output
    Evidence: .sisyphus/evidence/task-1-migration-v6.txt

  Scenario: Backfill copies title to prompt for existing rows
    Tool: Bash (cargo test)
    Preconditions: V5 database with existing tasks
    Steps:
      1. Run `cd src-tauri && cargo test test_migration_v6_backfill -- --nocapture`
      2. Verify test creates tasks at V5, migrates to V6, checks prompt == title for existing rows
    Expected Result: All existing tasks have prompt field matching their title
    Failure Indicators: prompt is NULL or empty for existing tasks
    Evidence: .sisyphus/evidence/task-1-migration-backfill.txt
  ```

  **Commit**: YES
  - Message: `feat(db): add V6 migration for prompt and summary columns`
  - Files: `src-tauri/src/db/mod.rs`
  - Pre-commit: `cd src-tauri && cargo test test_migration_v6`

- [x] 2. Update Rust TaskRow struct + query functions

  **What to do**:
  - Write failing tests: verify `TaskRow` has `prompt` and `summary` fields, verify `create_task` stores prompt
  - Add `prompt: Option<String>` and `summary: Option<String>` to `TaskRow` struct in `src-tauri/src/db/tasks.rs`
  - Update ALL SQL SELECT queries in `tasks.rs` to include `prompt, summary` columns
  - Update `create_task()` to accept and store an optional `prompt` parameter
  - Update `row_to_task()` helper (or equivalent mapping) to read new columns
  - Add `update_task_title_and_summary()` function: updates `title` and/or `summary` by task ID
  - Verify all tests pass

  **Must NOT do**:
  - Do NOT change the `update_task()` function signature yet (that's Task 12)
  - Do NOT change any Tauri command signatures yet

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - Straightforward struct + SQL updates following existing patterns

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 1)
  - **Parallel Group**: Wave 1 (starts after Task 1)
  - **Blocks**: Tasks 4, 5, 12
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src-tauri/src/db/tasks.rs:6-18` — Current `TaskRow` struct with all fields
  - `src-tauri/src/db/tasks.rs:23-47` — `get_all_tasks()` SQL query pattern (must add new columns)
  - `src-tauri/src/db/tasks.rs:52-97` — `create_task()` function (must accept prompt param)
  - `src-tauri/src/db/tasks.rs:172-184` — `update_task()` pattern for new `update_task_title_and_summary()`

  **Test References**:
  - `src-tauri/src/db/tasks.rs:325-` — Existing task CRUD tests (follow this pattern)

  **WHY Each Reference Matters**:
  - TaskRow struct shows exact field naming convention (`snake_case`, `Option<String>` for nullable)
  - SQL queries show the column ordering pattern — new columns must be added consistently everywhere
  - `update_task()` shows the pattern for UPDATE queries with event emission

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test: `test_create_task_with_prompt` verifies prompt field stored and retrieved
  - [ ] Test: `test_update_task_title_and_summary` verifies title and summary update
  - [ ] `cd src-tauri && cargo test db::tasks` → ALL PASS

  **QA Scenarios:**

  ```
  Scenario: TaskRow includes new fields
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_create_task_with_prompt -- --nocapture`
      2. Verify test creates task with prompt, retrieves it, asserts prompt field matches
    Expected Result: prompt field round-trips through create + get
    Failure Indicators: Compilation error (missing field) or assertion failure
    Evidence: .sisyphus/evidence/task-2-taskrow-fields.txt

  Scenario: Title and summary can be updated independently
    Tool: Bash (cargo test)
    Preconditions: Task exists in DB
    Steps:
      1. Run `cd src-tauri && cargo test test_update_task_title_and_summary -- --nocapture`
      2. Verify: update title only → title changes, summary unchanged
      3. Verify: update summary only → summary changes, title unchanged
      4. Verify: update both → both change
    Expected Result: Independent field updates work correctly
    Failure Indicators: One field overwrites the other, or NULL handling fails
    Evidence: .sisyphus/evidence/task-2-update-title-summary.txt
  ```

  **Commit**: YES (groups with Task 1)
  - Message: `feat(db): add prompt and summary fields to TaskRow`
  - Files: `src-tauri/src/db/tasks.rs`
  - Pre-commit: `cd src-tauri && cargo test db::tasks`

- [x] 3. MCP Server Scaffolding — package.json, transport, entry point

  **What to do**:
  - Create `src-tauri/src/mcp-server/` directory
  - Create `package.json` with dependencies: `@modelcontextprotocol/sdk`
  - Create `index.js` (or `index.ts` + compile step) entry point with:
    - Stdio transport setup (stdin/stdout JSON-RPC)
    - MCP server initialization with `initialize` handler
    - Empty tool list (tools added in Tasks 6, 7)
    - Read `OPENFORGE_HTTP_TOKEN` and `OPENFORGE_HTTP_PORT` from env vars
  - Test that the server starts, responds to `initialize`, and lists empty tools

  **Must NOT do**:
  - Do NOT implement actual tool logic yet (Tasks 6, 7)
  - Do NOT set up SSE transport — stdio only
  - Do NOT add any framework beyond the MCP SDK

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - MCP server setup requires understanding the MCP protocol and SDK

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2, 4)
  - **Blocks**: Tasks 6, 7
  - **Blocked By**: None (can start immediately)

  **References**:
  **External References**:
  - MCP SDK docs: https://modelcontextprotocol.io/docs/concepts/tools — Tool definition format
  - MCP TypeScript SDK: `@modelcontextprotocol/sdk` npm package — Server class, StdioServerTransport

  **Pattern References**:
  - `src-tauri/src/plugin_installer.rs:5-42` — Current create_task tool code showing HTTP API call pattern + env var reading. The MCP server will follow the same HTTP call pattern.

  **WHY Each Reference Matters**:
  - MCP SDK docs define the JSON-RPC protocol the server must speak
  - Existing plugin shows how to call the HTTP API (port from env, bearer auth, JSON body) — MCP tools will use same pattern

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: MCP server starts and responds to initialize
    Tool: Bash (echo + node)
    Preconditions: npm install in mcp-server directory
    Steps:
      1. Run `cd src-tauri/src/mcp-server && npm install`
      2. Run `echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | node index.js 2>/dev/null`
      3. Parse JSON response
    Expected Result: Response contains `"result"` with `"capabilities"` including `"tools"` capability
    Failure Indicators: No output, JSON parse error, or missing tools capability
    Evidence: .sisyphus/evidence/task-3-mcp-initialize.txt

  Scenario: MCP server handles tools/list with empty list
    Tool: Bash (echo + node)
    Preconditions: MCP server initialized
    Steps:
      1. Send initialize + tools/list JSON-RPC messages via stdin pipe
      2. Parse second response
    Expected Result: Response contains `"result"` with empty `"tools"` array
    Failure Indicators: Error response or non-empty tools list
    Evidence: .sisyphus/evidence/task-3-mcp-tools-list.txt
  ```

  **Commit**: YES
  - Message: `feat(mcp): scaffold MCP server with stdio transport`
  - Files: `src-tauri/src/mcp-server/package.json`, `src-tauri/src/mcp-server/index.js`
  - Pre-commit: MCP initialize test

- [x] 4. HTTP /update_task Endpoint

  **What to do**:
  - Write failing test for the new endpoint
  - Add `UpdateTaskRequest` struct to `http_server.rs`: `task_id: String`, `title: Option<String>`, `summary: Option<String>`
  - Add `update_task_handler` function that:
    - Validates at least one of title/summary is provided
    - Calls `db.update_task_title_and_summary()` (from Task 2)
    - Emits `task-changed` event with `action: "updated"`
    - Returns 200 OK with updated task info
  - Register route: `.route("/update_task", post(update_task_handler))`
  - Write tests for: valid update, partial update (title only, summary only), missing task, empty body

  **Must NOT do**:
  - Do NOT change existing `/create_task` endpoint (migration happens in Task 11)
  - Do NOT add authentication bypass

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - Follows exact pattern of existing `create_task_handler`

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Task 2)
  - **Parallel Group**: Wave 1 (starts after Task 2)
  - **Blocks**: Tasks 6, 7, 11, 13
  - **Blocked By**: Task 2

  **References**:
  **Pattern References**:
  - `src-tauri/src/http_server.rs:48-68` — `CreateTaskRequest`/`CreateTaskResponse` structs (follow naming/shape)
  - `src-tauri/src/http_server.rs:89-133` — `create_task_handler` (follow exact pattern: lock DB, call method, emit event, return JSON)
  - `src-tauri/src/http_server.rs:262-273` — Router registration (add new route here)

  **Test References**:
  - `src-tauri/src/http_server.rs:444-630` — Existing tests for create_task request/response (follow pattern)

  **WHY Each Reference Matters**:
  - `create_task_handler` is the exact pattern to follow — same DB lock, emit, response flow
  - Router registration shows where to add the new route

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Tests: `test_update_task_request_*` for serialization/deserialization
  - [ ] Tests: `test_update_task_partial_*` for title-only and summary-only updates
  - [ ] `cd src-tauri && cargo test http_server` → ALL PASS

  **QA Scenarios:**

  ```
  Scenario: Update task title via HTTP endpoint
    Tool: Bash (cargo test)
    Preconditions: None (unit tests with mock state)
    Steps:
      1. Run `cd src-tauri && cargo test test_update_task_request -- --nocapture`
      2. Verify UpdateTaskRequest deserializes correctly with all fields
      3. Verify partial updates (title only, summary only) deserialize correctly
    Expected Result: All deserialization tests pass
    Failure Indicators: Serde errors, missing optional field handling
    Evidence: .sisyphus/evidence/task-4-http-endpoint.txt

  Scenario: Update with empty body returns error
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_update_task_empty_body -- --nocapture`
      2. Verify request with neither title nor summary returns 400
    Expected Result: Appropriate error response
    Failure Indicators: 200 OK with no-op, or 500 error
    Evidence: .sisyphus/evidence/task-4-http-empty-body.txt
  ```

  **Commit**: YES
  - Message: `feat(api): add /update_task HTTP endpoint for title and summary`
  - Files: `src-tauri/src/http_server.rs`
  - Pre-commit: `cd src-tauri && cargo test http_server`

- [x] 5. Update build_task_prompt + branch naming to use prompt field

  **What to do**:
  - Update existing tests for `build_task_prompt` to expect `prompt` field usage instead of `title`
  - Verify tests fail (RED)
  - Change `build_task_prompt()` in `orchestration.rs:5-28` to use `task.prompt.as_deref().unwrap_or(&task.title)` instead of `&task.title` on line 15
  - Update `slugify_branch_name` calls at `orchestration.rs:169` and `orchestration.rs:327` to use the same fallback pattern
  - Verify all tests pass (GREEN)

  **Must NOT do**:
  - Do NOT change `build_task_prompt` function signature
  - Do NOT change how action instructions are appended
  - Do NOT touch any other functions in orchestration.rs

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - Small, focused change — two lines + test updates

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 6-10)
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 1, 2

  **References**:
  **Pattern References**:
  - `src-tauri/src/commands/orchestration.rs:5-28` — `build_task_prompt()` function (line 15 is the change point)
  - `src-tauri/src/commands/orchestration.rs:169` — First `slugify_branch_name` call in `start_implementation`
  - `src-tauri/src/commands/orchestration.rs:327` — Second `slugify_branch_name` call in `run_action`

  **Test References**:
  - `src-tauri/src/commands/orchestration.rs:428-633` — 11 existing tests for `build_task_prompt` (update these)

  **WHY Each Reference Matters**:
  - Line 15 is THE line to change: `prompt.push_str(&task.title)` → `prompt.push_str(task.prompt.as_deref().unwrap_or(&task.title))`
  - Lines 169 and 327 use title for branch naming — same fallback needed
  - All 11 tests need `TaskRow` fixtures updated to include `prompt` field

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Update all 11 `build_task_prompt` test fixtures to include `prompt` field
  - [ ] Add test: task with prompt uses prompt, not title
  - [ ] Add test: task without prompt falls back to title
  - [ ] `cd src-tauri && cargo test build_task_prompt` → ALL PASS

  **QA Scenarios:**

  ```
  Scenario: Prompt field used when present
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_build_task_prompt_uses_prompt -- --nocapture`
      2. Verify: task with prompt="Fix auth bug" and title="Auth fix" → prompt contains "Fix auth bug"
    Expected Result: Prompt text appears in output, not title
    Failure Indicators: Title text appears instead of prompt
    Evidence: .sisyphus/evidence/task-5-prompt-field.txt

  Scenario: Falls back to title when prompt is None
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_build_task_prompt_fallback -- --nocapture`
      2. Verify: task with prompt=None and title="My task" → prompt contains "My task"
    Expected Result: Title text used as fallback
    Failure Indicators: Empty prompt or panic on None
    Evidence: .sisyphus/evidence/task-5-prompt-fallback.txt
  ```

  **Commit**: YES
  - Message: `refactor(orchestration): use prompt field for build_task_prompt and branch naming`
  - Files: `src-tauri/src/commands/orchestration.rs`
  - Pre-commit: `cd src-tauri && cargo test build_task_prompt`

- [x] 6. MCP create_task Tool

  **What to do**:
  - Add `create_task` tool to MCP server (`src-tauri/src/mcp-server/index.js`)
  - Tool schema: `title` (string, required), `project_id` (string, optional)
  - Tool implementation: HTTP POST to `http://127.0.0.1:${port}/create_task` with bearer auth
  - Read `OPENFORGE_HTTP_TOKEN` and `OPENFORGE_HTTP_PORT` (default 17422) from environment
  - Return task ID on success, error message on failure
  - Test: send tool call via stdin, verify HTTP call would be made (mock or real)

  **Must NOT do**:
  - Do NOT add a `prompt` parameter to create_task yet — prompt is the title at creation time
  - Do NOT add retry logic or complex error handling

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - Requires MCP SDK tool registration + HTTP client code

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 7-10)
  - **Blocks**: Tasks 11, 13
  - **Blocked By**: Tasks 3, 4

  **References**:
  **Pattern References**:
  - `src-tauri/src/plugin_installer.rs:5-42` — Existing create_task tool logic (port + fetch pattern to replicate)
  - `src-tauri/src/http_server.rs:48-54` — `CreateTaskRequest` struct shape (JSON body format)

  **External References**:
  - MCP SDK tool registration: https://modelcontextprotocol.io/docs/concepts/tools

  **WHY Each Reference Matters**:
  - The existing plugin shows the exact HTTP call: POST to /create_task with JSON body containing title + project_id
  - The MCP tool must produce the same HTTP call but using MCP SDK's tool registration pattern

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: create_task tool appears in tools/list
    Tool: Bash (echo + node)
    Preconditions: MCP server installed (npm install)
    Steps:
      1. Send initialize + tools/list JSON-RPC messages to MCP server via stdin
      2. Parse tools/list response
    Expected Result: Response contains tool named "create_task" with title + project_id parameters
    Failure Indicators: Tool missing from list, wrong parameter schema
    Evidence: .sisyphus/evidence/task-6-create-task-tool.txt

  Scenario: create_task tool returns error without server running
    Tool: Bash (echo + node)
    Preconditions: No Open Forge app running (port not listening)
    Steps:
      1. Send initialize + tools/call for create_task with title="Test"
      2. Parse response
    Expected Result: Tool returns error message about connection failure (not crash)
    Failure Indicators: Process crash, unhandled exception, or success response
    Evidence: .sisyphus/evidence/task-6-create-task-error.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `feat(mcp): add create_task tool to MCP server`
  - Files: `src-tauri/src/mcp-server/index.js`
  - Pre-commit: MCP tools/list test

- [x] 7. MCP update_task + get_task_info Tools

  **What to do**:
  - Add `update_task` tool to MCP server:
    - Schema: `task_id` (string, required), `title` (string, optional), `summary` (string, optional)
    - Implementation: HTTP POST to `/update_task` with bearer auth
    - Description: "Update the title and/or summary of a task. Call this to set a descriptive title based on what you've discovered, and a TLDR summary of what you did and what needs attention."
  - Add `get_task_info` tool to MCP server:
    - Schema: `task_id` (string, required)
    - Implementation: HTTP GET to `/task/{task_id}` (needs new endpoint — add simple GET handler)
    - Returns: task ID, current title, prompt, summary, status, jira_key
    - Description: "Get current information about a task, including its prompt, title, and summary."
  - Also add `GET /task/:id` endpoint to `http_server.rs` for get_task_info
  - Test both tools end-to-end

  **Must NOT do**:
  - Do NOT add streaming or subscription capabilities
  - Do NOT add bulk operations
  - Do NOT add task deletion or status changes via MCP

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - Two tools + one HTTP endpoint, building on Task 6 pattern

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5, 6, 8-10)
  - **Blocks**: Tasks 11, 13
  - **Blocked By**: Tasks 3, 4

  **References**:
  **Pattern References**:
  - `src-tauri/src/mcp-server/index.js` — create_task tool from Task 6 (follow same pattern)
  - `src-tauri/src/http_server.rs:89-133` — create_task_handler pattern for the new GET endpoint
  - `src-tauri/src/http_server.rs:262-273` — Router registration

  **API/Type References**:
  - `src-tauri/src/http_server.rs:48-68` — Request/response struct pattern for new GET endpoint

  **WHY Each Reference Matters**:
  - Task 6's create_task tool establishes the MCP tool pattern — update_task and get_task_info follow the same structure
  - HTTP handler pattern ensures consistent auth, error handling, event emission

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: update_task tool appears in tools/list with correct schema
    Tool: Bash (echo + node)
    Preconditions: MCP server with all tools
    Steps:
      1. Send initialize + tools/list
      2. Find update_task tool in response
    Expected Result: Tool has task_id (required), title (optional), summary (optional) parameters
    Failure Indicators: Missing parameters, wrong types, or tool not listed
    Evidence: .sisyphus/evidence/task-7-update-task-schema.txt

  Scenario: get_task_info tool appears in tools/list
    Tool: Bash (echo + node)
    Preconditions: MCP server with all tools
    Steps:
      1. Send initialize + tools/list
      2. Find get_task_info tool in response
    Expected Result: Tool has task_id (required) parameter
    Failure Indicators: Tool missing from list
    Evidence: .sisyphus/evidence/task-7-get-task-info-schema.txt

  Scenario: update_task gracefully handles missing server
    Tool: Bash (echo + node)
    Preconditions: No Open Forge app running
    Steps:
      1. Send tools/call for update_task with task_id="T-1", title="New Title"
    Expected Result: Error message about connection, no crash
    Failure Indicators: Process crash or unhandled exception
    Evidence: .sisyphus/evidence/task-7-update-task-error.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `feat(mcp): add update_task and get_task_info tools`
  - Files: `src-tauri/src/mcp-server/index.js`, `src-tauri/src/http_server.rs`
  - Pre-commit: MCP tools/list + cargo test

- [x] 8. Frontend — AddTaskDialog prompt field + IPC updates

  **What to do**:
  - Update `AddTaskDialog.test.ts` to test for "Prompt" label instead of "Title"
  - Verify tests fail (RED)
  - In `AddTaskDialog.svelte`:
    - Rename the "Title" label to "Prompt" (or "Instructions")
    - Rename the `title` state variable to `prompt` for clarity
    - Update the placeholder text: "Describe what you want the agent to do"
    - On submit: call `createTask(prompt, status, jiraKey, projectId)` — the prompt becomes the initial title AND is stored as prompt
  - Update `src/lib/types.ts`: add `prompt: string | null` and `summary: string | null` to `Task` interface
  - Update `src/lib/ipc.ts`: update `createTask` signature if needed
  - Verify tests pass (GREEN)

  **Must NOT do**:
  - Do NOT add a separate title input field — title is agent-generated only
  - Do NOT add summary input — summary is agent-generated only
  - Do NOT change the edit mode behavior yet (editing still updates title for now)

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []
    - UI component changes + form behavior

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-7, 9, 10)
  - **Blocks**: Task 13
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/components/AddTaskDialog.svelte` — Current dialog (rename title→prompt, update labels)
  - `src/lib/types.ts:1-13` — Current `Task` interface (add prompt + summary fields)
  - `src/lib/ipc.ts:4-6` — `createTask` function (may need prompt parameter)

  **Test References**:
  - `src/components/AddTaskDialog.test.ts` — Existing tests (update label assertions)

  **WHY Each Reference Matters**:
  - AddTaskDialog is the exact file to modify — small label + variable rename
  - types.ts Task interface must match the Rust TaskRow (add same fields)
  - IPC wrapper may need updating to pass prompt to backend

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Update AddTaskDialog.test.ts: check for "Prompt" label instead of "Title"
  - [ ] `pnpm test -- --run src/components/AddTaskDialog.test.ts` → PASS

  **QA Scenarios:**

  ```
  Scenario: AddTaskDialog shows "Prompt" label
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Run `pnpm test -- --run src/components/AddTaskDialog.test.ts`
      2. Verify test asserts "Prompt" label is present
    Expected Result: Test passes, "Prompt" label found
    Failure Indicators: Test fails, still looking for "Title" label
    Evidence: .sisyphus/evidence/task-8-prompt-label.txt

  Scenario: Task interface includes new fields
    Tool: Bash (pnpm test)
    Preconditions: types.ts updated
    Steps:
      1. Run `pnpm test -- --run` (full suite)
      2. Check for TypeScript compilation errors related to Task type
    Expected Result: No type errors, all tests pass
    Failure Indicators: TypeScript errors about missing prompt/summary fields
    Evidence: .sisyphus/evidence/task-8-types-update.txt
  ```

  **Commit**: YES
  - Message: `feat(ui): rename title to prompt in AddTaskDialog, add prompt/summary to Task type`
  - Files: `src/components/AddTaskDialog.svelte`, `src/components/AddTaskDialog.test.ts`, `src/lib/types.ts`, `src/lib/ipc.ts`
  - Pre-commit: `pnpm test -- --run`

- [x] 9. Frontend — TaskCard TLDR subtitle

  **What to do**:
  - Update or create test: TaskCard renders summary as subtitle when present
  - In `TaskCard.svelte`: add a subtitle line below the title showing `task.summary` when present
    - Use small, muted text (`text-xs text-base-content/50`)
    - Truncate to 1 line with ellipsis
    - If no summary, show nothing (no empty space)
  - The title display should use fallback: `task.title || firstLine(task.prompt) || task.id`
    - This handles the case where title is empty (agent hasn't generated one yet)

  **Must NOT do**:
  - Do NOT add hover tooltips or popovers (deferred)
  - Do NOT change card layout significantly — just add subtitle line
  - Do NOT add click handlers for the summary

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []
    - UI component styling, conditional rendering

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-8, 10)
  - **Blocks**: Task 13
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/components/TaskCard.svelte` — Current card component (add subtitle below title)
  - `src/components/TaskDetailView.svelte:93` — Title display with `task.title.split('\n')[0]` (follow for fallback pattern)

  **WHY Each Reference Matters**:
  - TaskCard is the exact file — need to find where title is rendered and add summary below
  - TaskDetailView shows the title truncation pattern to follow

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: TaskCard shows summary subtitle when present
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Write/update test: render TaskCard with task that has summary="Fixed auth bug, needs review"
      2. Assert: element with text "Fixed auth bug, needs review" is present
      3. Run `pnpm test -- --run`
    Expected Result: Subtitle text visible
    Failure Indicators: Text not found in rendered output
    Evidence: .sisyphus/evidence/task-9-card-subtitle.txt

  Scenario: TaskCard hides subtitle when no summary
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Write/update test: render TaskCard with task that has summary=null
      2. Assert: no subtitle element rendered
      3. Run `pnpm test -- --run`
    Expected Result: No extra whitespace or empty element
    Failure Indicators: Empty element visible, layout shift
    Evidence: .sisyphus/evidence/task-9-card-no-subtitle.txt
  ```

  **Commit**: YES (groups with Task 10)
  - Message: `feat(ui): show TLDR summary subtitle on kanban cards`
  - Files: `src/components/TaskCard.svelte`
  - Pre-commit: `pnpm test -- --run`

- [x] 10. Frontend — TaskInfoPanel summary + prompt display

  **What to do**:
  - In `TaskInfoPanel.svelte`:
    - Show the `prompt` field under an "INITIAL_PROMPT" label (the label may already exist — verify)
    - Show the `summary` field under a "SUMMARY" or "TLDR" label
    - If summary is null, show nothing or "No summary yet"
    - Display prompt as read-only text (not editable)
    - Display summary as read-only text
  - Also update `TaskDetailView.svelte:93` — the header title display should use fallback:
    `task.title || firstLine(task.prompt) || task.id`

  **Must NOT do**:
  - Do NOT add summary editing capability
  - Do NOT add prompt editing capability
  - Do NOT change the layout of the info panel significantly

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
  - **Skills**: []
    - UI component updates, conditional rendering

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Tasks 5-9)
  - **Blocks**: Task 13
  - **Blocked By**: Task 1

  **References**:
  **Pattern References**:
  - `src/components/TaskInfoPanel.svelte` — Current info panel (add summary + prompt sections)
  - `src/components/TaskDetailView.svelte:93` — Header title display (add fallback)

  **WHY Each Reference Matters**:
  - TaskInfoPanel already has labeled sections — follow existing layout for new fields
  - TaskDetailView header needs the fallback to show prompt when title is empty

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: TaskInfoPanel shows prompt and summary
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Write test: render TaskInfoPanel with task that has prompt="Fix login" and summary="Fixed auth, check token expiry"
      2. Assert: "Fix login" text visible under prompt label
      3. Assert: "Fixed auth, check token expiry" visible under summary label
      4. Run `pnpm test -- --run`
    Expected Result: Both fields displayed
    Failure Indicators: Missing labels or content
    Evidence: .sisyphus/evidence/task-10-info-panel.txt

  Scenario: TaskDetailView header shows fallback when title is empty
    Tool: Bash (pnpm test)
    Preconditions: None
    Steps:
      1. Write test: render with task where title="" and prompt="My instruction"
      2. Assert: header shows "My instruction"
      3. Run `pnpm test -- --run`
    Expected Result: Prompt text shown as fallback
    Failure Indicators: Empty header or task ID shown instead of prompt
    Evidence: .sisyphus/evidence/task-10-title-fallback.txt
  ```

  **Commit**: YES (groups with Task 9)
  - Message: `feat(ui): display prompt and summary in task info panel`
  - Files: `src/components/TaskInfoPanel.svelte`, `src/components/TaskDetailView.svelte`
  - Pre-commit: `pnpm test -- --run`

- [x] 11. MCP Auto-Config Installer (replace plugin_installer)

  **What to do**:
  - Create `src-tauri/src/mcp_installer.rs` (new file, replaces `plugin_installer.rs`):
    - Function `install_mcp_server()`: copies/writes MCP server files to a known location (e.g., `~/.config/openforge/mcp-server/`)
    - Function `configure_opencode_mcp()`: reads `~/.config/opencode/config.json`, MERGES (not overwrites) an MCP server entry pointing to the installed server
    - Function `configure_claude_mcp()`: reads project-level `.mcp.json` (or `~/.claude/settings.json`), MERGES an MCP server entry
    - Both config functions must use merge-not-overwrite: read existing JSON, add/update only the "openforge" MCP entry, write back
    - The MCP server config passes env vars: `OPENFORGE_HTTP_TOKEN=${token}`, `OPENFORGE_HTTP_PORT=${port}`
  - Update `src-tauri/src/main.rs`: replace `plugin_installer::install_create_task_plugin()` call with `mcp_installer::install_mcp_server()` + config functions
  - Remove or deprecate `plugin_installer.rs` (keep as dead code for one release, or remove)
  - Write tests for merge logic (don't overwrite existing config)

  **Must NOT do**:
  - Do NOT overwrite user's existing MCP configurations
  - Do NOT remove existing non-openforge MCP entries from config files
  - Do NOT write config files if the provider is not being used (check config)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
  - **Skills**: []
    - File system operations, JSON merge logic, config file management

  **Parallelization**:
  - **Can Run In Parallel**: NO (depends on Tasks 4, 6, 7)
  - **Parallel Group**: Wave 3
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 4, 6, 7

  **References**:
  **Pattern References**:
  - `src-tauri/src/plugin_installer.rs` — Current install pattern (replace with MCP equivalent)
  - `src-tauri/src/main.rs:252` — Where plugin installer is called (replace with MCP installer)
  - `src-tauri/src/pty_manager.rs:187-188` — Where `OPENFORGE_HTTP_TOKEN` env var is set (same env vars for MCP)

  **External References**:
  - Claude Code MCP config: `.mcp.json` in project root or `~/.claude/settings.json`
  - OpenCode MCP config: `~/.config/opencode/config.json` mcpServers section

  **WHY Each Reference Matters**:
  - plugin_installer.rs shows the current pattern to replace — same startup hook, different output
  - pty_manager shows how the token env var is named and set — MCP config uses same vars
  - Config file formats for both providers must be respected

  **Acceptance Criteria**:

  **TDD:**
  - [ ] Test: `test_merge_mcp_config_preserves_existing` — existing MCP entries not overwritten
  - [ ] Test: `test_merge_mcp_config_updates_openforge` — openforge entry updated if exists
  - [ ] Test: `test_merge_mcp_config_creates_new` — config created if doesn't exist
  - [ ] `cd src-tauri && cargo test mcp_installer` → ALL PASS

  **QA Scenarios:**

  ```
  Scenario: MCP config merges without destroying existing entries
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_merge_mcp_config_preserves_existing -- --nocapture`
      2. Verify: test creates config with existing "other-mcp" entry, runs merge, asserts "other-mcp" still present AND "openforge" added
    Expected Result: Both entries present in final config
    Failure Indicators: Existing entry removed, or openforge entry missing
    Evidence: .sisyphus/evidence/task-11-config-merge.txt

  Scenario: MCP server files installed to correct location
    Tool: Bash (cargo test)
    Preconditions: None
    Steps:
      1. Run `cd src-tauri && cargo test test_install_mcp_server -- --nocapture`
      2. Verify: MCP server files exist at expected path after install
    Expected Result: index.js and package.json present at install location
    Failure Indicators: Files missing or at wrong path
    Evidence: .sisyphus/evidence/task-11-mcp-install.txt
  ```

  **Commit**: YES
  - Message: `feat(config): add MCP server auto-config for Claude Code and OpenCode`
  - Files: `src-tauri/src/mcp_installer.rs`, `src-tauri/src/main.rs`, `src-tauri/src/plugin_installer.rs`
  - Pre-commit: `cd src-tauri && cargo test mcp_installer`

- [x] 12. Update Frontend IPC + Stores for New Fields

  **What to do**:
  - Update `src/lib/ipc.ts`:
    - `createTask()`: if backend now accepts prompt parameter, update signature
    - Add `updateTaskTitleAndSummary(taskId: string, title: string | null, summary: string | null)` IPC wrapper
    - Ensure `getTaskDetail()` returns the new fields
  - Update Tauri command `create_task` in `src-tauri/src/commands/tasks.rs` to accept optional `prompt` parameter
  - Update `task-changed` event handler in `App.svelte` to refresh task data (should already work via existing pattern)
  - Verify the reactive chain: HTTP endpoint emits event → frontend receives → re-fetches → UI updates

  **Must NOT do**:
  - Do NOT add new stores for summary — it's part of the Task object
  - Do NOT add WebSocket or polling for real-time updates (events already handle this)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []
    - IPC wrapper updates, follows existing patterns exactly

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Tasks 11, 13)
  - **Blocks**: Task 13
  - **Blocked By**: Tasks 1, 2

  **References**:
  **Pattern References**:
  - `src/lib/ipc.ts:4-10` — `createTask()` and `updateTask()` patterns
  - `src/lib/ipc.ts:136-138` — `getTaskDetail()` pattern
  - `src-tauri/src/commands/tasks.rs:26-39` — Rust `create_task` command (add prompt param)
  - `src/App.svelte:328` — Event listener pattern for task-changed

  **WHY Each Reference Matters**:
  - IPC wrappers must match Rust command signatures exactly (Tauri's invoke bridge)
  - Event listener shows how UI refreshes when backend emits task-changed

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: IPC wrappers compile and match Rust commands
    Tool: Bash (pnpm test)
    Preconditions: All Rust commands updated
    Steps:
      1. Run `pnpm test -- --run`
      2. Verify no TypeScript compilation errors
    Expected Result: Clean compilation, all tests pass
    Failure Indicators: Type mismatch errors between ipc.ts and Rust commands
    Evidence: .sisyphus/evidence/task-12-ipc-types.txt
  ```

  **Commit**: YES
  - Message: `chore: update IPC wrappers and Tauri commands for prompt/summary fields`
  - Files: `src/lib/ipc.ts`, `src-tauri/src/commands/tasks.rs`
  - Pre-commit: `pnpm test -- --run && cd src-tauri && cargo test`

- [x] 13. Build Verification + Integration Test

  **What to do**:
  - Run full build: `cd src-tauri && cargo build`
  - Run full Rust test suite: `cd src-tauri && cargo test`
  - Run full frontend test suite: `pnpm test -- --run`
  - Verify MCP server: `cd src-tauri/src/mcp-server && npm install && echo '<initialize JSON>' | node index.js`
  - Verify no TypeScript errors: check vitest output for compilation issues
  - Verify no Rust warnings: check cargo build output
  - Fix any cross-task integration issues found

  **Must NOT do**:
  - Do NOT add new features
  - Do NOT refactor working code
  - Only fix issues that prevent build/test from passing

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []
    - Integration testing requires understanding the full system

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (after Tasks 11, 12)
  - **Blocks**: F1-F4
  - **Blocked By**: All tasks 1-12

  **References**:
  **All previous task references** — this task validates the entire integration

  **Acceptance Criteria**:

  **QA Scenarios:**

  ```
  Scenario: Full Rust build succeeds
    Tool: Bash
    Preconditions: All tasks 1-12 complete
    Steps:
      1. Run `cd src-tauri && cargo build 2>&1`
      2. Check exit code and output for errors
    Expected Result: Exit code 0, no errors
    Failure Indicators: Compilation errors, unresolved references
    Evidence: .sisyphus/evidence/task-13-cargo-build.txt

  Scenario: Full Rust test suite passes
    Tool: Bash
    Preconditions: Cargo build succeeds
    Steps:
      1. Run `cd src-tauri && cargo test 2>&1`
      2. Count pass/fail
    Expected Result: All tests pass, 0 failures
    Failure Indicators: Any test failure
    Evidence: .sisyphus/evidence/task-13-cargo-test.txt

  Scenario: Full frontend test suite passes
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run `pnpm test -- --run 2>&1`
      2. Count pass/fail
    Expected Result: All tests pass, 0 failures
    Failure Indicators: Any test failure or TypeScript error
    Evidence: .sisyphus/evidence/task-13-pnpm-test.txt

  Scenario: MCP server end-to-end
    Tool: Bash
    Preconditions: npm install in mcp-server dir
    Steps:
      1. Run `cd src-tauri/src/mcp-server && npm install`
      2. Send initialize + tools/list via stdin
      3. Verify 3 tools listed: create_task, update_task, get_task_info
    Expected Result: All 3 tools present with correct schemas
    Failure Indicators: Missing tools, wrong schemas, startup failure
    Evidence: .sisyphus/evidence/task-13-mcp-e2e.txt
  ```

  **Commit**: NO (only if fixes needed)
  - If fixes applied: `fix: resolve integration issues from cross-task changes`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build 2>&1` + `pnpm test -- --run` + `cargo test`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Build [PASS/FAIL] | Lint [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high`
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration (MCP server → HTTP API → DB → frontend event → UI update). Test edge cases: empty summary, very long title, concurrent updates. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `feat(db): add prompt and summary fields to tasks table` — migration + TaskRow
- **Wave 1**: `feat(api): add /update_task HTTP endpoint` — http_server.rs
- **Wave 2**: `refactor(orchestration): use prompt field for build_task_prompt and branch naming` — orchestration.rs
- **Wave 2**: `feat(mcp): add MCP server with create_task, update_task, get_task_info tools` — mcp-server/
- **Wave 2**: `feat(ui): rename title to prompt in AddTaskDialog, show TLDR on cards and detail` — svelte components
- **Wave 3**: `feat(config): auto-configure MCP server for Claude Code and OpenCode` — mcp_installer.rs
- **Wave 3**: `chore: update IPC wrappers and stores for new task fields` — ipc.ts, types.ts, stores

---

## Success Criteria

### Verification Commands
```bash
# DB migration present
cargo test test_migration_v6 -- --nocapture  # Expected: PASS

# Rust builds and tests pass
cd src-tauri && cargo test  # Expected: all tests pass

# Frontend tests pass
pnpm test -- --run  # Expected: exit code 0

# MCP server starts and lists tools
echo '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}},"id":1}' | node src-tauri/src/mcp-server/index.js 2>/dev/null | head -1  # Expected: JSON with tools/list capability

# HTTP endpoint works
# (Requires running app — verified in integration test task)
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All Rust tests pass
- [ ] All frontend tests pass
- [ ] MCP server responds to JSON-RPC
- [ ] Both provider configs written on startup
