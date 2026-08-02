# Cleanup Task Destination: OpenForge backlog or GitHub Issues

**Date:** 2026-08-02
**Status:** Approved design

## Problem

OpenForge has a **Code Cleanup Tasks** feature (`code_cleanup_tasks_enabled`, a hierarchical
global → project → task toggle). When on, it injects a prompt block into the coding agent's
start prompt telling the agent: while you work, if you spot code that needs cleanup, file it as
a new task via `openforge task create … --label cleanup`. Those land as `backlog` tasks in
OpenForge.

For users who track their backlog on **GitHub Issues**, this creates a second, competing source
of truth. The feature is valuable, but everything it produces has to be manually mirrored into
GitHub.

## Goal

Keep the on/off toggle. When it is on, let the user choose **where** cleanup items are filed:
the **OpenForge backlog** (today's behavior) or **GitHub Issues**. The choice is made per
project (with a global default), and picking GitHub Issues is only allowed once the required
plumbing is verified, so we prevent failures instead of discovering them later.

## Non-goals (deliberately out of scope)

- Pulling *existing* GitHub issues back into OpenForge, or any two-way sync.
- Closing / updating / reconciling issues after creation.
- A per-**task** destination override (destination is global + project only).
- Changing the injected cleanup prompt or the `openforge task create` agent contract.

## Decisions (from brainstorming)

1. **Scope:** per-project — a global default that each project can override. Follows the
   existing settings hierarchy.
2. **Target repo:** the project's own git remote (the same repo the PR-review integration
   already resolves). No separate "issues repo" configuration.
3. **Mechanism:** backend routing (Approach A). The agent command is unchanged; the local
   OpenForge server files the issue itself using the existing `github_token` and
   `github_client`.
4. **Pre-flight validation:** when the user selects GitHub Issues, verify the plumbing before
   accepting the choice; if it can't be verified, revert the selection and explain why.
5. **Runtime failure handling:** if issue creation still fails at file-time (token revoked,
   transient outage, repo renamed), fail loudly **and** create the OpenForge backlog task as a
   safety net, so a cleanup note is never lost.

## Design

### 1. Settings / data model

Add one new hierarchical setting alongside the existing toggle (in
`src/lib/hierarchicalSettings.ts`):

```ts
{
  key: 'code_cleanup_destination',
  label: 'Cleanup Destination',
  description: 'Where cleanup items are filed when Code Cleanup Tasks is on',
  control: 'select',
  levels: ['global', 'project'],
  default: 'openforge',
  options: [
    { value: 'openforge', label: 'OpenForge backlog' },
    { value: 'github_issues', label: 'GitHub Issues' },
  ],
  showWhen: { key: 'code_cleanup_tasks_enabled', equals: 'true' }, // new, see §2
}
```

- `code_cleanup_tasks_enabled` is unchanged.
- **Backward compatible:** any existing user with cleanup on resolves to `openforge`, i.e.
  today's behavior.
- **Persistence:** reuses the existing `config` / `project_config` key–value tables and the
  `getConfig` / `setConfig` / `getProjectConfig` / `setProjectConfig` IPC wrappers. No SQLite
  schema change or migration.
- Wire the new key through the frontend settings plumbing that already exists for the other
  hierarchical keys: `settingsConfig.ts` (`GlobalSettingsConfig` field + load/default),
  `settingsSaver.ts` (save payload + `setConfig`), and `settings_reset.rs` (so the project-level
  "Default to global settings" reset clears it). `computeEffectiveProjectSettings` already
  resolves any non-plugin key generically (project override ?? global ?? default), so it needs
  no change.

### 2. UI

The destination select renders through the **existing generic `HierarchicalSettingsCard`**
(`src/components/settings/HierarchicalSettingsCard.svelte`) — the same code path `ai_provider`
already uses for a `select` control. No new markup.

One small generic enhancement to support "only show the destination when cleanup is on":

