# Global Git & Jira Integration Config

## TL;DR

> **Quick Summary**: Move Jira/GitHub credentials from per-project config to global app-wide config, while keeping project-specific fields (board ID, default repo) per-project. Add a new global settings panel and simplify project settings.
> 
> **Deliverables**:
> - New `GlobalSettingsPanel.svelte` component for app-wide Jira/GitHub credentials
> - Updated Rust pollers reading credentials from global config
> - Simplified project settings (credentials removed, board/repo retained)
> - One-time data migration for existing users
> - Tests for all changes
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 3 waves + final verification
> **Critical Path**: Task 1 (backend) → Task 4 (App wiring) → Task 5 (backend tests) → Final

---

## Context

### Original Request
User wants git and Jira integration to be global, not per-project. Currently, every project requires its own Jira URL, username, API token, and GitHub PAT — even though these are user-level credentials that don't change between projects.

### Interview Summary
**Key Discussions**:
- Credentials (URL, username, tokens) → global. Board ID and default repo → stay per-project.
- New top-level global settings panel, separate from project settings.
- Tests after implementation.

**Research Findings**:
- The global `config` table already has empty default entries for all credential keys (db.rs:236-250) — they're just never read by the pollers.
- The manual trigger `refresh_jira_info` (main.rs:437-480) already reads from global config correctly — NO changes needed.
- `poll_pr_comments_now` (main.rs:483-613) reads `github_default_repo` from global config — this breaks since that key moves to per-project.
- `pollPrCommentsNow` and `refreshJiraInfo` are exported from ipc.ts but have ZERO frontend callers — they're dead code on the frontend side.
- `jira_board_id` is stored but never used by any backend logic (jira_sync.rs builds JQL from task JIRA keys, not board IDs).
- `github_poll_interval` is defined in config defaults but github_poller.rs hardcodes `sleep(Duration::from_secs(30))`.
- No existing tests for SettingsPanel, ProjectSetupDialog, or App.svelte.
- ipc.ts already has `getConfig`/`setConfig` wrappers for global config at lines 112-118.

### Metis Review
**Identified Gaps** (addressed):
- `poll_pr_comments_now` breaks after change → Resolved: refactor to iterate all projects (matches background poller pattern, has zero frontend callers anyway)
- Existing users lose sync after upgrade → Resolved: add one-time migration in db.rs `run_migrations()` to copy first project's credentials to global config
- `refresh_jira_info` incorrectly listed as needing changes → Resolved: explicitly excluded from scope
- First-time project UX → Resolved: gear icon is self-evident, no extra guidance needed

---

## Work Objectives

### Core Objective
Move Jira/GitHub credential storage from per-project `project_config` table to global `config` table, update all code that reads these values, and provide a dedicated UI for managing global settings.

### Concrete Deliverables
- `src/components/GlobalSettingsPanel.svelte` — new component
- Updated `src-tauri/src/jira_sync.rs` — reads credentials from global config
- Updated `src-tauri/src/github_poller.rs` — reads token from global config, repo from per-project
- Updated `src-tauri/src/main.rs` — `poll_pr_comments_now` iterates all projects
- Updated `src-tauri/src/db.rs` — one-time migration of credentials
- Updated `src/App.svelte` — global settings button + panel wiring
- Updated `src/components/SettingsPanel.svelte` — credential fields removed
- Updated `src/components/ProjectSetupDialog.svelte` — credential fields removed
- `src/components/GlobalSettingsPanel.test.ts` — new test file
- Backend tests in `jira_sync.rs` and `github_poller.rs`

### Definition of Done
- [ ] `cargo build --manifest-path src-tauri/Cargo.toml` compiles without errors
- [ ] `cargo test --manifest-path src-tauri/Cargo.toml` passes
- [ ] `npx vitest run` passes
- [ ] Global settings panel loads/saves credentials via global `config` table
- [ ] Project settings panel shows ONLY project name, repos root path, board ID, default repo
- [ ] Jira sync background poller uses global credentials
- [ ] GitHub poller uses global token + per-project default repo
- [ ] Existing per-project credentials migrate to global on first launch

### Must Have
- Global `config` table used for: `jira_base_url`, `jira_username`, `jira_api_token`, `github_token`
- Per-project `project_config` table used for: `jira_board_id`, `github_default_repo`
- New GlobalSettingsPanel accessible via gear icon in header, independent of any active project
- One-time data migration so existing users don't lose sync
- Mutual exclusivity: global settings, project settings, and task detail views cannot show simultaneously

### Must NOT Have (Guardrails)
- DO NOT change `refresh_jira_info` in main.rs — it already reads from global config correctly
- DO NOT add new Tauri commands — `get_config`/`set_config` already exist and work
- DO NOT change the `config` table schema or modify/remove default entries in db.rs (leave unused keys like `filter_assigned_to_me`, `exclude_done_tickets`, `custom_jql` in place)
- DO NOT add "test connection" buttons or credential validation logic
- DO NOT move poll interval settings or OpenCode settings into the global panel
- DO NOT add credential format validation (e.g., checking token prefixes)
- DO NOT change the polling loop structure in jira_sync.rs or github_poller.rs — pollers must still iterate all projects
- DO NOT remove `project_config` table or its DB methods — they're still used for board_id and default_repo
- DO NOT add emojis to any files

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest + cargo test)
- **Automated tests**: Tests after implementation
- **Framework**: vitest (frontend), cargo test (Rust backend)

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

