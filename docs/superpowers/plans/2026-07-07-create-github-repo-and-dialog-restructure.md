# Create New GitHub Repo + Dialog Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "New GitHub repo" way to start a project (create the repo on GitHub, clone it, open the project) and restructure the add-project dialog so its three options (New repo / From GitHub / Local folder) are visually clear.

**Architecture:** A new `create_repo` GitHub API call (`POST /user/repos`, `auto_init: false`) feeds a new sidecar orchestrator that reuses the existing clone→collision→create-project machinery via an extracted shared helper. The dialog's two text tabs become a three-card selector; a new-repo mode adds a name + parent-folder + Private toggle, with the parent folder remembered in config. No DB schema change.

**Tech Stack:** Rust sidecar (`reqwest`, `tokio`, existing `github_client`/`git_clone`), Svelte 5 renderer (`@lucide/svelte` icons, daisyUI/Tailwind), TypeScript IPC, Electron bridge, Vitest + `cargo test`.

## Global Constraints

- Do NOT disable eslint/TypeScript/clippy/compiler errors — fix them.
- Frontend→backend calls go only through typed wrappers in `src/lib/ipc.ts`.
- IPC payload keys are camelCase (`name`, `parentDir`, `private`), even though Rust reads them via `payload_*`.
- Rust command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`; DB files use `impl super::Database`; GitHub client methods return `Result<T, GitHubError>`.
- Svelte 5 runes only (`$state`, `$derived`, `$effect`, `$props()`); `on`-prefixed callbacks; NEVER the legacy dispatcher. daisyUI/Tailwind semantic classes; NO hardcoded hex colors. Visual focus uses `ring-2 ring-primary rounded`.
- Tests cover business logic only — no assertions on CSS/Tailwind/styling.
- Use TDD: failing test first, verify it fails, implement, verify it passes, commit.
- Rust test filtering (from `src-tauri/`): one filter per `cargo test <filter>`; never after `--`. Equivalent: `cargo test --manifest-path src-tauri/Cargo.toml <filter>`.
- Vitest: `pnpm exec vitest run <path>`; never the `-- <path>` form.
- `create_repo` always sends `auto_init: false` (the user makes the first commit). The PAT is never written to disk.
- The `create_project_from_new_repo` command MUST be handled in `app_invoke::core::handle_app_core_task_project_command` (NOT `handle_app_unmatched_command`, which holds a function-wide `std::sync::Mutex` DB guard and would deadlock the orchestrator's internal `acquire_db`).

---

## File Structure

**Rust (new):** `src-tauri/src/github_client/repos.rs` — repo-creation client method (mirrors `issues.rs`).

**Rust (modified):**
- `src-tauri/src/github_client/mod.rs` — add `mod repos;`.
- `src-tauri/src/github_client/types.rs` — add `CreateRepoRequest`, `CreatedRepo`.
- `src-tauri/src/git_clone.rs` — extract `clone_into_new_project`; refactor `create_project_from_git`; add `create_project_from_new_repo`.
- `src-tauri/src/app_invoke/core.rs` — add the `create_project_from_new_repo` command arm.

**Frontend (modified):**
- `src/lib/ipc.ts` — add `createProjectFromNewRepo`.
- `src/electron/backendBridge.ts` — add `create_project_from_new_repo` to `SIDECAR_BACKED_COMMANDS`.
- `src/components/project/projectSetupDialogLogic.ts` (+ `.test.ts`) — add `canSubmitNewRepo`.
- `src/components/project/ProjectSetupDialog.svelte` — three-card selector + new-repo mode + remembered folder.

---

## Task 1: GitHub client — `create_repo` + request/response types

**Files:**
- Create: `src-tauri/src/github_client/repos.rs`
- Modify: `src-tauri/src/github_client/mod.rs` (add `mod repos;`), `src-tauri/src/github_client/types.rs`
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/github_client/repos.rs`

**Interfaces:**
- Consumes: `self.send_github`, `self.github_request`, `Self::api_error_from_response` (existing private helpers, accessible from this child module — see `issues.rs::create_issue`).
- Produces:
  - `pub(crate) struct CreateRepoRequest { pub name: String, pub private: bool, pub auto_init: bool }`
  - `pub struct CreatedRepo { pub clone_url: String }`
  - `impl GitHubClient { pub async fn create_repo(&self, name: &str, private: bool, token: &str) -> Result<CreatedRepo, GitHubError> }`