- Extend `HierarchicalSettingDef` with an optional `showWhen?: { key: string; equals: string }`.
- In the card's `visibleSettings` derivation, additionally filter out any setting whose
  `showWhen` predicate does not match the current level's effective `values`.
- Extract the predicate as a plain function (e.g. `isSettingVisible(def, values)`) so it is
  unit-testable without touching the DOM.

This matches the user's framing: enabling the toggle reveals the destination choice.

*Optional polish (nice-to-have, not required for correctness):* a one-line hint under the select
when `github_issues` is chosen but no `github_token` is configured, pointing to Credentials.

### 2b. Pre-flight validation when GitHub Issues is selected

To prevent failures up front, validate readiness the moment the user picks `github_issues`,
before persisting the choice.

- New IPC command + Rust handler: `checkGithubIssuesReady(projectId: string | null)` →
  `{ ready: boolean, reason: string | null }`.
- **Global level** (`projectId === null`): there is no concrete project/remote to resolve, so
  validate only that a `github_token` is configured. (Global is the inherited default; each
  project re-validates its own remote when it adopts the value.)
- **Project level** (`projectId` given): validate that
  1. a `github_token` is configured,
  2. the project's git remote resolves to an `owner/repo` (reuse the existing `repo_resolution`
     used by PR-review), and
  3. the token can access that repo (reuse the existing `check_repo_access` in
     `github_client`).
