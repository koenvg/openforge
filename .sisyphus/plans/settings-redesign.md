# Settings Page Redesign — Variation A (Light)

## TL;DR

> **Quick Summary**: Replace the current split Settings page (SettingsPanel + GlobalSettingsPanel with tab switching) with a unified two-column layout featuring a sidebar nav and grouped card sections, following the Variation A design from `design.pen`.
> 
> **Deliverables**:
> - New `SettingsView.svelte` container with sidebar nav + scrollable card content
> - 6 section card sub-components (General, Integrations, AI, Credentials, Actions, Sidebar)
> - Updated App.svelte routing (remove tab switching, single unified view)
> - Comprehensive test file covering all functionality
> - Old SettingsPanel + GlobalSettingsPanel deleted
> 
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 4 waves (peak 6-way parallelism in Wave 2)
> **Critical Path**: T1 → T2 → T4-T8 → T9 → T10 → F1-F4

---

## Context

### Original Request
User designed creative Variation A of the Settings page in Pencil (`design.pen`, node `aXIkK`) — a modern two-column layout with sidebar navigation and grouped card sections. Wants to implement it as the actual Settings page, replacing the current design entirely. User also decided to merge project and global settings into one unified page.

### Interview Summary
**Key Discussions**:
- **Scope**: Variation A only (light mode), no Variation B
- **Replace entirely**: Remove old SettingsPanel + GlobalSettingsPanel, no feature flag
- **Nav behavior**: Scroll-to-section with smooth animation, all sections visible
- **Merge project + global**: One unified settings page, no more tab switching
- **Credentials**: New 5th sidebar section with its own card for JIRA credentials + GitHub PAT
- **Delete Project**: Danger Zone section at bottom of scroll area

**Research Findings**:
- Current architecture is monolithic: SettingsPanel (308 lines, 6 sections) + GlobalSettingsPanel (157 lines, 3 sections)
- All state local to components, no store mutations — safe to refactor
- 15+ IPC calls must be preserved (complete inventory in Metis review)
- Tab switching in App.svelte (lines 639-662) needs replacement
- Existing tests: SettingsPanel.test.ts (118 lines), GlobalSettingsPanel.test.ts (95 lines)
- No reusable form components — all inlined with daisyUI classes
- Light-only theme "openforge", CSS-only animations, no Svelte transitions

### Metis Review
**Identified Gaps** (addressed):
- **Credentials placement**: Design didn't show JIRA/GitHub credentials → User chose new "Credentials" sidebar section
- **Delete Project missing**: Not in design → User chose "Danger Zone" at bottom
- **No-project state**: First-time users need global settings access → Resolved: project sections disabled, global sections remain active
- **Stale `global_settings` navigation**: Old history entries → Resolved: map `global_settings` → `settings` silently
- **Save partial failure**: Single button saves both → Resolved: try both, console.error on failure (matches current pattern)

---

## Work Objectives

### Core Objective
Replace the existing split Settings UI with a unified two-column layout matching Variation A from `design.pen`, merging project and global settings into one page.

### Concrete Deliverables
- `src/components/SettingsSidebar.svelte` — Left sidebar navigation (220px)
- `src/components/SettingsGeneralCard.svelte` — Project name + path card
- `src/components/SettingsIntegrationsCard.svelte` — JIRA board ID + GitHub repo card
- `src/components/SettingsAICard.svelte` — AI provider + Whisper model + instructions card
- `src/components/SettingsCredentialsCard.svelte` — JIRA credentials + GitHub PAT card
- `src/components/SettingsActionsCard.svelte` — Actions CRUD card
- `src/components/SettingsView.svelte` — Main container (state, IPC, assembly)
- `src/components/SettingsView.test.ts` — Comprehensive tests
- Updated `src/App.svelte` — New routing (no tab switching)
- Updated `src/lib/types.ts` — Remove `global_settings` from `AppView`

### Definition of Done
- [ ] `pnpm test -- --run` → 0 failures
- [ ] All settings fields render with correct values from IPC
- [ ] Save button persists all project + global config via IPC
- [ ] Sidebar nav highlights active section on scroll
- [ ] Clicking sidebar item scrolls to section smoothly
- [ ] Actions CRUD (add, delete, toggle, reset) works identically to current
- [ ] ModelDownloadProgress renders correctly for Whisper models
- [ ] Delete Project with confirm dialog works
- [ ] No-project state shows global sections, disables project sections
- [ ] Old SettingsPanel.svelte + GlobalSettingsPanel.svelte deleted

### Must Have
- All 15+ IPC calls preserved with identical behavior
- TDD: tests written first, verified failing, then implementation
- daisyUI semantic classes only — no `<style>` blocks, no hardcoded hex
- Svelte 5 runes: `$state`, `$derived`, `$effect`, `$props()` with local `Props` interface
- `on`-prefixed callback props (never legacy event dispatcher)
- `import type` enforced by `verbatimModuleSyntax`
- Nullable fields use `T | null`, not optional
- All `invoke()` calls through typed wrappers in `src/lib/ipc.ts`

### Must NOT Have (Guardrails)
- NO input validation that doesn't exist today (no format checking)
- NO toast notifications or error display beyond current `console.error`
- NO refactoring of `actions.ts`, `ipc.ts`, or any Rust backend code
- NO changes to credential storage patterns (plain text in SQLite)
- NO keyboard shortcuts for settings navigation
- NO dark mode support
- NO auto-save or debouncing
- NO changes to `ModelDownloadProgress.svelte` internals
- NO changes to `IconRail.svelte` beyond what's needed for routing
- NO `<style>` blocks or hardcoded hex colors
- NO over-abstraction (generic "SettingsField" wrapper components)
- NO excessive JSDoc comments on every function

---

## Verification Strategy

> **ZERO HUMAN INTERVENTION** — ALL verification is agent-executed. No exceptions.

### Test Decision
- **Infrastructure exists**: YES (vitest configured, existing test files)
- **Automated tests**: TDD (RED → GREEN → REFACTOR per AGENTS.md)
- **Framework**: vitest (via `pnpm test`)
- **Each task**: Write/update tests first, verify fail, then implement

### QA Policy
Every task MUST include agent-executed QA scenarios.
Evidence saved to `.sisyphus/evidence/task-{N}-{scenario-slug}.{ext}`.