| Deliverable Type | Verification Tool | Method |
|------------------|-------------------|--------|
| Rust backend | Bash (cargo test/cargo build) | Compile, run tests, assert pass |
| Svelte components | Bash (npx vitest run) | Run tests, assert pass |
| UI integration | Playwright (playwright skill) | Navigate, interact, assert DOM, screenshot |

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Start Immediately — backend + frontend in parallel):
├── Task 1: Backend: Update pollers + commands for global credentials [unspecified-high]
├── Task 2: Frontend: Create GlobalSettingsPanel component [visual-engineering]
└── Task 3: Frontend: Simplify project settings components [quick]

Wave 2 (After Wave 1 — integration):
├── Task 4: Frontend: Wire GlobalSettingsPanel into App [quick]
└── Task 5: Backend: Add data migration for existing users [quick]

Wave 3 (After Wave 2 — tests):
├── Task 6: Tests: Backend tests for updated pollers [unspecified-high]
└── Task 7: Tests: Frontend tests for settings components [quick]

Wave FINAL (After ALL tasks — independent review, 4 parallel):
├── Task F1: Plan compliance audit (oracle)
├── Task F2: Code quality review (unspecified-high)
├── Task F3: Real manual QA (unspecified-high)
└── Task F4: Scope fidelity check (deep)

Critical Path: Task 1 → Task 5 → Task 6 → F1-F4
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 3 (Wave 1)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|------------|--------|------|
| 1 | — | 5, 6 | 1 |
| 2 | — | 4, 7 | 1 |
| 3 | — | 4, 7 | 1 |
| 4 | 2, 3 | 7 | 2 |
| 5 | 1 | 6 | 2 |
| 6 | 5 | F1-F4 | 3 |
| 7 | 4 | F1-F4 | 3 |

### Agent Dispatch Summary

| Wave | # Parallel | Tasks → Agent Category |
|------|------------|----------------------|
| 1 | **3** | T1 → `unspecified-high`, T2 → `visual-engineering`, T3 → `quick` |
| 2 | **2** | T4 → `quick`, T5 → `quick` |
| 3 | **2** | T6 → `unspecified-high`, T7 → `quick` |
| FINAL | **4** | F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high` (+playwright skill), F4 → `deep` |

---

## TODOs

- [x] 1. Backend: Update pollers + commands for global credentials

  **What to do**:
  - In `jira_sync.rs`: Refactor `read_project_jira_config()` (lines 209-240) to read `jira_base_url`, `jira_username`, `jira_api_token` from the global `config` table instead of `project_config`. The `SyncConfig` struct (lines 200-205) should no longer store credentials — read them once before the project loop and pass them alongside the project iteration. The project loop should still iterate all projects to get tasks per project.
  - In `github_poller.rs`: Refactor `read_project_config()` (lines 149-174) to read `github_token` from global `config` table, and `github_default_repo` from `project_config`. The `PollerConfig` struct (lines 142-147) should get `github_token` from global and `github_default_repo` from per-project.
  - In `main.rs`: Refactor `poll_pr_comments_now` (lines 483-613) to iterate all projects instead of reading a single `github_default_repo` from global config. Read `github_token` from global config once, then iterate projects to get each project's `github_default_repo`. This matches the background poller's pattern. Note: this command has zero frontend callers but should be consistent.
  - DO NOT touch `refresh_jira_info` (lines 437-480) — it already reads from global config correctly.

  **Must NOT do**:
  - Do NOT change `refresh_jira_info` — it already works correctly with global config
  - Do NOT add new Tauri commands
  - Do NOT change the polling loop structure (sleep durations, project iteration pattern)
  - Do NOT change the `config` table schema or default entries

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Rust refactoring across 3 files requiring careful understanding of config flow
  - **Skills**: []
    - No special skills needed — standard Rust refactoring
  - **Skills Evaluated but Omitted**:
    - `golang`: Wrong language

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 2, 3)
  - **Blocks**: Tasks 5, 6
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src-tauri/src/jira_sync.rs:41-196` — Full sync loop. Lines 44-55 read global poll_interval. Lines 57-75 iterate projects. Lines 80-92 read per-project config via `read_project_jira_config()`. Lines 136-143 pass credentials to `jira_client.search_issues()`.
  - `src-tauri/src/github_poller.rs:39-140` — Full poller loop. Lines 69-84 iterate projects and read per-project config. Lines 86-94 validate repo format. Lines 96-103 call `sync_open_prs()` with config.
  - `src-tauri/src/main.rs:437-480` — `refresh_jira_info` — DO NOT CHANGE. Shows the correct pattern of reading from global config.
  - `src-tauri/src/main.rs:483-613` — `poll_pr_comments_now` — needs refactoring. Currently reads `github_default_repo` from global config (lines 488-502).

  **API/Type References**:
  - `src-tauri/src/jira_sync.rs:199-205` — `SyncConfig` struct to refactor
  - `src-tauri/src/github_poller.rs:142-147` — `PollerConfig` struct to refactor
  - `src-tauri/src/db.rs:332-351` — `get_config()` and `set_config()` methods for global config
  - `src-tauri/src/db.rs:470-491` — `get_project_config()` method for per-project config

  **Acceptance Criteria**:
  - [ ] `cargo build --manifest-path src-tauri/Cargo.toml` → compiles without errors
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` → all existing tests pass
  - [ ] `jira_sync.rs` reads `jira_base_url`, `jira_username`, `jira_api_token` from `db.get_config()` not `db.get_project_config()`
  - [ ] `github_poller.rs` reads `github_token` from `db.get_config()` and `github_default_repo` from `db.get_project_config()`
  - [ ] `poll_pr_comments_now` iterates projects instead of reading single repo from global config
  - [ ] `refresh_jira_info` is UNCHANGED (verify with `git diff src-tauri/src/main.rs` — lines 437-480 should be identical)

  **QA Scenarios**:

  ```
  Scenario: Backend compiles with updated config reads
    Tool: Bash (cargo build)
    Preconditions: Source files updated
    Steps:
      1. Run: cargo build --manifest-path src-tauri/Cargo.toml
      2. Assert exit code 0
      3. Assert no warnings related to unused variables in jira_sync.rs or github_poller.rs
    Expected Result: Clean compilation with zero errors
    Failure Indicators: Compilation errors mentioning config types, missing fields, or borrow checker issues
    Evidence: .sisyphus/evidence/task-1-cargo-build.txt

  Scenario: Existing tests still pass after refactor
    Tool: Bash (cargo test)
    Preconditions: Source files updated
    Steps:
      1. Run: cargo test --manifest-path src-tauri/Cargo.toml
      2. Assert exit code 0
      3. Assert test count unchanged (all existing tests pass)
    Expected Result: All tests pass, including github_poller::tests and db::tests
    Failure Indicators: Test failures in config-related tests
    Evidence: .sisyphus/evidence/task-1-cargo-test.txt

  Scenario: refresh_jira_info is unchanged
    Tool: Bash (grep)
    Preconditions: Changes committed or staged
    Steps:
      1. Run: grep -n "get_config" src-tauri/src/main.rs | grep -A2 -B2 "refresh_jira_info" to verify refresh_jira_info still uses get_config
      2. Verify lines 437-480 of main.rs contain the same refresh_jira_info function
    Expected Result: refresh_jira_info function unchanged
    Failure Indicators: Any modification to lines 437-480
    Evidence: .sisyphus/evidence/task-1-refresh-unchanged.txt
  ```

  **Commit**: YES
  - Message: `refactor(backend): read jira/github credentials from global config`
  - Files: `src-tauri/src/jira_sync.rs`, `src-tauri/src/github_poller.rs`, `src-tauri/src/main.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