- **On failure:** revert the select back to its previous value and show the returned `reason`
  inline (e.g. "No GitHub token — add one in Credentials", "Couldn't resolve a GitHub repo from
  this project's remote", or "The configured token can't access `owner/repo`"). Do **not**
  persist the change.
- **On success:** persist via the normal `setConfig` / `setProjectConfig` path.

Because step 3 makes a network call, the check runs only on user action (selecting the option),
not on every render. If the check itself cannot complete (e.g. network error), treat it as
not-ready and surface that as the reason — consistent with "prevent failures".

### 3. Backend routing (Approach A)

The agent's command is **unchanged** — it still runs
`openforge task create … --label cleanup`. Routing lives entirely in the create-task HTTP
handler (`src-tauri/src/http_server/legacy_transport/task_routes.rs`, `create_task_handler`),
which already receives `request.labels` and resolves the `project_id`.

New logic:

- Resolve the destination for the task's project:
  `resolve_cleanup_destination(project_id)` → `project_config ?? global config ?? "openforge"`
  (a string resolver mirroring the existing `resolve_ai_provider_for_task`).
- A pure decision helper `decide_cleanup_route(labels, destination)` returns
  `Backlog` or `GithubIssue`:
  - `GithubIssue` when the request labels contain `cleanup` **and** destination is
    `github_issues`.
  - `Backlog` otherwise (all existing behavior, unchanged).
- On `GithubIssue`: file the issue (§4) and return **without** inserting a backlog task.
- On `Backlog`: current behavior.

**Concurrency note:** the handler holds a `std::sync::Mutex` guard on the DB
(`state.db.lock()`). Resolve the destination and gather what the GitHub call needs (repo, token),
then `drop` the guard **before** `await`-ing the async GitHub request. The existing code already
`drop`s the guard before emitting events, so this fits the current structure.

Routing on the `cleanup` label (already emitted by the injected prompt) keeps the agent contract
literally untouched — no CLI flag, no prompt change. Semantically it reads as "in this project,
cleanup-labeled items are tracked on GitHub," which is the intended behavior regardless of who
triggered the creation.

### 4. GitHub issue creation

New module `src-tauri/src/github_client/issues.rs` with:

```rust
create_issue(owner, repo, title, body, labels) -> Result<Issue, GithubError>
```

- `POST /repos/{owner}/{repo}/issues`, reusing the existing `reqwest` client, `github_token`
  auth header builder, and `github_client` error types.
- Repo `owner/repo` derived from the project's git remote via the existing `repo_resolution`
  (same source PR-review uses).
- **Content mapping:**
  - **Title:** first line of the cleanup `initial_prompt`, truncated to a sane length.
  - **Body:** the full `initial_prompt`, plus a footer line referencing the originating task id
    (from the agent's `--depends-on {task_id}`). A GitHub issue can't hold an OpenForge
    dependency, so the relationship is captured as text rather than a real `depends_on` edge.
  - **Labels:** apply `cleanup`. Best-effort — ensure the label exists (create it if missing) so
    a missing label never fails issue creation.
- On success the handler returns the created issue URL/number instead of a task id.

### 5. Runtime failure handling

Pre-flight validation (§2b) prevents the common misconfigurations, but state can change after
selection (token revoked, repo renamed, transient GitHub outage). If `create_issue` fails at
file-time:

- Still create the **OpenForge backlog task** as a safety net (nothing is lost), and
- Return an error/warning in the create-task response.
- The CLI (`src-tauri/src/openforge-cli/cli.js`) prints the warning to stderr and exits
  non-zero so the failure is visible, while stdout still reports the created backlog task.

The create-task response shape gains optional fields to carry either outcome, e.g.
`{ status, task_id?, project_id?, issue_url?, warning? }`, and `cli.js` prints accordingly.

### 6. Testing (TDD)

Business logic only — no assertions on CSS/Tailwind/DOM styling.

**Rust:**
- `resolve_cleanup_destination` hierarchy: project override > global > default (`openforge`).
- `decide_cleanup_route(labels, destination)` truth table:
  - `["cleanup"]` + `github_issues` → `GithubIssue`
  - `["cleanup"]` + `openforge` → `Backlog`
  - `[]` + `github_issues` → `Backlog`
  - non-cleanup labels + `github_issues` → `Backlog`
- Issue payload builder (title/body/label mapping from `initial_prompt` + originating task id)
  as a pure function — no network.
- Failure path: when the GitHub call errors, a backlog task is still created and a warning is
  returned (inject a failing GitHub client / seam).
- `checkGithubIssuesReady` logic: missing token → not ready; global vs project branching
  (repo-resolution only required at project level).

**Frontend:**
- `computeEffectiveProjectSettings` resolves `code_cleanup_destination` (project > global >
  default).
- `isSettingVisible` predicate: destination hidden when cleanup is off, shown when on.
- settings save/load round-trip for the new key (`settingsConfig` / `settingsSaver`).
- Selection flow: a failed `checkGithubIssuesReady` reverts the value and does not persist;
  a successful check persists (logic-level test around the handler, not the rendered select).

## Affected files (indicative, for planning)

- `src/lib/hierarchicalSettings.ts` — new setting def + `showWhen` field + visibility predicate.
- `src/components/settings/HierarchicalSettingsCard.svelte` — honor `showWhen`.
- `src/components/settings/SettingsView.svelte` — selection flow + pre-flight validation hook +
  inline reason display.
- `src/lib/settingsConfig.ts`, `src/lib/settingsSaver.ts` — new key load/save.
- `src/lib/ipc.ts` — `checkGithubIssuesReady` wrapper.
- `src-tauri/src/db/task_config.rs` (or sibling) — `resolve_cleanup_destination`.
- `src-tauri/src/db/settings_reset.rs` — include the new key.
- `src-tauri/src/http_server/legacy_transport/task_routes.rs` — routing + response fields.
- `src-tauri/src/http_server/legacy_transport/models.rs` — response struct fields.
- `src-tauri/src/github_client/issues.rs` (new) + `github_client/mod.rs` — `create_issue`,
  `ensure_label`; reuse `check_repo_access` / `repo_resolution`.
- `src-tauri/src/openforge-cli/cli.js` — print issue URL / warning, exit code.
- New Tauri command wiring for `check_github_issues_ready`.