- [ ] **Step 1: Add the types**

In `src-tauri/src/github_client/types.rs`, after the `CreateIssueRequest` struct (around line 316), add:

```rust
/// Request body for creating a repository on the authenticated user's account.
#[derive(Debug, Serialize)]
pub(crate) struct CreateRepoRequest {
    pub name: String,
    pub private: bool,
    /// Always false — OpenForge creates an empty repo and the user makes the
    /// first commit; an auto-init README is never injected.
    pub auto_init: bool,
}

/// Subset of the GitHub repo object we need from a create response.
#[derive(Debug, Deserialize)]
pub struct CreatedRepo {
    pub clone_url: String,
}
```

(`Serialize`/`Deserialize` are already imported in this file.)

- [ ] **Step 2: Register the module**

In `src-tauri/src/github_client/mod.rs`, add to the module declarations near the top (with `mod issues;` etc.):

```rust
mod repos;
```

- [ ] **Step 3: Write the failing tests**

Create `src-tauri/src/github_client/repos.rs` with only the impl-less test module so it fails on the missing symbols:

```rust
#[cfg(test)]
mod tests {
    use crate::github_client::types::{CreateRepoRequest, CreatedRepo};

    #[test]
    fn create_repo_request_serializes_with_auto_init_false() {
        let body = CreateRepoRequest {
            name: "my-idea".to_string(),
            private: true,
            auto_init: false,
        };
        let json = serde_json::to_value(&body).unwrap();
        assert_eq!(json["name"], "my-idea");
        assert_eq!(json["private"], true);
        assert_eq!(json["auto_init"], false);
    }

    #[test]
    fn created_repo_deserializes_clone_url_ignoring_extra_fields() {
        let sample = serde_json::json!({
            "clone_url": "https://github.com/octocat/my-idea.git",
            "full_name": "octocat/my-idea",
            "ssh_url": "git@github.com:octocat/my-idea.git"
        });
        let created: CreatedRepo = serde_json::from_value(sample).unwrap();
        assert_eq!(created.clone_url, "https://github.com/octocat/my-idea.git");
    }
}
```

- [ ] **Step 4: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test create_repo_request_serializes` then `cargo test created_repo_deserializes`
Expected: FAIL — the types don't exist yet / module empty. (If Step 1 already added the types, the failure is instead a missing `create_repo` method once Step 5's method is referenced; either way confirm RED before Step 5.)

- [ ] **Step 5: Write the `create_repo` method**

Prepend to `src-tauri/src/github_client/repos.rs` (above the test module):

```rust
//! GitHub repository creation.
//!
//! REST-only. Reuses the shared client's token, request, and error handling via
//! [`GitHubClient`], mirroring `issues.rs`.

use super::error::GitHubError;
use super::types::{CreateRepoRequest, CreatedRepo};
use super::GitHubClient;

impl GitHubClient {
    /// Create a new repository on the authenticated user's account.
    /// `auto_init` is always false — the repo is created empty.
    pub async fn create_repo(
        &self,
        name: &str,
        private: bool,
        token: &str,
    ) -> Result<CreatedRepo, GitHubError> {
        let url = "https://api.github.com/user/repos";

        let request_body = CreateRepoRequest {
            name: name.to_string(),
            private,
            auto_init: false,
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, url, token)
                    .json(&request_body),
            )
            .await?;

        if !response.status().is_success() {
            return Err(Self::api_error_from_response(response).await);
        }

        response
            .json()
            .await
            .map_err(|e| GitHubError::ParseError(e.to_string()))
    }
}
```

- [ ] **Step 6: Run tests + build**

Run (from `src-tauri/`): `cargo test create_repo_request_serializes`, then `cargo test created_repo_deserializes`
Expected: PASS (both).
Run: `cargo build --manifest-path Cargo.toml` (from `src-tauri/`) or `cargo build` from `src-tauri/`
Expected: builds clean (confirms `create_repo` compiles).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/github_client/repos.rs src-tauri/src/github_client/mod.rs src-tauri/src/github_client/types.rs
git commit -m "feat: add GitHub create_repo client method"
```