- **Frontend/UI**: Use Playwright (playwright skill) — Navigate, interact, assert DOM, screenshot
- **Tests**: Use Bash (`pnpm test -- --run`) — Assert pass count, zero failures

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation — 2 tasks, parallel):
├── Task 1: Update AppView type + stale nav handling [quick]
└── Task 2: Create SettingsView.test.ts (RED — all tests failing) [deep]

Wave 2 (Section Components — 6 tasks, ALL PARALLEL):
├── Task 3: SettingsSidebar.svelte (depends: none) [quick]
├── Task 4: SettingsGeneralCard.svelte (depends: none) [quick]
├── Task 5: SettingsIntegrationsCard.svelte (depends: none) [quick]
├── Task 6: SettingsAICard.svelte (depends: none) [quick]
├── Task 7: SettingsCredentialsCard.svelte (depends: none) [quick]
└── Task 8: SettingsActionsCard.svelte (depends: none) [quick]

Wave 3 (Assembly — 2 tasks, sequential):
├── Task 9: SettingsView.svelte container (depends: T1-T8) [deep]
└── Task 10: Make SettingsView.test.ts GREEN (depends: T9) [deep]

Wave 4 (Integration + Cleanup — 2 tasks, parallel):
├── Task 11: Update App.svelte routing (depends: T9) [quick]
└── Task 12: Delete old files + full test suite (depends: T11) [quick]

Wave FINAL (Verification — 4 parallel):
├── F1: Plan compliance audit (oracle)
├── F2: Code quality review (unspecified-high)
├── F3: Real QA with Playwright (unspecified-high + playwright)
└── F4: Scope fidelity check (deep)

Critical Path: T1 → T2 → T4-T8 (parallel) → T9 → T10 → T11 → T12 → F1-F4
Parallel Speedup: ~60% faster than sequential (6-way in Wave 2)
Max Concurrent: 6 (Wave 2)
```

### Dependency Matrix

| Task | Depends On | Blocks | Wave |
|------|-----------|--------|------|
| T1 | — | T9, T11 | 1 |
| T2 | — | T10 | 1 |
| T3 | — | T9 | 2 |
| T4 | — | T9 | 2 |
| T5 | — | T9 | 2 |
| T6 | — | T9 | 2 |
| T7 | — | T9 | 2 |
| T8 | — | T9 | 2 |
| T9 | T1, T3-T8 | T10, T11 | 3 |
| T10 | T2, T9 | T11 | 3 |
| T11 | T9 | T12 | 4 |
| T12 | T11 | F1-F4 | 4 |

### Agent Dispatch Summary

- **Wave 1**: 2 — T1 → `quick`, T2 → `deep`
- **Wave 2**: 6 — T3-T8 → `quick` (all visual-engineering or quick)
- **Wave 3**: 2 — T9 → `deep`, T10 → `deep`
- **Wave 4**: 2 — T11 → `quick`, T12 → `quick`
- **FINAL**: 4 — F1 → `oracle`, F2 → `unspecified-high`, F3 → `unspecified-high`, F4 → `deep`

---

## TODOs

- [x] 1. Update AppView type + stale navigation handling

  **What to do**:
  - Remove `'global_settings'` from the `AppView` union type in `src/lib/types.ts` (line ~313)
  - In `src/App.svelte`, find any place where `$currentView === 'global_settings'` is checked and map it to `'settings'` instead (the `navigateBack()` flow could restore a stale `global_settings` value from history)
  - In `src/lib/navigation.ts`, if the history stack contains `'global_settings'`, map it to `'settings'` when popping

  **Must NOT do**:
  - Do NOT modify `IconRail.svelte` (it already navigates to `'settings'` only)
  - Do NOT change the `currentView` store definition — only the `AppView` type
  - Do NOT remove the `'settings'` value — only `'global_settings'`

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: T9, T11
  - **Blocked By**: None

  **References**:
  - `src/lib/types.ts:313` — `AppView` union type definition, remove `'global_settings'`
  - `src/App.svelte:639-662` — Settings tab switching logic that references `global_settings`
  - `src/App.svelte` — Search for all `global_settings` occurrences (4 total per Metis)
  - `src/lib/navigation.ts` — History stack that may contain stale `global_settings` entries

  **Acceptance Criteria**:
  - [ ] `pnpm test -- --run` passes (no type errors from removing the union member)
  - [ ] `grep -r "global_settings" src/lib/types.ts` returns 0 results
  - [ ] TypeScript compilation: no errors related to `AppView`

  **QA Scenarios**:
  ```
  Scenario: AppView type no longer includes global_settings
    Tool: Bash
    Preconditions: Task changes applied
    Steps:
      1. Run: grep -r "'global_settings'" src/lib/types.ts
      2. Assert: 0 matches
      3. Run: pnpm test -- --run
      4. Assert: 0 failures
    Expected Result: Type updated cleanly, no compilation errors
    Evidence: .sisyphus/evidence/task-1-type-update.txt

  Scenario: Stale navigation handled gracefully
    Tool: Bash
    Preconditions: Task changes applied
    Steps:
      1. Run: grep -rn "global_settings" src/ --include="*.ts" --include="*.svelte"
      2. Assert: Only mapping/fallback code remains (no direct usage as a view value)
    Expected Result: Any remaining references are mapping global_settings → settings
    Evidence: .sisyphus/evidence/task-1-stale-nav.txt
  ```

  **Commit**: YES (groups with T2)
  - Message: `refactor(settings): remove global_settings from AppView type`
  - Files: `src/lib/types.ts`, `src/App.svelte`, `src/lib/navigation.ts`
  - Pre-commit: `pnpm test -- --run`

- [x] 2. Create SettingsView.test.ts — comprehensive failing test suite (RED)

  **What to do**:
  - Create `src/components/SettingsView.test.ts` with ALL test cases for the unified settings page
  - Follow TDD: every test MUST fail (RED) because `SettingsView.svelte` doesn't exist yet
  - Mock ALL IPC calls following existing patterns from `SettingsPanel.test.ts` and `GlobalSettingsPanel.test.ts`
  - Test categories:
    1. **Rendering**: All 5 section cards render (General, Integrations, AI, Credentials, Actions)
    2. **Sidebar**: 5 nav items with correct labels and icons
    3. **Project fields**: name, path, JIRA board ID, GitHub repo, AI instructions populated from IPC
    4. **Global fields**: AI provider, JIRA base URL/username/token, GitHub PAT populated from IPC
    5. **Save**: Single save button calls ALL IPC functions (both `setProjectConfig` and `setConfig`)
    6. **Actions CRUD**: Add, delete, toggle, reset actions
    7. **Password fields**: JIRA API token and GitHub PAT are `type="password"`
    8. **Whisper**: Model selector renders, status badges show
    9. **Delete Project**: Button exists, calls `deleteProject` with confirm
    10. **No-project state**: When `activeProjectId` is null, project sections disabled, global sections visible
  - Use `vi.mock('../lib/ipc', ...)` pattern from existing tests
  - Use `vi.mock('../lib/actions', ...)` for action management
  - All tests should be `it('...')` blocks inside `describe('SettingsView', ...)` 

  **Must NOT do**:
  - Do NOT create `SettingsView.svelte` yet — tests must fail
  - Do NOT modify existing test files
  - Do NOT add tests for features not in current implementation (no validation tests, no toast tests)

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: T10
  - **Blocked By**: None

  **References**:
  - `src/components/SettingsPanel.test.ts` — Existing project settings tests (118 lines). Copy mock patterns for `getProjectConfig`, `setProjectConfig`, `updateProject`, `deleteProject`, `getAgents`, `getConfig`, `getAllWhisperModelStatuses`, `setWhisperModel`
  - `src/components/GlobalSettingsPanel.test.ts` — Existing global settings tests (95 lines). Copy mock patterns for `getConfig`, `setConfig`, `checkOpenCodeInstalled`, `checkClaudeInstalled`
  - `src/lib/actions.ts` — Action management functions to mock: `loadActions`, `saveActions`, `createAction`
  - `src/lib/types.ts:349-356` — `Action` interface shape
  - `src/lib/types.ts:370-380` — `WhisperModelStatus` interface shape
  - `src/lib/stores.ts` — `activeProjectId`, `projects` stores to mock

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsView.test.ts`
  - [ ] `pnpm test -- --run src/components/SettingsView.test.ts` → ALL tests FAIL (RED state)
  - [ ] At least 15 test cases covering all categories listed above
  - [ ] All IPC mocks defined (complete mock factory)

  **QA Scenarios**:
  ```
  Scenario: All tests exist and fail (RED)
    Tool: Bash
    Preconditions: SettingsView.test.ts created, SettingsView.svelte does NOT exist
    Steps:
      1. Run: pnpm test -- --run src/components/SettingsView.test.ts 2>&1 || true
      2. Assert: Output shows test failures (not 0 pass)
      3. Count test cases: grep -c "it(" src/components/SettingsView.test.ts
      4. Assert: >= 15 test cases
    Expected Result: All tests fail because component doesn't exist yet
    Evidence: .sisyphus/evidence/task-2-red-tests.txt
  ```

  **Commit**: YES (groups with T1)
  - Message: `test(settings): add comprehensive failing tests for unified SettingsView (RED)`
  - Files: `src/components/SettingsView.test.ts`
  - Pre-commit: None (tests are expected to fail)