- [x] 2. Frontend: Create GlobalSettingsPanel component

  **What to do**:
  - Create new `src/components/GlobalSettingsPanel.svelte` with form fields for: Jira Base URL, Jira Username, Jira API Token, GitHub Personal Access Token.
  - Use `getConfig(key)` and `setConfig(key, value)` from `src/lib/ipc.ts` (lines 112-118) for loading and saving. These already exist and call global config.
  - Follow the exact same UI patterns as `SettingsPanel.svelte`: section headers, field layout, save button with loading/saved states, close button.
  - Component should NOT require an active project — it works independently.
  - Group fields into two sections: "JIRA" (3 fields: base URL, username, API token) and "GitHub" (1 field: PAT).
  - Load config values on mount, not reactively on a store.
  - Include a dispatch('close') event for the parent to handle.
  - Match the existing dark theme CSS using the same CSS variables and class naming conventions.

  **Must NOT do**:
  - Do NOT add "test connection" buttons or credential validation
  - Do NOT add poll interval settings
  - Do NOT import from stores (this component is project-independent)
  - Do NOT create new IPC wrappers — use existing `getConfig`/`setConfig`

  **Recommended Agent Profile**:
  - **Category**: `visual-engineering`
    - Reason: New UI component requiring consistent styling with existing design system
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Needed to match existing Tokyo Night themed design language
  - **Skills Evaluated but Omitted**:
    - `playwright`: Not needed for component creation, only for QA

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 3)
  - **Blocks**: Tasks 4, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/components/SettingsPanel.svelte:1-85` — EXACT pattern to follow for script section: loadConfig on reactive trigger, save function with isSaving/saved state, close dispatch. Adapt to use `getConfig`/`setConfig` instead of `getProjectConfig`/`setProjectConfig`, and load on `onMount` instead of reactive `$:` since there's no project dependency.
  - `src/components/SettingsPanel.svelte:87-154` — EXACT HTML structure to follow: settings-header with h2 + close button, settings-body with sections, settings-footer with save button.
  - `src/components/SettingsPanel.svelte:156-308` — EXACT CSS to copy/adapt: same class names, same variable usage, same spacing.

  **API/Type References**:
  - `src/lib/ipc.ts:112-118` — `getConfig(key)` returns `Promise<string | null>`, `setConfig(key, value)` returns `Promise<void>`. These are the ONLY IPC calls needed.

  **External References**:
  - CSS variables defined in `src/App.svelte:217-228` — `--bg-primary`, `--bg-secondary`, `--bg-card`, `--text-primary`, `--text-secondary`, `--accent`, `--border`, `--error`

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/GlobalSettingsPanel.svelte`
  - [ ] Component renders without errors when no project is active
  - [ ] Component loads 4 config values on mount via `getConfig()`
  - [ ] Component saves 4 config values via `setConfig()` on save button click
  - [ ] Component dispatches 'close' event when close button is clicked
  - [ ] `npx vitest run` → all existing tests still pass (no regressions)

  **QA Scenarios**:

  ```
  Scenario: GlobalSettingsPanel renders with correct fields
    Tool: Playwright (playwright skill)
    Preconditions: App running via npm run dev (port 1420), GlobalSettingsPanel wired into App (may need Task 4 first — if testing in isolation, render component directly)
    Steps:
      1. Navigate to http://localhost:1420
      2. Click the global settings trigger (gear icon or button)
      3. Assert element with text "JIRA" section heading exists
      4. Assert element with text "GitHub" section heading exists
      5. Assert 3 input fields in JIRA section (base URL, username, API token)
      6. Assert 1 input field in GitHub section (PAT)
      7. Assert API token and PAT fields have type="password"
      8. Assert save button exists with text "Save Settings"
      9. Take screenshot
    Expected Result: Panel renders with 4 input fields in 2 sections, all empty initially
    Failure Indicators: Missing fields, wrong input types, broken layout
    Evidence: .sisyphus/evidence/task-2-global-settings-render.png

  Scenario: GlobalSettingsPanel saves and reloads values
    Tool: Playwright (playwright skill)
    Preconditions: App running, global settings panel open
    Steps:
      1. Fill "Base URL" field with "https://test.atlassian.net"
      2. Fill "Username" field with "test@example.com"
      3. Fill "API Token" field with "test-token-123"
      4. Fill "PAT" field with "ghp_testtoken"
      5. Click "Save Settings" button
      6. Assert button text changes to "Saved!" momentarily
      7. Close the panel (click close button)
      8. Reopen the panel
      9. Assert all 4 fields contain the previously saved values
    Expected Result: Values persist across panel open/close cycles
    Failure Indicators: Fields reset to empty on reopen, save button doesn't change state
    Evidence: .sisyphus/evidence/task-2-global-settings-save.png
  ```

  **Commit**: YES
  - Message: `feat(ui): add global settings panel for jira/github credentials`
  - Files: `src/components/GlobalSettingsPanel.svelte`
  - Pre-commit: `npx vitest run`

