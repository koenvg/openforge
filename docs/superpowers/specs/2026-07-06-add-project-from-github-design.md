# Add Project from GitHub — Design

**Date:** 2026-07-06
**Status:** Approved (design), pending implementation plan
**Task:** AVIV-172

## Problem

Today, adding a project in OpenForge only supports selecting a folder that already
exists on disk (`ProjectSetupDialog.svelte` → native directory picker →
`create_project`). A user who wants to work on a GitHub repository must first clone
it themselves, then point OpenForge at the resulting folder.

We want a second entry path: the user pastes a link to a GitHub repository they have
permissions to, chooses a parent folder, and OpenForge clones the repo, derives a
name, and creates the project — in one step. Before cloning, OpenForge must ensure
the repository does not already exist at the target location.

## Feasibility summary

Highly feasible. Every capability required already exists in the codebase; the
feature is primarily wiring existing primitives together plus one new sidecar
command and a UI entry point. No database schema change.

| Need | Existing anchor |
|------|-----------------|
| `git clone` via the `git` binary | `src-tauri/src/plugin_installation.rs::acquire_git_package` (`git clone --depth 1 --branch …`, `normalize_git_repo_url`) |
| GitHub auth (private repos) | PAT in system keychain (`src-tauri/src/secure_store.rs`); retrieved via `src-tauri/src/github_runtime/auth.rs::github_token()`; REST/GraphQL client in `src-tauri/src/github_client/` (`reqwest`, `Authorization: token …`) |
| Path existence / dir / canonicalize validation | `src-tauri/src/git_worktree.rs` (`validate_repository_path_access`, `std::fs::canonicalize`, per-repo `DashMap<String, Arc<Mutex<()>>>` locks) |
| Create the project row | `src-tauri/src/db/projects.rs::create_project(name, path)` → `projects` table (`id`, `name`, `path`, `created_at`, `updated_at`) |
| Native folder picker | `select_directory` IPC → `electronBootAdapter.ts` → `dialog.showOpenDialog({ properties: ['openDirectory'] })` |
| Derive a name from a path | `src/lib/deriveProjectName.ts::deriveProjectNameFromPath` |

## Data model

No new tables or columns. A cloned repository produces exactly the same `projects`
row as today's local-folder flow — the clone target path **is** the project path.
The two entry paths converge on the same `create_project` outcome.

## Frontend — `src/components/project/ProjectSetupDialog.svelte`

Add a segmented toggle at the top of the dialog:

- **Local folder** — today's flow, unchanged.
- **From GitHub** — the new flow.

In **From GitHub** mode:

- **Repository URL** input. Accepts three forms:
  - HTTPS: `https://github.com/owner/repo` (optional trailing `.git`)
  - SSH: `git@github.com:owner/repo.git`
  - Shorthand: `owner/repo`
- **Parent folder** picker — reuses the existing `selectDirectory` IPC with
  `buttonLabel: "Choose parent folder"`.
- **Project name** — auto-derived from the repo name as the user types the URL,
  editable (same "manually edited" latch pattern already used for the local flow).
- **Target path preview** — shows `<parent>/<repo-name>` so the user sees exactly
  where the clone will land.
- **Clone & Create** button — disabled until both URL and parent folder are set.

A small pure helper, `deriveRepoNameFromUrl(url: string): string`, parses the repo
name from any of the three URL forms for the live preview and name derivation.

On submit → `createProjectFromGit({ url, parentDir, name })`.

## IPC + Electron bridge

- **`src/lib/ipc.ts`** — new wrapper:
  ```ts
  export async function createProjectFromGit(args: {
    url: string
    parentDir: string
    name: string
  }): Promise<Project> {
    return invoke<Project>("create_project_from_git", args)
  }
  ```
  Payload is camelCase per the project convention (`parentDir`, not `parent_dir`),
  matching the generated frontend API shape even though the Rust handler reads
  snake_case-agnostic payload keys.