- [x] 3. Create SettingsSidebar.svelte — sidebar navigation component

  **What to do**:
  - Create `src/components/SettingsSidebar.svelte` — the 220px left sidebar nav
  - Props interface:
    - `activeSection: string` — currently visible section ID
    - `onNavigate: (sectionId: string) => void` — callback when nav item clicked
    - `hasProject: boolean` — whether a project is selected (to dim project-only sections)
  - Render 5 nav items with lucide-svelte icons:
    1. Project (folder icon) — dimmed when `!hasProject`
    2. Integrations (plug icon) — dimmed when `!hasProject`
    3. AI & Voice (brain icon) — always active
    4. Credentials (key-round icon) — always active
    5. Actions (zap icon) — dimmed when `!hasProject`
  - Active state: green left border (3px `border-l-primary`), green background tint (`bg-primary/5`), green text + icon
  - Inactive state: gray text, no background, no border
  - Header: "SETTINGS" label in uppercase, tracking-wider, text-base-content/50, text-xs, font-semibold
  - Use daisyUI classes: `w-[220px] bg-base-100 border-r border-base-300`
  - Use `on`-prefixed callback prop pattern

  **Must NOT do**:
  - Do NOT add scroll spy logic here — the parent manages `activeSection`
  - Do NOT add keyboard navigation
  - Do NOT use `<style>` blocks

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Nav component needs clean visual design matching the Pencil design

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T4, T5, T6, T7, T8)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `design.pen` node `aXIkK` — Sidebar design: Settings Nav frame with 4 nav items (adding 5th for Credentials)
  - `src/components/IconRail.svelte` — Existing nav pattern: lucide-svelte icons, active state styling, callback props
  - `src/components/SettingsPanel.svelte:159` — Section header styling: `text-xs font-semibold text-primary uppercase tracking-wider`
  - `src/app.css:9-44` — Theme colors: primary=#00D084, base-100=white, base-300=#E0E0E0

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsSidebar.svelte`
  - [ ] Component renders 5 nav items with correct labels
  - [ ] Active item has green border + tint, inactive items are gray
  - [ ] Clicking item calls `onNavigate` with section ID
  - [ ] No `<style>` blocks, no hardcoded hex colors

  **QA Scenarios**:
  ```
  Scenario: Sidebar renders correctly in isolation
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep -c "onNavigate" src/components/SettingsSidebar.svelte
      2. Assert: >= 1 (callback prop defined)
      3. Run: grep "lucide-svelte" src/components/SettingsSidebar.svelte
      4. Assert: Contains lucide icon imports (Folder, Plug, Brain, KeyRound, Zap)
      5. Run: grep "<style" src/components/SettingsSidebar.svelte
      6. Assert: 0 matches (no style blocks)
    Expected Result: Component follows all conventions
    Evidence: .sisyphus/evidence/task-3-sidebar.txt
  ```

  **Commit**: YES (groups with T4-T8)
  - Message: `feat(settings): add sidebar navigation component`
  - Files: `src/components/SettingsSidebar.svelte`

- [x] 4. Create SettingsGeneralCard.svelte — project name + path card

  **What to do**:
  - Create `src/components/SettingsGeneralCard.svelte` — the "General" settings card
  - Props interface:
    - `projectName: string` — current project name
    - `projectPath: string` — current project path
    - `disabled: boolean` — true when no project selected
    - `onProjectNameChange: (value: string) => void`
    - `onProjectPathChange: (value: string) => void`
  - Render a card with:
    - Card header: folder-open icon (lucide) + "General" title, separated by bottom border
    - Two-column row: Project Name field (left) + Project Path field (right)
    - Each field: label (text-[0.7rem] text-base-content/50 uppercase tracking-wider) + input (input input-bordered input-sm)
  - Card styling: `bg-base-100 rounded-lg border border-base-300 p-5` with vertical gap
  - When `disabled`, fields should be `opacity-50 pointer-events-none`
  - Bind input values to props, call onChange callbacks on input events

  **Must NOT do**:
  - Do NOT add validation
  - Do NOT add the Delete Project button here (that's in the Danger Zone)
  - Do NOT manage state — this is a presentational component

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3, T5, T6, T7, T8)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `design.pen` node `aXIkK` — Card: General with two-column row (Name + Path fields)
  - `src/components/SettingsPanel.svelte:159-172` — Current project name/path fields (labels, input classes, binding pattern)
  - `src/components/GlobalSettingsPanel.svelte:87-128` — Form field styling pattern: `label class="flex flex-col gap-1"` + `span class="text-[0.7rem]"` + `input class="input input-bordered input-sm w-full"`

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsGeneralCard.svelte`
  - [ ] Renders card with icon header + 2 input fields
  - [ ] Props interface uses `on`-prefixed callbacks
  - [ ] Disabled state reduces opacity

  **QA Scenarios**:
  ```
  Scenario: General card structure correct
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep "interface Props" src/components/SettingsGeneralCard.svelte
      2. Assert: Props interface exists
      3. Run: grep "onProjectNameChange\|onProjectPathChange" src/components/SettingsGeneralCard.svelte
      4. Assert: Both callback props defined
      5. Run: grep "input-bordered" src/components/SettingsGeneralCard.svelte
      6. Assert: Uses daisyUI input classes
    Expected Result: Card follows design and conventions
    Evidence: .sisyphus/evidence/task-4-general-card.txt
  ```

  **Commit**: YES (groups with T3, T5-T8)
  - Message: `feat(settings): add General settings card component`
  - Files: `src/components/SettingsGeneralCard.svelte`