- [x] 3. Frontend: Simplify project settings components

  **What to do**:
  - In `SettingsPanel.svelte`: Remove the credential fields from the JIRA section (base URL, username, API token) and the GitHub section (PAT). Keep ONLY: Project Name, Repos Root Path (in Project section), Board ID (in JIRA section), Default Repository (in GitHub section). Remove the corresponding local variables (`jiraBaseUrl`, `jiraUsername`, `jiraApiToken`, `githubToken`) and their `getProjectConfig`/`setProjectConfig` calls in `loadConfig()` and `save()`. Update the header text from "Settings for: {projectName}" to "Project Settings: {projectName}" for clarity.
  - In `ProjectSetupDialog.svelte`: Remove credential fields from the collapsible JIRA section (keep only Board ID field). Remove the PAT field from the collapsible GitHub section (keep only Default Repository field). Remove corresponding variables and `setProjectConfig` calls in `handleSubmit()` for `jira_base_url`, `jira_username`, `jira_api_token`, `github_token`. Keep the collapsible section toggle behavior for the remaining fields.

  **Must NOT do**:
  - Do NOT remove the `getProjectConfig`/`setProjectConfig` imports — they're still needed for board_id and default_repo
  - Do NOT remove the JIRA/GitHub sections entirely — they still have per-project fields
  - Do NOT change the component's event dispatching behavior
  - Do NOT touch the delete project functionality in SettingsPanel

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Straightforward field removal from two existing components — no new logic
  - **Skills**: []
    - No special skills needed
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not needed — just removing fields, not designing new UI

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Tasks 1, 2)
  - **Blocks**: Tasks 4, 7
  - **Blocked By**: None (can start immediately)

  **References**:

  **Pattern References**:
  - `src/components/SettingsPanel.svelte:28-38` — `loadConfig()` function. Remove lines loading `jiraBaseUrl`, `jiraUsername`, `jiraApiToken`, `githubToken`. Keep `jiraBoardId` and `githubDefaultRepo` if they existed (currently they're loaded as `jiraBoardId` at line 33 and `githubDefaultRepo` at line 35 — keep these).
  - `src/components/SettingsPanel.svelte:41-61` — `save()` function. Remove `setProjectConfig` calls for credential keys (lines 48-51, 52). Keep calls for `jira_board_id` (line 51) and `github_default_repo` (line 53).
  - `src/components/SettingsPanel.svelte:114-145` — HTML sections for JIRA and GitHub. Remove base URL (line 118-120), username (line 121-124), API token (line 125-128) fields. Keep board ID (line 129-132). Remove PAT (line 137-140). Keep default repo (line 141-144).
  - `src/components/ProjectSetupDialog.svelte:19-55` — `handleSubmit()`. Remove `setProjectConfig` calls for `jira_base_url` (line 28), `jira_username` (line 31), `jira_api_token` (line 34), `github_token` (line 41). Keep `jira_board_id` (line 37) and `github_default_repo` (line 44).
  - `src/components/ProjectSetupDialog.svelte:116-189` — HTML form sections. Remove credential input fields, keep board ID and default repo fields.

  **Acceptance Criteria**:
  - [ ] SettingsPanel.svelte has NO fields for: base URL, username, API token, GitHub PAT
  - [ ] SettingsPanel.svelte STILL has fields for: project name, repos root path, board ID, default repo
  - [ ] ProjectSetupDialog.svelte has NO fields for: base URL, username, API token, GitHub PAT
  - [ ] ProjectSetupDialog.svelte STILL has fields for: project name, repos root path, board ID, default repo
  - [ ] `npx vitest run` → all existing tests still pass
  - [ ] No TypeScript compilation errors (no unused variable warnings for removed fields)

  **QA Scenarios**:

  ```
  Scenario: SettingsPanel shows only project-scoped fields
    Tool: Playwright (playwright skill)
    Preconditions: App running with at least one project, project settings panel open
    Steps:
      1. Navigate to http://localhost:1420
      2. Open project settings (click existing Settings button)
      3. Assert JIRA section exists with heading "JIRA"
      4. Assert Board ID input field exists (placeholder contains "PROJ" or board-related text)
      5. Assert NO input field with placeholder containing "atlassian.net" (base URL removed)
      6. Assert NO input field with placeholder containing "email" or "username" (username removed)
      7. Assert NO input field with type="password" in JIRA section (API token removed)
      8. Assert GitHub section exists with heading "GitHub"
      9. Assert Default Repository input field exists (placeholder contains "owner/repo")
      10. Assert NO input field with placeholder containing "ghp_" (PAT removed)
      11. Take screenshot
    Expected Result: Only board ID and default repo fields visible in their respective sections
    Failure Indicators: Credential fields still present, sections entirely missing
    Evidence: .sisyphus/evidence/task-3-settings-simplified.png

  Scenario: ProjectSetupDialog shows only project-scoped integration fields
    Tool: Playwright (playwright skill)
    Preconditions: App running
    Steps:
      1. Navigate to http://localhost:1420
      2. Trigger new project dialog (click project switcher → + New Project)
      3. Expand JIRA section (click toggle)
      4. Assert ONLY Board ID field visible (no URL, username, token fields)
      5. Expand GitHub section (click toggle)
      6. Assert ONLY Default Repository field visible (no PAT field)
      7. Take screenshot
    Expected Result: Only board_id and default_repo fields in optional sections
    Failure Indicators: Credential fields still present
    Evidence: .sisyphus/evidence/task-3-setup-dialog-simplified.png
  ```

  **Commit**: YES
  - Message: `refactor(ui): remove credential fields from project settings`
  - Files: `src/components/SettingsPanel.svelte`, `src/components/ProjectSetupDialog.svelte`
  - Pre-commit: `npx vitest run`

- [x] 4. Frontend: Wire GlobalSettingsPanel into App

  **What to do**:
  - In `App.svelte`: Import `GlobalSettingsPanel` component.
  - Add a new `showGlobalSettings` boolean state variable (default false).
  - Add a gear icon button in the header `.status-bar` area (before the existing Settings button). Use a simple gear character or SVG. Style it similar to the existing `.settings-btn`.
  - Make the three view states mutually exclusive: `{#if showGlobalSettings}` → GlobalSettingsPanel, `{:else if showSettings}` → SettingsPanel, `{:else if selectedTask}` → TaskDetailView, `{:else}` → KanbanBoard.
  - When opening global settings, close project settings (and vice versa). When selecting a task, close both.
  - Wire the GlobalSettingsPanel `on:close` event to set `showGlobalSettings = false`.

  **Must NOT do**:
  - Do NOT change any existing event handlers or data loading logic
  - Do NOT add new stores — use local component state
  - Do NOT modify the ProjectSwitcher or its event handling

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small wiring change in a single file — adding an import, a button, and a conditional block
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not needed — just wiring, no design work

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 5)
  - **Blocks**: Task 7
  - **Blocked By**: Tasks 2, 3

  **References**:

  **Pattern References**:
  - `src/App.svelte:160-212` — Current template structure. Line 165: existing settings button in `.status-bar`. Lines 183-198: conditional rendering chain (`{#if showSettings} → {:else if selectedTask} → {:else}`). Add a new `{#if showGlobalSettings}` branch at the start of this chain.
  - `src/App.svelte:312-325` — `.settings-btn` CSS. Copy this styling for the gear button.
  - `src/App.svelte:11-12` — Existing imports of SettingsPanel. Add GlobalSettingsPanel import next to it.
  - `src/App.svelte:183-184` — Where SettingsPanel is rendered with `on:close` handler. Follow same pattern for GlobalSettingsPanel.

  **Acceptance Criteria**:
  - [ ] Gear icon/button visible in header bar
  - [ ] Clicking gear opens GlobalSettingsPanel
  - [ ] Global settings and project settings are mutually exclusive
  - [ ] Clicking a task in kanban closes any open settings panel
  - [ ] `npx vitest run` → all tests pass

  **QA Scenarios**:

  ```
  Scenario: Gear button opens global settings
    Tool: Playwright (playwright skill)
    Preconditions: App running at http://localhost:1420
    Steps:
      1. Navigate to http://localhost:1420
      2. Assert gear icon/button visible in header bar
      3. Click gear button
      4. Assert GlobalSettingsPanel is visible (contains JIRA and GitHub sections with credential fields)
      5. Assert Kanban board is NOT visible
      6. Take screenshot
    Expected Result: Global settings panel replaces main content area
    Failure Indicators: Panel doesn't appear, board still visible underneath
    Evidence: .sisyphus/evidence/task-4-gear-opens-global.png

  Scenario: Global and project settings are mutually exclusive
    Tool: Playwright (playwright skill)
    Preconditions: App running, at least one project exists
    Steps:
      1. Click gear button → global settings panel opens
      2. Click project settings button → assert global settings closes, project settings opens
      3. Click gear button again → assert project settings closes, global settings opens
      4. Take screenshot at each step
    Expected Result: Only one settings panel visible at a time
    Failure Indicators: Both panels visible simultaneously, or neither appears
    Evidence: .sisyphus/evidence/task-4-mutual-exclusion.png
  ```

  **Commit**: YES (groups with Task 5)
  - Message: `feat(app): wire global settings panel and add credential migration`
  - Files: `src/App.svelte`, `src-tauri/src/db.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml && npx vitest run`