---

## Task 2: Sidecar — shared clone helper, new-repo orchestrator, command arm

**Files:**
- Modify: `src-tauri/src/git_clone.rs`, `src-tauri/src/app_invoke/core.rs`
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/git_clone.rs`

**Interfaces:**
- Consumes: `parse_repo_url`, `resolve_target_path`, `check_target_available`, `clone_repo`, `cleanup_partial_clone`, `ParsedRepo` (all in `git_clone.rs`); `crate::git_worktree::acquire_lock`; `crate::db::acquire_db`; `Database::create_project`; `crate::github_runtime::github_token`; `crate::github_client::GitHubClient::{create_repo, check_repo_access}`; `payload_string`/`payload_bool`/`json_value`/`StatusCode` (in scope in `core.rs`).
- Produces:
  - `async fn clone_into_new_project(db: &Arc<Mutex<crate::db::Database>>, parsed: &ParsedRepo, parent_dir: &str, token: Option<&str>, name: &str) -> Result<crate::db::ProjectRow, String>` (private helper)
  - `pub async fn create_project_from_new_repo(db: &Arc<Mutex<crate::db::Database>>, github_client: &crate::github_client::GitHubClient, name: &str, parent_dir: &str, private: bool) -> Result<crate::db::ProjectRow, String>`

- [ ] **Step 1: Write the failing test for the shared helper**

Add to the `tests` module in `src-tauri/src/git_clone.rs`:

```rust
    #[tokio::test]
    async fn clone_into_new_project_rejects_existing_target() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_into_existing_target");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));
        let parent = tempdir().unwrap();
        std::fs::create_dir(parent.path().join("widgets")).unwrap();

        let parsed = ParsedRepo {
            owner: "acme".to_string(),
            repo: "widgets".to_string(),
            clone_url: "https://github.com/acme/widgets.git".to_string(),
            is_ssh: false,
        };
        let result = clone_into_new_project(
            &db,
            &parsed,
            &parent.path().to_string_lossy(),
            None,
            "Widgets",
        )
        .await;

        assert!(result.is_err(), "existing target dir must be rejected");
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test clone_into_new_project_rejects_existing_target`
Expected: FAIL — `cannot find function clone_into_new_project`.

- [ ] **Step 3: Extract the shared helper and refactor `create_project_from_git`**

In `src-tauri/src/git_clone.rs`, replace the entire current `create_project_from_git` function (the block starting `pub async fn create_project_from_git(` through its closing `}`) with the following TWO items:

```rust
/// Shared tail for both add-from-git flows: resolve the destination, serialize
/// on it, guard against collisions, clone, register the project, and roll back a
/// partial clone if the DB insert fails.
async fn clone_into_new_project(
    db: &Arc<Mutex<crate::db::Database>>,
    parsed: &ParsedRepo,
    parent_dir: &str,
    token: Option<&str>,
    name: &str,
) -> Result<crate::db::ProjectRow, String> {
    let target = resolve_target_path(Path::new(parent_dir), &parsed.repo)?;

    // Serialize concurrent clones to the same destination.
    let lock = crate::git_worktree::acquire_lock(&target);
    let _guard = lock.lock().await;

    // Collision guard — release the DB lock before any network/subprocess work.
    {
        let db = crate::db::acquire_db(db);
        check_target_available(&target, &db)?;
    }

    clone_repo(parsed, &target, token).await?;

    let project = {
        let db = crate::db::acquire_db(db);
        db.create_project(name, &target.to_string_lossy())
            .map_err(|e| {
                // The row failed to insert after a successful clone — roll back the
                // on-disk clone so the destination is free for a retry.
                cleanup_partial_clone(&target);
                format!("Failed to create project: {e}")
            })?
    };
    Ok(project)
}