- [x] 5. Create SettingsIntegrationsCard.svelte — JIRA board + GitHub repo card

  **What to do**:
  - Create `src/components/SettingsIntegrationsCard.svelte` — the "Integrations" card
  - Props interface:
    - `jiraBoardId: string`
    - `githubDefaultRepo: string`
    - `disabled: boolean`
    - `onJiraBoardIdChange: (value: string) => void`
    - `onGithubDefaultRepoChange: (value: string) => void`
  - Render card with:
    - Card header: plug icon + "Integrations" title
    - Two-column layout:
      - Left column: JIRA sub-header (ticket icon, blue `text-info`, "JIRA") + Board ID input
      - Right column: GitHub sub-header (github icon, dark text, "GitHub") + Default Repo input
  - Same card styling as General card
  - When `disabled`, fields `opacity-50 pointer-events-none`

  **Must NOT do**:
  - Do NOT include JIRA credentials here (those go in SettingsCredentialsCard)
  - Do NOT include GitHub PAT here

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3, T4, T6, T7, T8)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `design.pen` node `aXIkK` — Card: Integrations with JIRA/GitHub sub-sections
  - `src/components/SettingsPanel.svelte:174-188` — Current JIRA board ID + GitHub repo fields
  - `src/lib/types.ts` — No special types needed, these are plain strings

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsIntegrationsCard.svelte`
  - [ ] Renders JIRA and GitHub sub-sections with distinct styling
  - [ ] Two input fields with correct labels
  - [ ] JIRA sub-header uses blue accent (`text-info`)

  **QA Scenarios**:
  ```
  Scenario: Integrations card structure correct
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep "jiraBoardId\|githubDefaultRepo" src/components/SettingsIntegrationsCard.svelte
      2. Assert: Both props exist
      3. Run: grep "text-info" src/components/SettingsIntegrationsCard.svelte
      4. Assert: JIRA sub-header uses info color
    Expected Result: Card matches design with JIRA/GitHub split
    Evidence: .sisyphus/evidence/task-5-integrations-card.txt
  ```

  **Commit**: YES (groups with T3, T4, T6-T8)
  - Message: `feat(settings): add Integrations settings card component`
  - Files: `src/components/SettingsIntegrationsCard.svelte`

- [x] 6. Create SettingsAICard.svelte — AI provider + Whisper + instructions card

  **What to do**:
  - Create `src/components/SettingsAICard.svelte` — the "AI Configuration" card
  - Props interface:
    - `aiProvider: string` — "claude-code" or "opencode"
    - `aiProviderInstalled: boolean` — whether selected provider is installed
    - `aiProviderVersion: string | null` — version string if installed
    - `modelStatuses: WhisperModelStatus[]` — all Whisper model states
    - `activeModelSize: string | null` — currently active model size
    - `downloadingModel: string | null` — model currently being downloaded
    - `agentInstructions: string` — AI instructions textarea content
    - `disabled: boolean` — for project-specific fields (instructions)
    - `onAiProviderChange: (value: string) => void`
    - `onWhisperModelChange: (modelSize: string) => void`
    - `onInstructionsChange: (value: string) => void`
    - `onDownloadComplete: () => void`
    - `onDownloadError: () => void`
  - Render card with:
    - Card header: brain icon + "AI Configuration" title + installed/not-installed status badge (pill, green/red)
    - Two-column row: AI Provider select (left) + Whisper Model select (right)
    - Status badges below each select (installed status, download status)
    - `ModelDownloadProgress` component when `downloadingModel` is set
    - Instructions textarea below (full-width), disabled when `!hasProject`
  - Provider select options: "Claude Code", "OpenCode"
  - Whisper model options: map from `modelStatuses` array
  - Import and use `ModelDownloadProgress` component as-is

  **Must NOT do**:
  - Do NOT modify `ModelDownloadProgress.svelte` internals
  - Do NOT add agent selector (current code shows it conditionally — keep same logic)
  - Do NOT add auto-save on provider change

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3, T4, T5, T7, T8)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `design.pen` node `aXIkK` — Card: AI Config with provider/model selects + status badges
  - `src/components/SettingsPanel.svelte:190-261` — Current AI instructions textarea + Whisper model section (complex: model selection, download progress, RAM info)
  - `src/components/GlobalSettingsPanel.svelte:87-128` — Current AI provider selection with install status checks
  - `src/components/ModelDownloadProgress.svelte:1-123` — Child component to reuse. Props: `modelSize`, `modelDisplayName`, `diskSizeMb`, `onComplete`, `onError`
  - `src/lib/types.ts:370-380` — `WhisperModelStatus` interface: `size`, `display_name`, `disk_size_mb`, `ram_usage_mb`, `downloaded`, `is_active`

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsAICard.svelte`
  - [ ] Provider select renders with 2 options
  - [ ] Whisper model select renders from `modelStatuses` prop
  - [ ] Status badges show installed/downloaded state
  - [ ] Instructions textarea renders, disabled when `disabled=true`
  - [ ] `ModelDownloadProgress` imported and rendered when downloading

  **QA Scenarios**:
  ```
  Scenario: AI card imports ModelDownloadProgress
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep "ModelDownloadProgress" src/components/SettingsAICard.svelte
      2. Assert: Component is imported
      3. Run: grep "select-bordered" src/components/SettingsAICard.svelte
      4. Assert: Uses daisyUI select classes
      5. Run: grep "textarea" src/components/SettingsAICard.svelte
      6. Assert: Instructions textarea exists
    Expected Result: AI card integrates existing ModelDownloadProgress
    Evidence: .sisyphus/evidence/task-6-ai-card.txt
  ```

  **Commit**: YES (groups with T3-T5, T7-T8)
  - Message: `feat(settings): add AI configuration card component`
  - Files: `src/components/SettingsAICard.svelte`

