# Create New GitHub Repo + Add-Project Dialog Restructure — Design

**Date:** 2026-07-07
**Status:** Approved (design), going straight to plan + implementation
**Task:** AVIV-172
**Builds on:** `2026-07-06-add-project-from-github-design.md` (clone-existing-repo flow)

## Problem

Two related goals:

1. **New capability:** let a user start a brand-new project in one step — give it a name,
   choose where their repos live, and OpenForge creates the repository on GitHub, clones
   it, and opens the project. Today the only ways to add a project are "connect an existing
   local folder" or "clone an existing GitHub repo by URL."

2. **UX clarity:** the add-project dialog now has two plain text tabs ("Local folder | From
   GitHub", `ProjectSetupDialog.svelte:135-150`) which read as ambiguous. With a third option
   arriving, the dialog must make the three distinct ways to start a project visually obvious.

## Feasibility summary

Low-risk, high-reuse. The clone/collision/project-creation machinery already exists from the
clone-existing-repo feature. The genuinely new backend surface is one GitHub API call
(`POST /user/repos`) plus a thin orchestrator; the rest is shared with the existing flow. No
DB schema change.

| Need | Existing anchor |
|------|-----------------|
| Authenticated GitHub POST | `github_client/issues.rs::create_issue` uses `send_github(github_request(POST,url,token).json(&body))` + `api_error_from_response`. |
| Clone + resolve target + collision guard + rollback | `git_clone.rs` (`clone_repo`, `resolve_target_path`, `check_target_available`, `cleanup_partial_clone`) + per-target `git_worktree::acquire_lock`. |
| Create project + open it | `db.create_project` + the dialog's `onProjectCreated`. |
| Stored PAT + user | `github_runtime::github_token()`. |
| Commit-less repo handling | Already graceful: `worktreeAvailability.ts:19` disables worktrees when `!hasCommits`; `AddTaskDialog.svelte:625` shows "No commits yet — worktrees need an initial commit. This task will run in the project directory." A freshly-created empty repo lands in this already-supported state. |

## Data model

No new tables/columns. One new **global config key** `default_repositories_dir` (via the
existing `config` table / `get_config`/`set_config`) to remember where the user keeps repos,
so the parent-folder field prefills across the clone and new-repo flows.

## Part 1 — Dialog restructure (three option cards)

Replace the two-tab toggle in `ProjectSetupDialog.svelte` with a **three-card selector**
(a `radiogroup`). Each card has an icon, a title, and a one-line description; the selected
card gets `ring-2 ring-primary rounded` (the repo's standard focus style). The selected
option's fields render below the cards.

```
 How do you want to start?

 ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐
 │  New repo        │ │  From GitHub     │ │  Local folder    │
 │  Create it on    │ │  Clone an        │ │  Use a repo      │
 │  GitHub & clone  │ │  existing repo   │ │  already on      │
 │  it              │ │  by URL          │ │  your disk       │
 └─────────────────┘ └─────────────────┘ └─────────────────┘
```

- **Mode state:** `mode: 'newRepo' | 'github' | 'local'`.
- **Order:** New repo · From GitHub · Local folder. **Default selection:** `local` (preserves
  today's behavior).
- **Cards** are `role="radio"` inside a `role="radiogroup"`, keyboard-selectable, with
  `aria-checked`. Icons come from the existing icon set already used in the app.
- The intro `<p>` becomes mode-aware for all three modes.
- The submit button label reflects the mode ("Create Project" / "Cloning…" / "Creating repo…").

## Part 2 — "New GitHub repo" feature

### Flow
Select **New repo** → type a name → parent folder (prefilled from `default_repositories_dir`)
→ Private toggle → **Create** → OpenForge creates the repo on GitHub (empty, no auto-init),
clones it, creates the project, and opens it. The user makes the first commit themselves.

### Frontend
- New GitHub-mode fields: **Name** (required), **Parent folder** picker (reuses
  `selectDirectory`, prefilled from config), **Private** toggle (default on), and a target-path
  preview (`computeTargetPathPreview(parentDir, name)` — approximate, since GitHub may normalize
  the name; the authoritative folder is the repo name returned by the API).
- New IPC wrapper `createProjectFromNewRepo({ name, parentDir, private }): Promise<Project>` in
  `src/lib/ipc.ts`.
- New pure helper `canSubmitNewRepo({ name, parentDir, isSubmitting })` in
  `projectSetupDialogLogic.ts`; `handleSubmit` gains a third branch calling the new wrapper.
- On a successful create in the `newRepo` or `github` mode, persist the chosen parent folder to
  `default_repositories_dir`; read it on dialog mount to prefill.

### Backend
- **New types** (`github_client/types.rs`): `CreateRepoRequest { name, private, auto_init: false }`
  and `CreatedRepo { clone_url, ssh_url, full_name, html_url }` (deserialized from the API).
- **New client method** `github_client::create_repo(name, private, token) -> Result<CreatedRepo, GitHubError>`
  → `POST https://api.github.com/user/repos`, modeled exactly on `create_issue`
  (`send_github` + `api_error_from_response` + `json`). `auto_init` is always `false`.
- **Shared helper** — extract the common tail of `create_project_from_git` into
  `clone_into_new_project(db, parsed: &ParsedRepo, parent_dir, token: Option<&str>, name) -> Result<ProjectRow, String>`:
  resolve target → acquire per-target lock → collision check → `clone_repo` → `create_project`
  → rollback on insert failure. `create_project_from_git` is refactored to call it after its
  parse + access pre-check.
- **New orchestrator** `create_project_from_new_repo(db, github_client, name, parent_dir, private) -> Result<ProjectRow, String>`:
  1. Require a stored PAT (`github_token()`); if absent, return a clear "connect a GitHub token
     with `repo` scope in Settings" error before any work.
  2. `create_repo(name, private, token)` → `CreatedRepo`.
  3. `parse_repo_url(&created.clone_url)` → `ParsedRepo` (yields the GitHub-assigned repo name).
  4. `clone_into_new_project(db, &parsed, parent_dir, Some(token), name)` — project name is the
     user's typed name; the folder is the repo's real (possibly GitHub-normalized) name.
- **Command arm** `create_project_from_new_repo` in `app_invoke::core::handle_app_core_task_project_command`
  (the deadlock-safe handler — NOT `handle_app_unmatched_command`, which holds a function-wide DB
  lock). Reads `name`, `parentDir`, `private` (via `payload_string`/`payload_bool`).
- Add `create_project_from_new_repo` to `SIDECAR_BACKED_COMMANDS` in `backendBridge.ts`.

## Error handling

- **PAT missing / insufficient scope:** creating a repo needs `repo` (or `public_repo`) scope.
  No token → the pre-check error above. GitHub 403/404 on create → surface a friendly "your
  GitHub token can't create repositories — check its scopes" message (via `api_error_from_response`).
- **Name already taken:** `POST /user/repos` returns 422 → surfaced as a clear error.
- **Empty repo is fine:** an empty clone succeeds; the commit-less state is already handled by
  the task/worktree flow (see Feasibility). No special handling needed.
- **Orphan-on-failure:** if the repo is created but a later step (clone/insert) fails, OpenForge
  does **not** auto-delete the GitHub repo (deletion is destructive). It reports "repo created on
  GitHub, but the local step failed — retry or remove it" so nothing is silently destroyed.
- The PAT security invariant from the prior feature is preserved (never written to disk; only an
  ephemeral clone header + API Authorization header).

## Testing (business logic only — no CSS/styling assertions)

**Rust:**
- `CreateRepoRequest` serializes to `{name, private, auto_init:false}`; `CreatedRepo` deserializes
  `clone_url`/`full_name` from a sample API JSON body.
- `clone_into_new_project` rejects an already-existing target (temp dir + in-memory DB), and both
  `create_project_from_git` and the new orchestrator route through it (no behavior regression on
  the existing flow's tests).
- Do NOT add keychain/network-dependent tests (would be flaky); the network calls stay in thin,
  untested wrappers as in the prior feature.

**Vitest:**
- `canSubmitNewRepo` gating (name + parentDir required, false while submitting).
- `createProjectFromNewRepo` invokes `create_project_from_new_repo` with the camelCase payload
  (`name`, `parentDir`, `private`).
- Reuse `computeTargetPathPreview` for the new-repo preview (already tested).
- Dialog card selection / three-mode `canSubmit` switching via the extracted helpers.

## Scope / YAGNI

Out of scope for this iteration: org repositories (personal account only), auto-init, license/
gitignore/description templates, repo deletion/rollback on GitHub, and any settings-page UI for
the default repos dir (it's remembered transparently via config). All can be added later without
reworking the core flow.