/// End-to-end (clone an existing repo): parse the URL, optionally pre-check
/// access with the stored PAT, then clone + register via the shared helper.
pub async fn create_project_from_git(
    db: &Arc<Mutex<crate::db::Database>>,
    github_client: &crate::github_client::GitHubClient,
    url: &str,
    parent_dir: &str,
    name: &str,
) -> Result<crate::db::ProjectRow, String> {
    let parsed = parse_repo_url(url)?;

    // Access pre-check only when a PAT is stored; tolerate inconclusive results.
    let token = crate::github_runtime::github_token().ok();
    if let Some(token) = token.as_deref() {
        match github_client
            .check_repo_access(&parsed.owner, &parsed.repo, token)
            .await
        {
            Ok(true) => {}
            Ok(false) => {
                return Err(format!(
                    "Repository {}/{} was not found or you don't have access to it.",
                    parsed.owner, parsed.repo
                ));
            }
            Err(err) => {
                log::warn!("GitHub access pre-check failed, proceeding to clone: {err}");
            }
        }
    }

    clone_into_new_project(db, &parsed, parent_dir, token.as_deref(), name).await
}

/// End-to-end (create a new repo): create an empty repository on the user's
/// GitHub account, then clone + register via the shared helper. The project name
/// is the user's typed `name`; the on-disk folder is the repo's real name from
/// the clone URL GitHub returns.
pub async fn create_project_from_new_repo(
    db: &Arc<Mutex<crate::db::Database>>,
    github_client: &crate::github_client::GitHubClient,
    name: &str,
    parent_dir: &str,
    private: bool,
) -> Result<crate::db::ProjectRow, String> {
    let token = crate::github_runtime::github_token().map_err(|_| {
        "Connect a GitHub token with 'repo' scope in Settings to create repositories."
            .to_string()
    })?;

    let created = github_client
        .create_repo(name, private, &token)
        .await
        .map_err(|e| format!("Failed to create GitHub repository: {e}"))?;

    let parsed = parse_repo_url(&created.clone_url)?;
    clone_into_new_project(db, &parsed, parent_dir, Some(&token), name).await
}
```

> Note: the previously-existing `create_project_from_git_rejects_existing_target_before_cloning` test still passes — it now exercises the refactored path (with no stored token in tests, the access pre-check is skipped and the collision guard inside `clone_into_new_project` fires).

- [ ] **Step 4: Run tests to verify they pass**

Run (from `src-tauri/`): `cargo test clone_into_new_project_rejects_existing_target`
Expected: PASS.
Run: `cargo test create_project_from_git_rejects_existing_target`
Expected: PASS (regression check on the refactored existing flow).

- [ ] **Step 5: Add the command arm**

In `src-tauri/src/app_invoke/core.rs`, inside `handle_app_core_task_project_command`, add a new arm immediately after the existing `"create_project_from_git" => { … }` arm (before `_ => return Ok(None),`):

```rust
        "create_project_from_new_repo" => {
            let name = payload_string(&request.payload, "name")?;
            let parent_dir = payload_string(&request.payload, "parentDir")?;
            let private = payload_bool(&request.payload, "private")?;
            let project = crate::git_clone::create_project_from_new_repo(
                &state.db,
                &state.github_client,
                &name,
                &parent_dir,
                private,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(project)?
        }
```

(Do NOT add it to `handle_app_unmatched_command`.)

- [ ] **Step 6: Build**

Run (from `src-tauri/`): `cargo build`
Expected: builds clean, no new warnings in changed files.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git_clone.rs src-tauri/src/app_invoke/core.rs
git commit -m "feat: add create_project_from_new_repo orchestrator and command"
```

---

## Task 3: Frontend seam — IPC wrapper, allowlist, submit-gating helper

**Files:**
- Modify: `src/lib/ipc.ts`, `src/electron/backendBridge.ts`, `src/components/project/projectSetupDialogLogic.ts`
- Test: `src/lib/ipc.createProjectFromNewRepo.test.ts` (new), `src/components/project/projectSetupDialogLogic.test.ts` (extend)

**Interfaces:**
- Consumes: `invoke` (the imported `invokeDesktopCommand`) in `ipc.ts`.
- Produces:
  - `createProjectFromNewRepo(args: { name: string; parentDir: string; private: boolean }): Promise<Project>`
  - `canSubmitNewRepo(args: { name: string; parentDir: string; isSubmitting: boolean }): boolean`

- [ ] **Step 1: Write the failing helper test**

Add to `src/components/project/projectSetupDialogLogic.test.ts`:

```ts
import { computeTargetPathPreview, canSubmitGithub, canSubmitNewRepo } from './projectSetupDialogLogic'

describe('canSubmitNewRepo', () => {
  it('is true when name + parent are set and not submitting', () => {
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '/repos', isSubmitting: false })).toBe(true)
  })
  it('is false while submitting', () => {
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '/repos', isSubmitting: true })).toBe(false)
  })
  it('is false when name or parent is missing', () => {
    expect(canSubmitNewRepo({ name: '', parentDir: '/repos', isSubmitting: false })).toBe(false)
    expect(canSubmitNewRepo({ name: 'my-idea', parentDir: '', isSubmitting: false })).toBe(false)
  })
})
```

(Merge the `import` line with the existing import from `./projectSetupDialogLogic` at the top of the file rather than duplicating it.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: FAIL — `canSubmitNewRepo` is not exported.

- [ ] **Step 3: Add `canSubmitNewRepo`**

Append to `src/components/project/projectSetupDialogLogic.ts`:

```ts
/** Submit gating for the "New GitHub repo" mode. */
export function canSubmitNewRepo(args: {
  name: string
  parentDir: string
  isSubmitting: boolean
}): boolean {
  return (
    !args.isSubmitting &&
    args.name.trim().length > 0 &&
    args.parentDir.trim().length > 0
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing IPC wrapper test**

Create `src/lib/ipc.createProjectFromNewRepo.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invoke(...args),
  isElectronDesktopBridgeAvailable: () => true,
}))