- [x] 7. Create SettingsCredentialsCard.svelte — JIRA credentials + GitHub PAT card

  **What to do**:
  - Create `src/components/SettingsCredentialsCard.svelte` — the "Credentials" card (NEW section)
  - Props interface:
    - `jiraBaseUrl: string`
    - `jiraUsername: string`
    - `jiraApiToken: string`
    - `githubToken: string`
    - `onJiraBaseUrlChange: (value: string) => void`
    - `onJiraUsernameChange: (value: string) => void`
    - `onJiraApiTokenChange: (value: string) => void`
    - `onGithubTokenChange: (value: string) => void`
  - Note: NO `disabled` prop — credentials are global, always accessible
  - Render card with:
    - Card header: key-round icon + "Credentials" title
    - Two-column layout:
      - Left: JIRA sub-header (ticket icon, blue) + Base URL input + Username input + API Token input (type="password")
      - Right: GitHub sub-header (github icon) + Personal Access Token input (type="password")
  - JIRA API Token and GitHub PAT MUST use `type="password"` for masking
  - Same card styling as other cards

  **Must NOT do**:
  - Do NOT add "show password" toggle
  - Do NOT add URL validation for JIRA base URL
  - Do NOT add a `disabled` state — credentials are always editable

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3-T6, T8)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `src/components/GlobalSettingsPanel.svelte:130-152` — Current JIRA credentials + GitHub PAT fields. Copy field layout pattern.
  - `src/components/GlobalSettingsPanel.test.ts:50-70` — Tests verifying password field types for API token and PAT
  - `design.pen` node `aXIkK` — No design for this card (new addition), follow same card pattern as Integrations card

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsCredentialsCard.svelte`
  - [ ] JIRA API Token input has `type="password"`
  - [ ] GitHub PAT input has `type="password"`
  - [ ] 4 input fields total (JIRA URL, username, token, GitHub PAT)
  - [ ] No `disabled` prop in interface

  **QA Scenarios**:
  ```
  Scenario: Credential fields are password type
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep 'type="password"' src/components/SettingsCredentialsCard.svelte | wc -l
      2. Assert: >= 2 (JIRA token + GitHub PAT)
      3. Run: grep "jiraBaseUrl\|jiraUsername\|jiraApiToken\|githubToken" src/components/SettingsCredentialsCard.svelte
      4. Assert: All 4 props present
    Expected Result: Sensitive fields properly masked
    Evidence: .sisyphus/evidence/task-7-credentials-card.txt
  ```

  **Commit**: YES (groups with T3-T6, T8)
  - Message: `feat(settings): add Credentials card component for JIRA/GitHub tokens`
  - Files: `src/components/SettingsCredentialsCard.svelte`

- [x] 8. Create SettingsActionsCard.svelte — actions CRUD card

  **What to do**:
  - Create `src/components/SettingsActionsCard.svelte` — the "Actions" card
  - Props interface:
    - `actions: Action[]` — current actions list
    - `availableAgents: string[]` — agent names for assignment dropdown (only when not claude-code)
    - `aiProvider: string` — to conditionally show agent selector
    - `disabled: boolean` — true when no project
    - `onAddAction: () => void`
    - `onDeleteAction: (actionId: string) => void`
    - `onToggleAction: (actionId: string) => void`
    - `onUpdateAction: (actionId: string, field: string, value: string) => void`
    - `onResetActions: () => void`
  - Render card with:
    - Card header: zap icon + "Actions" title (left) + "Add Action" button (right, dark bg)
    - Action rows: each action as a row with:
      - Left: icon (sparkles for custom, code for builtin) + name + description
      - Right: toggle switch (checkbox-primary) + delete icon (trash-2)
    - If action is expanded/editable: name input, prompt textarea, agent select (when applicable)
    - Reset to defaults button at bottom
  - Toggle: `<input type="checkbox" class="toggle toggle-primary toggle-sm" />`
  - Delete action: calls `onDeleteAction` after `confirm()` dialog for built-in actions
  - Reset: calls `onResetActions` after `confirm()` dialog

  **Must NOT do**:
  - Do NOT modify `src/lib/actions.ts`
  - Do NOT add drag-and-drop reordering
  - Do NOT change the Action type definition

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with T3-T7)
  - **Blocks**: T9
  - **Blocked By**: None

  **References**:
  - `design.pen` node `aXIkK` — Card: Actions with action rows (sparkles + Quick Review, code + Generate Tests) with toggles
  - `src/components/SettingsPanel.svelte:263-302` — Current actions section: CRUD logic, toggle, delete with confirm, reset, agent selector conditional
  - `src/lib/actions.ts:1-55` — `loadActions`, `saveActions`, `createAction` functions
  - `src/lib/types.ts:349-356` — `Action` interface: `id`, `name`, `prompt`, `agent`, `builtin`, `enabled`

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsActionsCard.svelte`
  - [ ] Add Action button calls `onAddAction`
  - [ ] Toggle switch calls `onToggleAction`
  - [ ] Delete calls `onDeleteAction` (with confirm for built-in)
  - [ ] Agent selector only shown when `aiProvider !== 'claude-code'`

  **QA Scenarios**:
  ```
  Scenario: Actions card has CRUD callbacks
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep "onAddAction\|onDeleteAction\|onToggleAction\|onResetActions" src/components/SettingsActionsCard.svelte
      2. Assert: All 4 callbacks present
      3. Run: grep "confirm(" src/components/SettingsActionsCard.svelte
      4. Assert: Confirm dialog used for destructive actions
      5. Run: grep "toggle" src/components/SettingsActionsCard.svelte
      6. Assert: Toggle component used
    Expected Result: Actions card has full CRUD with confirm guards
    Evidence: .sisyphus/evidence/task-8-actions-card.txt
  ```

  **Commit**: YES (groups with T3-T7)
  - Message: `feat(settings): add Actions CRUD card component`
  - Files: `src/components/SettingsActionsCard.svelte`