- **`src/electron/backendBridge.ts`** — add `create_project_from_git` to
  `SIDECAR_BACKED_COMMANDS`. This is a pure forward to the sidecar; the folder
  picker already flows through the existing `select_directory` handler, so no new
  Electron-native code is required.

## Sidecar — new `create_project_from_git` command

Registered in `src-tauri/src/app_invoke/` alongside `create_project`. Steps:

1. **Parse / normalize the URL** → `(owner, repo, clone_url)`. Strip a trailing
   `.git` from the repo segment. Reject unparseable input with a clear error.
   Preserve the URL scheme: SSH input clones over SSH; HTTPS and shorthand clone
   over HTTPS.
2. **Resolve the target path** = `canonicalize(parent_dir).join(repo_name)`.
   Validate that the parent exists, is a directory, and that the resulting path does
   not escape the parent (no path traversal via a crafted repo name).
3. **Collision check** (the explicit "ensure it doesn't already exist" requirement):
   error if **either** the target path already exists on disk **or** the target path
   is already registered as an OpenForge project.
4. **Access pre-check** (only when a PAT is stored): `GET /repos/{owner}/{repo}` via
   the existing `github_client`. A 404/403 produces a friendly "repository not found
   or you don't have access" error *before* any clone attempt. If no PAT is stored,
   skip this step and let the clone attempt surface the outcome.
5. **Clone** via the `git` binary, reusing the `acquire_git_package` invocation
   pattern (resolve the binary, safe subprocess CWD, async `tokio::process::Command`).
   For HTTPS / shorthand clones when a PAT is present, supply the token via an
   **ephemeral `-c http.extraHeader="AUTHORIZATION: bearer <PAT>"`** command-line
   credential so it is used for the fetch but **never written into `.git/config`**.
   SSH clones use the user's ambient SSH keys and never touch the PAT.
6. **Create the project** → `db.create_project(&name, &target_path)`; return the
   resulting `ProjectRow` (serialized to the frontend `Project`).
7. **Rollback** — on any failure after the target directory has been created, remove
   the partial clone directory so a subsequent retry is not blocked by leftover
   state. Guard the whole operation with a per-target-path lock (the existing
   `DashMap<String, Arc<Mutex<()>>>` pattern) to prevent double-clone races.

## Error handling

Distinct, user-facing messages for each failure mode:

- Invalid / unparseable repository URL.
- Parent folder missing, not a directory, or not writable.
- Target already exists — either the folder is present on disk or the path is
  already a registered project.
- No access / not found — when a PAT is present and the GitHub API rejects.
- Clone failure — surface a trimmed, friendly form of git's stderr (network/auth).

Security invariant: the PAT is never persisted to disk (not in `.git/config`, not in
the stored `remote.origin.url`).

## Testing (business logic only — no CSS / styling assertions)

**Rust (unit, TDD — failing tests first for the pure logic):**
- URL parse/normalize across HTTPS, SSH, and shorthand; `.git` stripping; invalid
  input → correct `(owner, repo, clone_url)` or error.
- Target-path resolution and collision detection using temp dirs + in-memory DB
  (existing dir → error; already-registered project → error; free path → ok).
- The auth-header builder (`http.extraHeader` value) for the PAT case.
- Rollback: a simulated post-mkdir failure removes the partial directory.

**Vitest (frontend):**
- `deriveRepoNameFromUrl` across all three URL forms and edge cases.
- `createProjectFromGit` wrapper invokes `create_project_from_git` with a camelCase
  payload.
- Dialog logic: submit gating (disabled until URL + parent set) and the target-path
  preview computation. No assertions on classes or visual styling.

## Scope / YAGNI

Deliberately out of scope for this iteration:
- Branch selection or clone depth options (always a normal full clone of the default
  branch).
- Any post-clone behavior beyond what the existing local-folder flow already does
  (set active project, reload list, navigate to settings).
- Non-GitHub git hosts (GitLab/Bitbucket). The URL parser can be generalized later;
  the access pre-check is GitHub-specific by design.

These can be added later without reworking the core flow.