import { createProjectFromNewRepo } from './ipc'

describe('createProjectFromNewRepo', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes create_project_from_new_repo with a camelCase payload', async () => {
    invoke.mockResolvedValue({ id: 'P-1', name: 'My Idea', path: '/repos/my-idea', created_at: 1, updated_at: 1 })
    const project = await createProjectFromNewRepo({ name: 'My Idea', parentDir: '/repos', private: true })
    expect(invoke).toHaveBeenCalledWith('create_project_from_new_repo', {
      name: 'My Idea',
      parentDir: '/repos',
      private: true,
    })
    expect(project.id).toBe('P-1')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/ipc.createProjectFromNewRepo.test.ts`
Expected: FAIL — `createProjectFromNewRepo` is not exported.

- [ ] **Step 7: Add the IPC wrapper**

In `src/lib/ipc.ts`, immediately after the existing `createProjectFromGit` wrapper, add:

```ts
export async function createProjectFromNewRepo(args: {
  name: string
  parentDir: string
  private: boolean
}): Promise<Project> {
  return invoke<Project>("create_project_from_new_repo", args);
}
```

- [ ] **Step 8: Add the command to the Electron allowlist**

In `src/electron/backendBridge.ts`, add `'create_project_from_new_repo',` to `SIDECAR_BACKED_COMMANDS` immediately after `'create_project_from_git',`:

```ts
  'create_project_from_git',
  'create_project_from_new_repo',
```

- [ ] **Step 9: Run both frontend tests to verify they pass**

Run: `pnpm exec vitest run src/lib/ipc.createProjectFromNewRepo.test.ts src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS (all).

- [ ] **Step 10: Commit**

```bash
git add src/lib/ipc.ts src/lib/ipc.createProjectFromNewRepo.test.ts src/electron/backendBridge.ts src/components/project/projectSetupDialogLogic.ts src/components/project/projectSetupDialogLogic.test.ts
git commit -m "feat: add createProjectFromNewRepo IPC wrapper and submit gating"
```

---

## Task 4: Dialog — three-card selector + New-repo mode + remembered folder

**Files:**
- Modify: `src/components/project/ProjectSetupDialog.svelte`

**Interfaces:**
- Consumes: `createProject`, `createProjectFromGit`, `createProjectFromNewRepo`, `selectDirectory`, `getConfig`, `setConfig` (from `src/lib/ipc.ts`); `deriveRepoNameFromUrl`; `computeTargetPathPreview`, `canSubmitGithub`, `canSubmitNewRepo`; `Sparkles`, `GitBranch`, `FolderOpen` from `@lucide/svelte`; `onMount` from `svelte`.

This task restructures the dialog. The testable business logic (`canSubmitNewRepo`, `computeTargetPathPreview`) is already covered by Task 3 and the existing logic tests; this task is Svelte wiring on those tested helpers, verified by the existing logic suite + build + Svelte-5 self-review. Do NOT add CSS/markup assertions.

- [ ] **Step 1: Update imports and state**

In `src/components/project/ProjectSetupDialog.svelte`, update the top `<script>` imports:

```ts
  import { onMount, tick } from 'svelte'
  import type { Project } from '../../lib/types'
  import { createProject, createProjectFromGit, createProjectFromNewRepo, selectDirectory, getConfig, setConfig } from '../../lib/ipc'
  import { deriveProjectNameFromPath } from '../../lib/deriveProjectName'
  import { deriveRepoNameFromUrl } from '../../lib/deriveRepoNameFromUrl'
  import { computeTargetPathPreview, canSubmitGithub, canSubmitNewRepo } from './projectSetupDialogLogic'
  import { Sparkles, GitBranch, FolderOpen } from '@lucide/svelte'
  import Modal from '../shared/ui/Modal.svelte'
```

(If any icon name is not exported by the installed `@lucide/svelte`, substitute the nearest existing non-brand icon and note it — do not add a brand/deprecated icon.)

Replace the mode state line `let mode = $state<'local' | 'github'>('local')` with:

```ts
  const DEFAULT_REPOS_DIR_KEY = 'default_repositories_dir'

  let mode = $state<'newRepo' | 'github' | 'local'>('local')
  let repoUrl = $state('')
  let parentDir = $state('')
  let repoPrivate = $state(true)
```

(Keep the existing `projectName`, `path`, `nameManuallyEdited`, `isSubmitting`, `createError`, `successMessage`, `creationFeedbackId` declarations.)

- [ ] **Step 2: Update derived gating + previews**

Replace the three `canSubmit*` derived lines with:

```ts
  let githubTargetPreview = $derived(computeTargetPathPreview(parentDir, deriveRepoNameFromUrl(repoUrl)))
  let newRepoTargetPreview = $derived(computeTargetPathPreview(parentDir, projectName))

  let canSubmitLocal = $derived(!isSubmitting && path.trim().length > 0 && projectName.trim().length > 0)
  let canSubmitGithubMode = $derived(canSubmitGithub({ repoUrl, parentDir, projectName, isSubmitting }))
  let canSubmitNewRepoMode = $derived(canSubmitNewRepo({ name: projectName, parentDir, isSubmitting }))
  let canSubmit = $derived(
    mode === 'local' ? canSubmitLocal : mode === 'github' ? canSubmitGithubMode : canSubmitNewRepoMode
  )
```

(Remove the old `targetPathPreview` derived; it is replaced by the two mode-specific previews above.)

- [ ] **Step 3: Prefill the remembered repos folder on mount**

Add after the derived declarations:

```ts
  onMount(async () => {
    try {
      const remembered = await getConfig(DEFAULT_REPOS_DIR_KEY)
      if (remembered && !parentDir) parentDir = remembered
    } catch (e) {
      console.error('Failed to load default repositories directory:', e)
    }
  })
```

- [ ] **Step 4: Update `handleSubmit` for three modes + remember the folder**

Replace the body of `handleSubmit` with:

```ts
  async function handleSubmit() {
    createError = null
    successMessage = null

    isSubmitting = true
    try {
      let project: Project
      if (mode === 'local') {
        if (!path.trim() || !projectName.trim()) return
        project = await createProject(projectName.trim(), path.trim())
      } else if (mode === 'github') {
        if (!repoUrl.trim() || !parentDir.trim() || !projectName.trim()) return
        project = await createProjectFromGit({
          url: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: projectName.trim(),
        })
      } else {
        if (!projectName.trim() || !parentDir.trim()) return
        project = await createProjectFromNewRepo({
          name: projectName.trim(),
          parentDir: parentDir.trim(),
          private: repoPrivate,
        })
      }
      // Remember where repos live for next time (clone + new-repo modes).
      if (mode !== 'local' && parentDir.trim()) {
        void setConfig(DEFAULT_REPOS_DIR_KEY, parentDir.trim())
      }
      successMessage = `Project created. Opening ${project.name}.`
      await tick()
      await new Promise((resolve) => window.setTimeout(resolve, 300))
      await onProjectCreated?.(project)
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to create project:', e)
    } finally {
      isSubmitting = false
    }
  }
```

- [ ] **Step 5: Replace the tab bar with the three-card selector**

In the template, replace the entire `<div role="tablist" class="tabs tabs-boxed"> … </div>` block with:

```svelte
    <div role="radiogroup" aria-label="How to add the project" class="grid grid-cols-3 gap-2">
      {#each [
        { id: 'newRepo', icon: Sparkles, title: 'New repo', desc: 'Create it on GitHub & clone it' },
        { id: 'github', icon: GitBranch, title: 'From GitHub', desc: 'Clone an existing repo by URL' },
        { id: 'local', icon: FolderOpen, title: 'Local folder', desc: 'Use a repo already on your disk' },
      ] as option (option.id)}
        {@const Icon = option.icon}
        <button
          type="button"
          role="radio"
          aria-checked={mode === option.id}
          class="flex flex-col items-start gap-1 rounded-lg border border-base-300 p-3 text-left transition hover:bg-base-200 {mode === option.id ? 'ring-2 ring-primary' : ''}"
          onclick={() => { mode = option.id as typeof mode; createError = null }}
          disabled={isSubmitting}
        >
          <Icon class="size-4 text-base-content/70" />
          <span class="text-xs font-semibold text-base-content">{option.title}</span>
          <span class="text-[0.65rem] text-base-content/50 leading-tight">{option.desc}</span>
        </button>
      {/each}
    </div>
```

- [ ] **Step 6: Make the intro copy cover all three modes**

Replace the intro `<p>` `{#if mode === 'github'} … {:else} … {/if}` with:

```svelte
    <p class="text-sm text-base-content/70 m-0">
      {#if mode === 'newRepo'}
        Name a new project and OpenForge will create the repository on GitHub, clone it, and open it. You make the first commit.
      {:else if mode === 'github'}
        Paste a GitHub repository URL and OpenForge will clone it and set up the project.
      {:else}
        Connect a local repository so OpenForge can track tasks and agent handoffs for it.
      {/if}
    </p>
```

- [ ] **Step 7: Add the New-repo fields branch**

Change the fields conditional from `{#if mode === 'local'} … {:else} …(github)… {/if}` to a three-way `{#if mode === 'local'} … {:else if mode === 'github'} … {:else} …(newRepo)… {/if}`. Keep the existing `local` and `github` branches exactly as they are; add this new `{:else}` (newRepo) branch after the github branch:

```svelte
    {:else}
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
        <input
          data-project-name-input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={projectName}
          placeholder="my-idea"
          oninput={handleNameInput}
          autocomplete="off"
          aria-describedby={createError || successMessage ? creationFeedbackId : undefined}
        />
        <span class="text-[0.65rem] text-base-content/40">GitHub normalizes spaces to hyphens; the folder uses the created repo's name.</span>
      </label>

      <div class="flex flex-col gap-1.5">
        <span id="add-project-newrepo-parent-label" class="text-xs text-base-content/60 font-medium">Repositories Folder <span class="text-error" aria-hidden="true">*</span></span>
        <div class="flex items-center gap-2">
          <span class="input input-bordered input-sm w-full flex items-center font-mono text-xs truncate" role="group" aria-labelledby="add-project-newrepo-parent-label" title={parentDir}>{parentDir || 'No folder selected'}</span>
          <button class="btn btn-ghost btn-sm" type="button" onclick={handleSelectParentFolder} disabled={isSubmitting}>Choose</button>
        </div>
      </div>

      <label class="flex items-center gap-2 cursor-pointer">
        <input type="checkbox" class="toggle toggle-sm toggle-primary" bind:checked={repoPrivate} disabled={isSubmitting} />
        <span class="text-xs text-base-content/70">Private repository</span>
      </label>

      {#if newRepoTargetPreview}
        <p class="text-[0.65rem] text-base-content/40 m-0">Will clone into <span class="font-mono">{newRepoTargetPreview}</span></p>
      {/if}
    {/if}
```

Also update the existing github-branch preview to use the renamed `githubTargetPreview` (it previously used `targetPathPreview`): change `{#if targetPathPreview}` / `{targetPathPreview}` in the github branch to `{#if githubTargetPreview}` / `{githubTargetPreview}`.

- [ ] **Step 8: Update the submit-button label for all three modes**

Replace the submit button label expression with:

```svelte
      {isSubmitting ? (mode === 'newRepo' ? 'Creating repo...' : mode === 'github' ? 'Cloning...' : 'Creating...') : 'Create Project'}
```

- [ ] **Step 9: Verify logic tests + build**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.
Run: `pnpm exec tsc --noEmit`
Expected: no errors attributable to the changed files. (If `tsc` aborts on a pre-existing `ignoreDeprecations` tsconfig error unrelated to this change, that is a known local-env artifact — do not modify tsconfig.)

- [ ] **Step 10: Commit**

```bash
git add src/components/project/ProjectSetupDialog.svelte
git commit -m "feat: three-option card selector and New GitHub repo mode in add-project dialog"
```

---

## Task 5: Verification + code review

**Files:** none (verification only)

- [ ] **Step 1: Rust tests + build**

Run (from `src-tauri/`): `cargo test git_clone`
Expected: PASS (includes `clone_into_new_project_rejects_existing_target` and the existing suite).
Run: `cargo test create_repo` then `cargo test created_repo`
Expected: PASS.
Run: `cargo build`
Expected: clean, no new warnings in changed files.

- [ ] **Step 2: Frontend tests + typecheck**

Run: `pnpm exec vitest run src/lib/ipc.createProjectFromNewRepo.test.ts src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.
Run: `pnpm exec tsc --noEmit`
Expected: no errors attributable to the changed files.

- [ ] **Step 3: Code review**

Run a whole-branch review (superpowers:requesting-code-review or a code-review agent). Resolve any Critical/Important findings. Focus:
- The PAT is never written to disk or logs; the new-repo orchestrator requires a token and errors clearly when absent.
- The command is in `handle_app_core_task_project_command` and in `SIDECAR_BACKED_COMMANDS`; DB locks release before every `.await`.
- The refactor preserves the existing clone-from-URL behavior (no regression).
- Svelte 5 runes only; the three modes render correctly and preserve the local + clone flows; no hardcoded hex colors.

- [ ] **Step 4: Manual smoke (user-run)**

Ask the user to run `pnpm electron:dev` → + → confirm the three cards are clearly distinct; create a brand-new repo (verify it appears on GitHub, is empty, clones, and the project opens), and re-confirm the clone and local flows still work. Per project convention, do not launch the Electron app yourself.

---

## Self-Review

**Spec coverage:**
- Three-card dialog selector → Task 4 (Step 5). ✓
- Mode-aware intro + submit label → Task 4 (Steps 6, 8). ✓
- New-repo fields (name, parent folder, Private toggle, preview) → Task 4 (Step 7). ✓
- `create_repo` (`POST /user/repos`, `auto_init:false`) + types → Task 1. ✓
- Shared `clone_into_new_project` helper + refactor of `create_project_from_git` → Task 2 (Step 3). ✓
- `create_project_from_new_repo` orchestrator (token required, create → clone via helper) → Task 2 (Step 3). ✓
- Command arm in deadlock-safe handler → Task 2 (Step 5). ✓
- IPC wrapper + allowlist → Task 3 (Steps 7, 8). ✓
- `canSubmitNewRepo` gating → Task 3 (Step 3). ✓
- Remembered `default_repositories_dir` (read on mount, write on success) → Task 4 (Steps 3, 4). ✓
- Empty-repo handling → relies on existing behavior (no new code); noted in spec. ✓
- Error handling (PAT missing, 422 name taken, orphan-on-failure via no auto-delete) → Task 2 orchestrator messages + reuse of `create_repo` error path. ✓
- No schema change → confirmed (config key only). ✓
- Testing business logic only, no CSS assertions → Tasks 1–4. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code, every run step has a command + expected result.

**Type consistency:** `CreateRepoRequest`/`CreatedRepo`, `create_repo(name, private, token)`, `clone_into_new_project(db, parsed, parent_dir, token, name)`, `create_project_from_new_repo(db, github_client, name, parent_dir, private)`, `createProjectFromNewRepo({name, parentDir, private})`, `canSubmitNewRepo({name, parentDir, isSubmitting})`, command `create_project_from_new_repo`, payload keys `name`/`parentDir`/`private` — all consistent across producing/consuming tasks. The github-branch preview rename (`targetPathPreview` → `githubTargetPreview`) is applied in both its `$derived` declaration (Step 2) and its template use (Step 7).