- [x] 9. Create SettingsView.svelte — main container with state management and assembly

  **What to do**:
  - Create `src/components/SettingsView.svelte` — the main unified settings container
  - This is the **central orchestrator**: manages ALL state, IPC calls, and renders all section cards
  - Props interface:
    - `onClose: () => void`
    - `onProjectDeleted: () => void`
  - State management (all `$state`):
    - Project state: `projectName`, `projectPath`, `jiraBoardId`, `githubDefaultRepo`, `agentInstructions`
    - Global state: `aiProvider`, `jiraBaseUrl`, `jiraUsername`, `jiraApiToken`, `githubToken`
    - AI state: `modelStatuses`, `downloadingModel`, `aiProviderInstalled`, `aiProviderVersion`
    - Actions state: `actions`, `availableAgents`
    - UI state: `isSaving`, `saved`, `activeSection`
  - Derived state:
    - `currentProject` from `$projects` + `$activeProjectId`
    - `hasProject` — boolean, true when `$activeProjectId` is not null
  - Lifecycle:
    - `$effect` on `$activeProjectId`: reload project config (getProjectConfig for each key)
    - `$effect` on mount: load global config (getConfig for each key), check installations, load model statuses
    - Load actions via `loadActions($activeProjectId)`
    - Load agents via `getAgents()`
  - Save handler: single function that:
    1. If `hasProject`: calls `updateProject`, `setProjectConfig` for each key, `saveActions`
    2. Always: calls `setConfig` for each global key
    3. Shows "Saved" feedback (same pattern as current: set `saved = true`, setTimeout reset)
  - Layout:
    - Outer: `flex h-full` (horizontal)
    - Left: `<SettingsSidebar>` with `activeSection` and `onNavigate`
    - Right: `flex-1 overflow-y-auto bg-base-200` scrollable content
      - Content header: "Project Settings" title + subtitle + Save button
      - Section cards: General, Integrations, AI, Credentials, Actions
      - Each card wrapped in `<section id="section-{name}">` for scroll-to targeting
      - Danger Zone at very bottom: red-bordered card with Delete Project button + confirm dialog
  - Scroll spy: use `IntersectionObserver` on each `<section>` element to update `activeSection` as user scrolls
  - Sidebar `onNavigate`: `document.getElementById('section-{id}')?.scrollIntoView({ behavior: 'smooth' })`
  - No-project state: project-specific cards (General, Integrations, Actions) show with `disabled` prop

  **Must NOT do**:
  - Do NOT add input validation
  - Do NOT add toast notifications — use current console.error + "Saved" text pattern
  - Do NOT add debouncing or auto-save
  - Do NOT modify any IPC wrapper in ipc.ts
  - Do NOT modify actions.ts

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: [`frontend-ui-ux`]
    - `frontend-ui-ux`: Complex layout with scroll spy, multiple sub-components, state orchestration

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential)
  - **Blocks**: T10, T11, T12
  - **Blocked By**: T1, T3, T4, T5, T6, T7, T8

  **References**:
  - `src/components/SettingsPanel.svelte:1-308` — ENTIRE FILE: copy state management patterns, `$effect` for project config loading (lines 47-72), save handler (lines 80-100), delete project (lines 103-115)
  - `src/components/GlobalSettingsPanel.svelte:1-157` — ENTIRE FILE: copy global state loading (lines 27-45), global save handler (lines 52-65), installation checks (lines 38-48)
  - `src/lib/ipc.ts` — All IPC wrappers to call (DO NOT modify, just import and use)
  - `src/lib/actions.ts` — `loadActions`, `saveActions`, `createAction` (DO NOT modify)
  - `src/lib/stores.ts` — `activeProjectId`, `projects`, `currentView` stores
  - `src/components/SettingsSidebar.svelte` — Import (created in T3)
  - `src/components/SettingsGeneralCard.svelte` — Import (created in T4)
  - `src/components/SettingsIntegrationsCard.svelte` — Import (created in T5)
  - `src/components/SettingsAICard.svelte` — Import (created in T6)
  - `src/components/SettingsCredentialsCard.svelte` — Import (created in T7)
  - `src/components/SettingsActionsCard.svelte` — Import (created in T8)

  **Acceptance Criteria**:
  - [ ] File exists: `src/components/SettingsView.svelte`
  - [ ] Imports and renders all 6 sub-components + sidebar
  - [ ] All IPC calls present (getProjectConfig, setProjectConfig, getConfig, setConfig, etc.)
  - [ ] Scroll spy via IntersectionObserver updates activeSection
  - [ ] Save button triggers all project + global saves
  - [ ] Delete Project with confirm dialog calls deleteProject IPC
  - [ ] No-project state: project cards disabled, global cards active

  **QA Scenarios**:
  ```
  Scenario: SettingsView imports all sub-components
    Tool: Bash
    Preconditions: Component created with all sub-components available
    Steps:
      1. Run: grep "import.*Settings" src/components/SettingsView.svelte
      2. Assert: Contains imports for Sidebar, GeneralCard, IntegrationsCard, AICard, CredentialsCard, ActionsCard
      3. Run: grep "IntersectionObserver" src/components/SettingsView.svelte
      4. Assert: Scroll spy implemented
      5. Run: grep "scrollIntoView" src/components/SettingsView.svelte
      6. Assert: Scroll-to-section navigation
      7. Run: grep "getProjectConfig\|setProjectConfig\|getConfig\|setConfig" src/components/SettingsView.svelte
      8. Assert: All IPC calls present
    Expected Result: Container orchestrates all sections with full IPC integration
    Evidence: .sisyphus/evidence/task-9-settings-view.txt

  Scenario: Danger Zone section exists
    Tool: Bash
    Preconditions: Component created
    Steps:
      1. Run: grep -i "danger\|delete.*project" src/components/SettingsView.svelte
      2. Assert: Danger zone section with delete project button exists
      3. Run: grep "confirm(" src/components/SettingsView.svelte
      4. Assert: Confirm dialog for delete
    Expected Result: Delete Project in Danger Zone with confirmation
    Evidence: .sisyphus/evidence/task-9-danger-zone.txt
  ```

  **Commit**: YES
  - Message: `feat(settings): assemble unified SettingsView with state management and scroll navigation`
  - Files: `src/components/SettingsView.svelte`
  - Pre-commit: None (tests still need wiring in T10)