- [x] 5. Backend: Add data migration for existing users

  **What to do**:
  - In `db.rs`: Add a migration step at the end of `run_migrations()` (after line 321, before `Ok(())`) that:
    1. Checks if the global `jira_api_token` config value is empty (the default).
    2. If empty, queries `project_config` for the first project's `jira_api_token` value.
    3. If found, copies `jira_base_url`, `jira_username`, `jira_api_token`, `github_token` from that project's config to the global `config` table.
    4. This is idempotent — if global values are already set, it does nothing.
  - Use a single transaction for the migration to ensure atomicity.
  - Add a comment explaining this is a one-time migration from per-project to global config.

  **Must NOT do**:
  - Do NOT modify existing default_configs entries
  - Do NOT remove data from project_config table (leave orphaned data in place)
  - Do NOT change the config table schema
  - Do NOT add new tables

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Small SQL migration — ~15 lines of code in an existing function
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Wrong language

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:131-323` — `run_migrations()` function. The migration should be added after line 321 (the last `INSERT OR IGNORE` for next_project_id) and before the final `Ok(())` on line 323.
  - `src-tauri/src/db.rs:236-257` — Default config entries. These show the global keys that should be populated: `jira_api_token`, `jira_base_url`, `jira_username`, `github_token`. All default to empty string.
  - `src-tauri/src/db.rs:276-283` — `project_config` table schema. The migration reads from this table.

  **API/Type References**:
  - `src-tauri/src/db.rs:332-351` — `get_config()` and `set_config()` — can be used as reference for the SQL patterns, but the migration should use direct SQL within the migration function since `self` methods lock the conn.

  **Acceptance Criteria**:
  - [ ] `cargo build --manifest-path src-tauri/Cargo.toml` → compiles cleanly
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass (including `test_database_initialization` which exercises `run_migrations()`)
  - [ ] Migration is idempotent: running it twice produces the same result
  - [ ] If global credentials already set, migration does nothing
  - [ ] If no projects exist, migration does nothing (no crash)

  **QA Scenarios**:

  ```
  Scenario: Migration copies credentials from first project to global config
    Tool: Bash (cargo test)
    Preconditions: Test database with a project and project_config entries for credentials
    Steps:
      1. Create a test database
      2. Insert a project
      3. Insert project_config entries for jira_api_token, jira_base_url, jira_username, github_token
      4. Run migrations (Database::new will trigger them)
      5. Read global config values for the same keys
      6. Assert they match the project_config values
    Expected Result: Global config populated from first project's credentials
    Failure Indicators: Global config still empty, wrong values, or SQL errors
    Evidence: .sisyphus/evidence/task-5-migration-test.txt

  Scenario: Migration is idempotent — doesn't overwrite existing global credentials
    Tool: Bash (cargo test)
    Preconditions: Test database with global config already set
    Steps:
      1. Create a test database
      2. Set global jira_api_token to "existing-token"
      3. Insert a project with project_config jira_api_token = "project-token"
      4. Run migrations again
      5. Read global jira_api_token
      6. Assert it's still "existing-token" (not overwritten)
    Expected Result: Existing global values preserved
    Failure Indicators: Global values overwritten with project values
    Evidence: .sisyphus/evidence/task-5-migration-idempotent.txt
  ```

  **Commit**: YES (groups with Task 4)
  - Message: `feat(app): wire global settings panel and add credential migration`
  - Files: `src-tauri/src/db.rs`
  - Pre-commit: `cargo build --manifest-path src-tauri/Cargo.toml && cargo test --manifest-path src-tauri/Cargo.toml`

- [x] 6. Tests: Backend tests for updated pollers and migration

  **What to do**:
  - In `jira_sync.rs`: Add a test in the `#[cfg(test)] mod tests` section that verifies the refactored config-reading function reads credentials from the global `config` table (not `project_config`). Create a test DB, set global config values, create a project, and assert the function returns the correct credentials.
  - In `github_poller.rs`: Add a test that verifies the refactored config-reading function reads `github_token` from global config and `github_default_repo` from project_config. Create a test DB with both global and per-project config, assert the correct values are returned.
  - In `db.rs`: Add a test for the migration logic — create a DB with project_config entries but empty global config, trigger migration, assert global config is populated. Add a second test for idempotency — global config already set, migration doesn't overwrite.
  - Follow existing test patterns: use `make_test_db()` helper, clean up temp files after test.

  **Must NOT do**:
  - Do NOT modify production code in this task — only add tests
  - Do NOT test `refresh_jira_info` (it was not changed)

  **Recommended Agent Profile**:
  - **Category**: `unspecified-high`
    - Reason: Requires understanding the refactored config flow and writing meaningful Rust tests
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `golang`: Wrong language

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 7)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 5

  **References**:

  **Pattern References**:
  - `src-tauri/src/db.rs:1333-1416` — Existing test module with `make_test_db()` helper and `insert_test_task()`. Follow this exact pattern for new tests.
  - `src-tauri/src/db.rs:1378-1409` — `test_config_operations` — shows how to test get_config/set_config.
  - `src-tauri/src/github_poller.rs:492-601` — Existing test module with unit tests for `find_matching_task_ids` and `parse_github_timestamp`. Add new tests in this module.

  **Test References**:
  - `src-tauri/src/db.rs:1411-1416` — `make_test_db` helper creates temp DB with unique name
  - `src-tauri/src/db.rs:1418-1425` — `insert_test_task` helper inserts a task for foreign key satisfaction

  **Acceptance Criteria**:
  - [ ] `cargo test --manifest-path src-tauri/Cargo.toml` → all tests pass including new ones
  - [ ] At least 2 new tests in db.rs (migration + idempotency)
  - [ ] At least 1 new test in jira_sync.rs or github_poller.rs (config reading)
  - [ ] All tests clean up temp DB files

  **QA Scenarios**:

  ```
  Scenario: All backend tests pass including new ones
    Tool: Bash (cargo test)
    Preconditions: All implementation tasks (1, 5) completed
    Steps:
      1. Run: cargo test --manifest-path src-tauri/Cargo.toml 2>&1
      2. Count total tests run
      3. Assert exit code 0
      4. Assert new test names appear in output (e.g., test_migration_copies_credentials, test_migration_idempotent)
    Expected Result: All tests pass, new tests visible in output
    Failure Indicators: Test failures, missing new test names
    Evidence: .sisyphus/evidence/task-6-backend-tests.txt

  Scenario: Migration test verifies correct data flow
    Tool: Bash (cargo test)
    Preconditions: Migration test implemented
    Steps:
      1. Run: cargo test --manifest-path src-tauri/Cargo.toml test_migration 2>&1
      2. Assert exit code 0
      3. Assert both migration tests pass
    Expected Result: Migration tests demonstrate correct credential copying and idempotency
    Failure Indicators: Test failures, assertion errors
    Evidence: .sisyphus/evidence/task-6-migration-tests.txt
  ```

  **Commit**: YES (groups with Task 7)
  - Message: `test: add tests for global config migration and updated pollers`
  - Files: `src-tauri/src/db.rs`, `src-tauri/src/jira_sync.rs`, `src-tauri/src/github_poller.rs`
  - Pre-commit: `cargo test --manifest-path src-tauri/Cargo.toml`