- [x] 10. Make SettingsView.test.ts GREEN — wire tests to pass

  **What to do**:
  - Update `src/components/SettingsView.test.ts` (created in T2) to make all tests pass
  - Ensure mocks align with the actual component implementation from T9
  - Fix any test assertions that don't match the final component structure
  - Run `pnpm test -- --run src/components/SettingsView.test.ts` and iterate until ALL pass
  - Run `pnpm test -- --run` for full suite to check no regressions

  **Must NOT do**:
  - Do NOT reduce test coverage to make tests pass — fix the component or fix the test assertion
  - Do NOT remove test cases
  - Do NOT skip tests

  **Recommended Agent Profile**:
  - **Category**: `deep`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (sequential, after T9)
  - **Blocks**: T11
  - **Blocked By**: T2, T9

  **References**:
  - `src/components/SettingsView.test.ts` — The test file created in T2, now needs to pass
  - `src/components/SettingsView.svelte` — The component created in T9
  - `src/components/SettingsPanel.test.ts` — Reference for mock patterns that work
  - `src/components/GlobalSettingsPanel.test.ts` — Reference for mock patterns that work

  **Acceptance Criteria**:
  - [ ] `pnpm test -- --run src/components/SettingsView.test.ts` → ALL PASS (GREEN)
  - [ ] `pnpm test -- --run` → 0 failures (no regressions)
  - [ ] At least 15 test cases passing

  **QA Scenarios**:
  ```
  Scenario: All SettingsView tests pass (GREEN)
    Tool: Bash
    Preconditions: SettingsView.svelte and test file both exist
    Steps:
      1. Run: pnpm test -- --run src/components/SettingsView.test.ts
      2. Assert: All tests pass, 0 failures
      3. Run: pnpm test -- --run
      4. Assert: Full suite passes, 0 failures
    Expected Result: GREEN state achieved — all tests passing
    Evidence: .sisyphus/evidence/task-10-green-tests.txt
  ```

  **Commit**: YES
  - Message: `test(settings): make all SettingsView tests pass (GREEN)`
  - Files: `src/components/SettingsView.test.ts`
  - Pre-commit: `pnpm test -- --run`

- [ ] 11. Update App.svelte routing — integrate SettingsView

  **What to do**:
  - In `src/App.svelte`:
    1. Remove import of `SettingsPanel` and `GlobalSettingsPanel`
    2. Add import of `SettingsView`
    3. Replace the settings rendering block (lines ~639-662) that has tab switching between Project/Global with a single `<SettingsView>` render
    4. Remove the tab bar HTML (`<div class="flex bg-base-200 border-b border-base-300 px-6">` with Project/Global tab buttons)
    5. Update the `{#if $currentView === 'settings'}` block to render `<SettingsView onClose={...} onProjectDeleted={loadProjects} />`
    6. Remove any `{:else if $currentView === 'global_settings'}` block
    7. If there's a stale `global_settings` mapping needed, add: `$effect(() => { if ($currentView === 'global_settings') $currentView = 'settings' })`
  - Preserve the `onClose` and `onProjectDeleted` callback wiring

  **Must NOT do**:
  - Do NOT modify IconRail (it already navigates to 'settings')
  - Do NOT change any other view rendering (board, pr_review, skills)
  - Do NOT change the header rendering outside the settings block

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after T10)
  - **Blocks**: T12
  - **Blocked By**: T9

  **References**:
  - `src/App.svelte:639-662` — Current settings rendering with tab switching (REPLACE this block)
  - `src/App.svelte:1-30` — Import section (remove old, add new)
  - `src/App.svelte` — Search for `SettingsPanel` and `GlobalSettingsPanel` references (4 occurrences per Metis)

  **Acceptance Criteria**:
  - [ ] `SettingsPanel` import removed from App.svelte
  - [ ] `GlobalSettingsPanel` import removed from App.svelte
  - [ ] `SettingsView` imported and rendered
  - [ ] No tab bar HTML for Project/Global switching
  - [ ] `grep "SettingsPanel\|GlobalSettingsPanel" src/App.svelte` returns 0

  **QA Scenarios**:
  ```
  Scenario: App.svelte uses new SettingsView
    Tool: Bash
    Preconditions: All previous tasks complete
    Steps:
      1. Run: grep "SettingsPanel" src/App.svelte
      2. Assert: 0 matches (old component removed)
      3. Run: grep "GlobalSettingsPanel" src/App.svelte
      4. Assert: 0 matches (old component removed)
      5. Run: grep "SettingsView" src/App.svelte
      6. Assert: >= 1 match (new component imported and used)
      7. Run: pnpm test -- --run
      8. Assert: 0 failures
    Expected Result: App.svelte cleanly uses new unified SettingsView
    Evidence: .sisyphus/evidence/task-11-app-routing.txt
  ```

  **Commit**: YES (groups with T12)
  - Message: `refactor(settings): replace split settings with unified SettingsView in App routing`
  - Files: `src/App.svelte`
  - Pre-commit: `pnpm test -- --run`