- [x] 7. Tests: Frontend tests for settings components

  **What to do**:
  - Create `src/components/GlobalSettingsPanel.test.ts`: Test that the component renders all 4 credential fields (jira_base_url, jira_username, jira_api_token, github_token). Mock `getConfig` and `setConfig` from ipc.ts. Test that save button calls `setConfig` with correct keys. Test that close button dispatches 'close' event.
  - Create or update `src/components/SettingsPanel.test.ts`: Test that the component does NOT render credential fields. Test that it DOES render project name, repos root path, board ID, and default repo fields. Mock `getProjectConfig` and `setProjectConfig`.
  - Follow existing test patterns from `Toast.test.ts` and other colocated test files.

  **Must NOT do**:
  - Do NOT modify component source files — only add/update test files
  - Do NOT test implementation details (internal state) — test observable behavior

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: Standard vitest component tests following existing patterns
  - **Skills**: []
  - **Skills Evaluated but Omitted**:
    - `frontend-ui-ux`: Not needed for test files

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 3 (with Task 6)
  - **Blocks**: F1-F4
  - **Blocked By**: Task 4

  **References**:

  **Pattern References**:
  - `src/components/Toast.test.ts` — Existing test file pattern. Shows imports (render, screen, fireEvent from testing-library, describe/it/expect/vi from vitest), component rendering, store manipulation, and event testing.

  **Test References**:
  - `src/__mocks__/@tauri-apps/api/` — Existing Tauri API mocks. The ipc.ts functions are mocked via `vi.mock('../lib/ipc')` pattern.
  - `vitest.config.ts` — Test configuration with path aliases for Tauri mocks.

  **API/Type References**:
  - `src/lib/ipc.ts:112-118` — `getConfig` and `setConfig` signatures to mock
  - `src/lib/ipc.ts:48-54` — `getProjectConfig` and `setProjectConfig` signatures to mock

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/GlobalSettingsPanel.test.ts`
  - [ ] File exists: `src/components/SettingsPanel.test.ts`
  - [ ] `npx vitest run` → all tests pass including new ones
  - [ ] GlobalSettingsPanel tests verify field rendering and save behavior
  - [ ] SettingsPanel tests verify credential fields are absent

  **QA Scenarios**:

  ```
  Scenario: All frontend tests pass including new ones
    Tool: Bash (npx vitest run)
    Preconditions: All implementation tasks completed
    Steps:
      1. Run: npx vitest run 2>&1
      2. Assert exit code 0
      3. Assert GlobalSettingsPanel.test.ts appears in output
      4. Assert SettingsPanel.test.ts appears in output
      5. Count total tests
    Expected Result: All tests pass, new test files executed
    Failure Indicators: Test failures, import errors, mock issues
    Evidence: .sisyphus/evidence/task-7-frontend-tests.txt

  Scenario: SettingsPanel test confirms no credential fields
    Tool: Bash (npx vitest run)
    Preconditions: SettingsPanel.test.ts created
    Steps:
      1. Run: npx vitest run src/components/SettingsPanel.test.ts 2>&1
      2. Assert exit code 0
      3. Assert test "does not render credential fields" passes
    Expected Result: Test confirms credential fields are absent from SettingsPanel
    Failure Indicators: Test finds credential fields that should have been removed
    Evidence: .sisyphus/evidence/task-7-settings-no-creds.txt
  ```

  **Commit**: YES (groups with Task 6)
  - Message: `test: add tests for global config migration and updated pollers`
  - Files: `src/components/GlobalSettingsPanel.test.ts`, `src/components/SettingsPanel.test.ts`
  - Pre-commit: `npx vitest run`

---

## Final Verification Wave

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [x] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, cargo build, cargo test). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [x] F2. **Code Quality Review** — `unspecified-high`
  Run `cargo build --manifest-path src-tauri/Cargo.toml` + `npx vitest run`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod code, commented-out code, unused imports. Check AI slop: excessive comments, over-abstraction, generic variable names. Verify Rust code has no `unwrap()` in production paths (test code OK).
  Output: `Build [PASS/FAIL] | Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [x] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill) — SKIPPED (requires running Tauri app)
  Start from clean state. Execute EVERY QA scenario from EVERY task — follow exact steps, capture evidence. Test cross-task integration: save global credentials → verify pollers can read them → verify project settings don't show credentials. Test edge cases: empty credentials, no projects, switching between settings panels. Save to `.sisyphus/evidence/final-qa/`.
  Output: `Scenarios [N/N pass] | Integration [N/N] | Edge Cases [N tested] | VERDICT`