- [ ] 12. Delete old files + full test suite verification

  **What to do**:
  - Delete old component files:
    - `src/components/SettingsPanel.svelte`
    - `src/components/SettingsPanel.test.ts`
    - `src/components/GlobalSettingsPanel.svelte`
    - `src/components/GlobalSettingsPanel.test.ts`
  - Run `pnpm test -- --run` to verify no imports break
  - Verify no other file imports the deleted components (use `grep -r "SettingsPanel\|GlobalSettingsPanel" src/`)
  - If any remaining references found, fix them

  **Must NOT do**:
  - Do NOT delete `ModelDownloadProgress.svelte` (still used by SettingsAICard)
  - Do NOT delete `actions.ts` (still used by SettingsView)

  **Recommended Agent Profile**:
  - **Category**: `quick`
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 4 (after T11)
  - **Blocks**: F1-F4
  - **Blocked By**: T11

  **References**:
  - `src/components/SettingsPanel.svelte` — DELETE
  - `src/components/SettingsPanel.test.ts` — DELETE
  - `src/components/GlobalSettingsPanel.svelte` — DELETE
  - `src/components/GlobalSettingsPanel.test.ts` — DELETE

  **Acceptance Criteria**:
  - [ ] 4 files deleted
  - [ ] `grep -r "SettingsPanel\|GlobalSettingsPanel" src/ --include="*.svelte" --include="*.ts"` returns 0
  - [ ] `pnpm test -- --run` → 0 failures
  - [ ] `ModelDownloadProgress.svelte` still exists

  **QA Scenarios**:
  ```
  Scenario: Old files deleted, no broken imports
    Tool: Bash
    Preconditions: App.svelte updated to use SettingsView
    Steps:
      1. Run: ls src/components/SettingsPanel.svelte 2>&1
      2. Assert: File not found
      3. Run: ls src/components/GlobalSettingsPanel.svelte 2>&1
      4. Assert: File not found
      5. Run: grep -r "SettingsPanel\|GlobalSettingsPanel" src/ --include="*.svelte" --include="*.ts"
      6. Assert: 0 matches
      7. Run: ls src/components/ModelDownloadProgress.svelte
      8. Assert: File exists (not deleted)
      9. Run: pnpm test -- --run
      10. Assert: 0 failures
    Expected Result: Clean deletion, no orphaned references, tests pass
    Evidence: .sisyphus/evidence/task-12-cleanup.txt
  ```

  **Commit**: YES
  - Message: `refactor(settings): remove old SettingsPanel and GlobalSettingsPanel components`
  - Files: DELETE `src/components/SettingsPanel.svelte`, DELETE `src/components/SettingsPanel.test.ts`, DELETE `src/components/GlobalSettingsPanel.svelte`, DELETE `src/components/GlobalSettingsPanel.test.ts`
  - Pre-commit: `pnpm test -- --run`

---

## Final Verification Wave (MANDATORY — after ALL implementation tasks)

> 4 review agents run in PARALLEL. ALL must APPROVE. Rejection → fix → re-run.

- [ ] F1. **Plan Compliance Audit** — `oracle`
  Read the plan end-to-end. For each "Must Have": verify implementation exists (read file, run command). For each "Must NOT Have": search codebase for forbidden patterns — reject with file:line if found. Check evidence files exist in .sisyphus/evidence/. Compare deliverables against plan.
  Output: `Must Have [N/N] | Must NOT Have [N/N] | Tasks [N/N] | VERDICT: APPROVE/REJECT`

- [ ] F2. **Code Quality Review** — `unspecified-high`
  Run `pnpm test -- --run`. Review all changed files for: `as any`/`@ts-ignore`, empty catches, console.log in prod, commented-out code, unused imports, `<style>` blocks, hardcoded hex colors. Check AI slop: excessive comments, over-abstraction, generic names.
  Output: `Tests [N pass/N fail] | Files [N clean/N issues] | VERDICT`

- [ ] F3. **Real Manual QA** — `unspecified-high` (+ `playwright` skill)
  Start the app with `pnpm tauri:dev`. Navigate to Settings. Verify: all 5 sidebar sections render, clicking each scrolls to its card, all form fields contain correct values, save button works, actions CRUD works, delete project works, sidebar highlights on scroll. Take screenshots.
  Output: `Scenarios [N/N pass] | VERDICT`

- [ ] F4. **Scope Fidelity Check** — `deep`
  For each task: read "What to do", read actual diff (git log/diff). Verify 1:1 — everything in spec was built, nothing beyond spec. Check "Must NOT do" compliance. Detect cross-task contamination. Flag unaccounted changes.
  Output: `Tasks [N/N compliant] | VERDICT`

---

## Commit Strategy

- **Wave 1**: `refactor(settings): update AppView type and add failing settings tests` — types.ts, SettingsView.test.ts
- **Wave 2**: `feat(settings): add section card sub-components for redesigned settings page` — SettingsSidebar.svelte, Settings*Card.svelte (6 files)
- **Wave 3**: `feat(settings): assemble unified SettingsView with all sections and state management` — SettingsView.svelte, SettingsView.test.ts
- **Wave 4**: `refactor(settings): integrate new SettingsView into App routing and remove old components` — App.svelte, delete SettingsPanel.svelte, GlobalSettingsPanel.svelte, their tests

---

## Success Criteria

### Verification Commands
```bash
pnpm test -- --run                    # Expected: 0 failures
pnpm test -- --run src/components/SettingsView.test.ts  # Expected: all pass
```

### Final Checklist
- [ ] All "Must Have" present
- [ ] All "Must NOT Have" absent
- [ ] All tests pass
- [ ] Old components deleted
- [ ] Settings page renders with unified layout
- [ ] Project + global settings merged into one view