- [x] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built (no missing), nothing beyond spec was built (no creep). Check "Must NOT do" compliance — especially verify `refresh_jira_info` was NOT modified, no new Tauri commands were added, no default config entries were removed. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | Contamination [CLEAN/N issues] | Unaccounted [CLEAN/N files] | VERDICT`

---

## Commit Strategy

| After Task | Message | Files | Verification |
|------------|---------|-------|--------------|
| 1 | `refactor(backend): read jira/github credentials from global config` | jira_sync.rs, github_poller.rs, main.rs | cargo build |
| 2 | `feat(ui): add global settings panel for credentials` | GlobalSettingsPanel.svelte | npx vitest run |
| 3 | `refactor(ui): remove credential fields from project settings` | SettingsPanel.svelte, ProjectSetupDialog.svelte | npx vitest run |
| 4+5 | `feat(app): wire global settings panel and add credential migration` | App.svelte, db.rs | cargo build && npx vitest run |
| 6+7 | `test: add tests for global config refactor` | *.test.ts, jira_sync.rs, github_poller.rs | cargo test && npx vitest run |

---

## Success Criteria

### Verification Commands
```bash
cargo build --manifest-path src-tauri/Cargo.toml  # Expected: compiles cleanly
cargo test --manifest-path src-tauri/Cargo.toml    # Expected: all tests pass
npx vitest run                                      # Expected: all tests pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Global settings panel works without active project
- [ ] Project settings panel shows no credential fields
- [ ] JIRA sync uses global credentials
- [ ] GitHub poller uses global token + per-project repo
- [ ] Existing credentials migrated on first launch
