# Add Project from GitHub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user add a project by pasting a GitHub repo URL and choosing a parent folder; OpenForge clones the repo (if it doesn't already exist) and creates the project.

**Architecture:** A new `From GitHub` mode in the existing `ProjectSetupDialog` collects a repo URL + parent folder. A new sidecar command `create_project_from_git` parses the URL, checks for collisions (on disk and in the project registry), optionally pre-validates access via the GitHub API with the stored PAT, clones via the `git` binary (injecting the PAT as an ephemeral, never-persisted auth header for HTTPS), then calls the existing `create_project`. No database schema change.

**Tech Stack:** Rust sidecar (`tokio`, `git2`/`reqwest` already present, `base64` 0.22 already present), Svelte 5 renderer, TypeScript IPC, Electron bridge, Vitest + `cargo test`.

## Global Constraints

- Do NOT disable eslint or TypeScript errors — fix them.
- Frontend→backend calls go only through typed wrappers in `src/lib/ipc.ts`. Svelte code must not call raw Electron/preload/sidecar transport directly.
- IPC payloads use camelCase property names (e.g. `parentDir`), even though Rust reads them via `payload_string`.
- Rust sidecar command boundaries return `Result<T, String>` with `.map_err(|e| format!(...))`. DB domain files use `impl super::Database`.
- Tests cover business logic only — no assertions on CSS classes, Tailwind utilities, or visual styling.
- Use TDD: write the failing test first, verify it fails, implement, verify it passes, commit.
- Rust test filtering (from `src-tauri/`): one filter per `cargo test <filter>` invocation; never put filters after `--`.
- Vitest: `pnpm exec vitest run <path>`; never the `-- <path>` separator form.
- The PAT must never be written to disk (`.git/config`, remote URL, logs).
- No hardcoded hex colors; use daisyUI/Tailwind semantic classes.

---

## File Structure

**Rust (new):** `src-tauri/src/git_clone.rs` — all clone-from-GitHub logic:
- `parse_repo_url` / `split_owner_repo` — URL parsing (pure).
- `resolve_target_path` / `check_target_available` — target resolution + collision detection.
- `auth_header_value` / `build_clone_args` / `sanitize_clone_error` — clone command construction (pure).
- `clone_repo` / `cleanup_partial_clone` — subprocess + rollback.
- `create_project_from_git` — orchestrator.

**Rust (modified):**
- `src-tauri/src/main.rs` — register `mod git_clone;`.
- `src-tauri/src/db/projects.rs` — add `project_with_path_exists`.
- `src-tauri/src/github_client/mod.rs` — add `classify_repo_access_status` + `check_repo_access`.
- `src-tauri/src/app_invoke/core.rs` — add the `create_project_from_git` command arm.

**Frontend (new):**
- `src/lib/deriveRepoNameFromUrl.ts` (+ `.test.ts`) — repo-name derivation for the live preview.

**Frontend (modified):**
- `src/lib/ipc.ts` — add `createProjectFromGit` wrapper.
- `src/electron/backendBridge.ts` — add `create_project_from_git` to `SIDECAR_BACKED_COMMANDS`.
- `src/components/project/ProjectSetupDialog.svelte` — add the `From GitHub` mode.

---

## Task 1: Rust — `git_clone` module + `parse_repo_url`

**Files:**
- Create: `src-tauri/src/git_clone.rs`
- Modify: `src-tauri/src/main.rs` (add `mod git_clone;` next to `mod git_worktree;` at line 16)
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/git_clone.rs`

**Interfaces:**
- Produces: `pub struct ParsedRepo { pub owner: String, pub repo: String, pub clone_url: String, pub is_ssh: bool }` and `pub fn parse_repo_url(input: &str) -> Result<ParsedRepo, String>`.

- [ ] **Step 1: Register the module**

In `src-tauri/src/main.rs`, directly below line 16 (`mod git_worktree;`) add:

```rust
mod git_clone;
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/git_clone.rs` with only the test module (so it compiles-fails on the missing symbols):

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_full_https_url() {
        let parsed = parse_repo_url("https://github.com/acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn parses_https_url_with_dot_git_and_trailing_path() {
        let parsed = parse_repo_url("https://github.com/acme/widgets.git/tree/main").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
    }

    #[test]
    fn parses_ssh_url() {
        let parsed = parse_repo_url("git@github.com:acme/widgets.git").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "git@github.com:acme/widgets.git");
        assert!(parsed.is_ssh);
    }

    #[test]
    fn parses_shorthand() {
        let parsed = parse_repo_url("acme/widgets").unwrap();
        assert_eq!(parsed.owner, "acme");
        assert_eq!(parsed.repo, "widgets");
        assert_eq!(parsed.clone_url, "https://github.com/acme/widgets.git");
        assert!(!parsed.is_ssh);
    }

    #[test]
    fn rejects_empty_input() {
        assert!(parse_repo_url("   ").is_err());
    }

    #[test]
    fn rejects_non_github_url() {
        assert!(parse_repo_url("https://gitlab.com/acme/widgets").is_err());
    }

    #[test]
    fn rejects_missing_repo_segment() {
        assert!(parse_repo_url("acme").is_err());
    }
}
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test parse_repo_url`
Expected: FAIL — `cannot find function parse_repo_url` / `cannot find type ParsedRepo`.

- [ ] **Step 4: Write the implementation**

Prepend to `src-tauri/src/git_clone.rs` (above the test module):

```rust
//! Clone a GitHub repository and create a project from it.
//!
//! Composes the existing `git`-binary clone pattern, the stored GitHub PAT, and
//! the project registry into a single "add project from GitHub" flow.

#[derive(Debug, Clone, PartialEq)]
pub struct ParsedRepo {
    pub owner: String,
    pub repo: String,
    pub clone_url: String,
    pub is_ssh: bool,
}

/// Parses a GitHub repository reference in HTTPS, SSH, or `owner/repo`
/// shorthand form into its owner, repo, canonical clone URL, and transport.
pub fn parse_repo_url(input: &str) -> Result<ParsedRepo, String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return Err("Repository URL cannot be empty".to_string());
    }

    // SSH: git@github.com:owner/repo(.git)
    if let Some(rest) = trimmed.strip_prefix("git@github.com:") {
        let (owner, repo) = split_owner_repo(rest)?;
        return Ok(ParsedRepo {
            clone_url: format!("git@github.com:{owner}/{repo}.git"),
            owner,
            repo,
            is_ssh: true,
        });
    }

    // HTTPS/HTTP: https://github.com/owner/repo(.git)(/...)
    for prefix in ["https://github.com/", "http://github.com/"] {
        if let Some(rest) = trimmed.strip_prefix(prefix) {
            let (owner, repo) = split_owner_repo(rest)?;
            return Ok(ParsedRepo {
                clone_url: format!("https://github.com/{owner}/{repo}.git"),
                owner,
                repo,
                is_ssh: false,
            });
        }
    }

    // Any other explicit scheme or SSH host is unsupported.
    if trimmed.contains("://") || trimmed.starts_with("git@") {
        return Err(format!("Only GitHub repositories are supported: {trimmed}"));
    }

    // Shorthand: owner/repo
    let (owner, repo) = split_owner_repo(trimmed)?;
    Ok(ParsedRepo {
        clone_url: format!("https://github.com/{owner}/{repo}.git"),
        owner,
        repo,
        is_ssh: false,
    })
}

/// Extracts the first two path segments (`owner`, `repo`) from the remainder of
/// a GitHub reference, stripping a trailing `.git`, query, and fragment.
fn split_owner_repo(rest: &str) -> Result<(String, String), String> {
    let cleaned = rest.trim_end_matches('/');
    let mut segments = cleaned.split('/');
    let owner = segments.next().unwrap_or("").trim().to_string();
    let repo_seg = segments.next().unwrap_or("").trim();
    if owner.is_empty() || repo_seg.is_empty() {
        return Err(format!("Could not parse owner/repo from: {rest}"));
    }
    let repo = repo_seg
        .split(|c| c == '?' || c == '#')
        .next()
        .unwrap_or(repo_seg);
    let repo = repo.strip_suffix(".git").unwrap_or(repo).to_string();
    if repo.is_empty() {
        return Err(format!("Could not parse repository name from: {rest}"));
    }
    Ok((owner, repo))
}
```

- [ ] **Step 5: Run test to verify it passes**

Run (from `src-tauri/`): `cargo test parse_repo_url`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/main.rs src-tauri/src/git_clone.rs
git commit -m "feat: add GitHub repo URL parser for project cloning"
```

---

## Task 2: Rust — DB helper `project_with_path_exists`

**Files:**
- Modify: `src-tauri/src/db/projects.rs`
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/db/projects.rs`

**Interfaces:**
- Consumes: `Database::create_project` (existing), `crate::db::test_helpers::make_test_db` (existing test helper).
- Produces: `pub fn project_with_path_exists(&self, path: &str) -> rusqlite::Result<bool>`.

- [ ] **Step 1: Write the failing test**

Add inside the existing `#[cfg(test)] mod tests` block in `src-tauri/src/db/projects.rs` (after the last test, before the closing `}`):

```rust
    #[test]
    fn test_project_with_path_exists() {
        let (db, path) = make_test_db("project_with_path_exists");

        assert!(
            !db.project_with_path_exists("/tmp/does-not-exist")
                .expect("query failed"),
            "no project registered yet"
        );

        db.create_project("Widgets", "/tmp/widgets")
            .expect("create failed");

        assert!(
            db.project_with_path_exists("/tmp/widgets")
                .expect("query failed"),
            "path should now be registered"
        );
        assert!(
            !db.project_with_path_exists("/tmp/other")
                .expect("query failed"),
            "unrelated path should not match"
        );

        drop(db);
        let _ = fs::remove_file(&path);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test test_project_with_path_exists`
Expected: FAIL — `no method named project_with_path_exists`.

- [ ] **Step 3: Write the implementation**

Add this method inside `impl super::Database` in `src-tauri/src/db/projects.rs` (e.g. right after `create_project`, before `get_all_projects`):

```rust
    /// Returns true if any project is registered at the exact given path.
    pub fn project_with_path_exists(&self, path: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM projects WHERE path = ?1",
            [path],
            |row| row.get(0),
        )?;
        Ok(count > 0)
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `src-tauri/`): `cargo test test_project_with_path_exists`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/projects.rs
git commit -m "feat: add project_with_path_exists DB lookup"
```

---

## Task 3: Rust — `resolve_target_path` + `check_target_available`

**Files:**
- Modify: `src-tauri/src/git_clone.rs`
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/git_clone.rs`

**Interfaces:**
- Consumes: `Database::project_with_path_exists` (Task 2); `crate::db::test_helpers::make_test_db`.
- Produces:
  - `pub fn resolve_target_path(parent_dir: &std::path::Path, repo_name: &str) -> Result<std::path::PathBuf, String>`
  - `pub fn check_target_available(target: &std::path::Path, db: &crate::db::Database) -> Result<(), String>`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/git_clone.rs`:

```rust
    use std::path::Path;
    use tempfile::tempdir;

    #[test]
    fn resolve_target_joins_repo_name_onto_parent() {
        let parent = tempdir().unwrap();
        let target = resolve_target_path(parent.path(), "widgets").unwrap();
        assert_eq!(target.file_name().unwrap(), "widgets");
        assert!(target.starts_with(std::fs::canonicalize(parent.path()).unwrap()));
    }

    #[test]
    fn resolve_target_rejects_traversal_repo_name() {
        let parent = tempdir().unwrap();
        assert!(resolve_target_path(parent.path(), "..").is_err());
        assert!(resolve_target_path(parent.path(), "a/b").is_err());
    }

    #[test]
    fn resolve_target_rejects_missing_parent() {
        assert!(resolve_target_path(Path::new("/no/such/parent/xyz"), "widgets").is_err());
    }

    #[test]
    fn check_target_available_ok_for_free_path() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_free");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        assert!(check_target_available(&target, &db).is_ok());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[test]
    fn check_target_available_errors_when_dir_exists() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_dir_exists");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        std::fs::create_dir(&target).unwrap();
        assert!(check_target_available(&target, &db).is_err());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }

    #[test]
    fn check_target_available_errors_when_project_registered() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_target_registered");
        let parent = tempdir().unwrap();
        let target = parent.path().join("widgets");
        db.create_project("Widgets", &target.to_string_lossy())
            .expect("create project failed");
        assert!(check_target_available(&target, &db).is_err());
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test resolve_target`
Expected: FAIL — `cannot find function resolve_target_path` (and `check_target_available`).

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/git_clone.rs` (above the test module). Add `use std::path::{Path, PathBuf};` at the top of the file if not already present:

```rust
use std::path::{Path, PathBuf};

/// Resolves the clone destination as `<canonical parent>/<repo_name>`, rejecting
/// a parent that isn't an accessible directory and any repo name that could
/// escape the parent (path separators, `.`/`..`).
pub fn resolve_target_path(parent_dir: &Path, repo_name: &str) -> Result<PathBuf, String> {
    if repo_name.is_empty()
        || repo_name.contains('/')
        || repo_name.contains('\\')
        || repo_name == "."
        || repo_name == ".."
    {
        return Err(format!("Invalid repository folder name: {repo_name}"));
    }
    let metadata = std::fs::metadata(parent_dir)
        .map_err(|e| format!("Parent folder is not accessible: {e}"))?;
    if !metadata.is_dir() {
        return Err(format!(
            "Parent path is not a directory: {}",
            parent_dir.display()
        ));
    }
    let canonical_parent = std::fs::canonicalize(parent_dir)
        .map_err(|e| format!("Failed to resolve parent folder: {e}"))?;
    Ok(canonical_parent.join(repo_name))
}

/// Errors if the clone destination already exists on disk or is already
/// registered as a project. This is the "ensure it doesn't already exist" guard.
pub fn check_target_available(target: &Path, db: &crate::db::Database) -> Result<(), String> {
    if target.exists() {
        return Err(format!(
            "A folder already exists at {}. Choose a different parent folder or remove it first.",
            target.display()
        ));
    }
    let target_str = target.to_string_lossy().to_string();
    if db
        .project_with_path_exists(&target_str)
        .map_err(|e| format!("Failed to check existing projects: {e}"))?
    {
        return Err(format!(
            "A project is already registered at {}.",
            target.display()
        ));
    }
    Ok(())
}
```

> Note: the `use std::path::{Path, PathBuf};` import and the `use tempfile::tempdir;` in the test block may already be added by earlier steps; if the compiler warns about an unused/duplicate import, consolidate to a single `use`.

- [ ] **Step 4: Run tests to verify they pass**

Run (from `src-tauri/`): `cargo test resolve_target` then `cargo test check_target_available`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git_clone.rs
git commit -m "feat: add clone target resolution and collision check"
```

---

## Task 4: Rust — clone command construction + subprocess + rollback

**Files:**
- Modify: `src-tauri/src/git_clone.rs`
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/git_clone.rs`

**Interfaces:**
- Consumes: `ParsedRepo` (Task 1); `crate::user_environment::user_tool_path()` (`pub(crate)`).
- Produces:
  - `pub fn auth_header_value(token: &str) -> String`
  - `pub fn build_clone_args(clone_url: &str, target: &Path, is_ssh: bool, token: Option<&str>) -> Vec<String>`
  - `pub fn sanitize_clone_error(stderr: &str) -> String`
  - `pub async fn clone_repo(parsed: &ParsedRepo, target: &Path, token: Option<&str>) -> Result<(), String>`
  - `pub fn cleanup_partial_clone(target: &Path)`

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `src-tauri/src/git_clone.rs`:

```rust
    use base64::{engine::general_purpose, Engine as _};

    #[test]
    fn auth_header_uses_basic_scheme_with_token_as_password() {
        let header = auth_header_value("secret-token");
        let encoded = header
            .strip_prefix("Authorization: Basic ")
            .expect("basic scheme prefix");
        let decoded =
            String::from_utf8(general_purpose::STANDARD.decode(encoded).expect("valid base64"))
                .unwrap();
        assert_eq!(decoded, "x-access-token:secret-token");
    }

    #[test]
    fn https_clone_with_token_injects_ephemeral_auth_header() {
        let args = build_clone_args(
            "https://github.com/acme/widgets.git",
            Path::new("/tmp/widgets"),
            false,
            Some("tok"),
        );
        assert_eq!(args[0], "-c");
        assert!(args[1].starts_with("http.extraHeader=Authorization: Basic "));
        assert!(args.contains(&"clone".to_string()));
        assert!(args.contains(&"https://github.com/acme/widgets.git".to_string()));
        assert!(args.contains(&"/tmp/widgets".to_string()));
    }

    #[test]
    fn ssh_clone_never_injects_token() {
        let args = build_clone_args(
            "git@github.com:acme/widgets.git",
            Path::new("/tmp/widgets"),
            true,
            Some("tok"),
        );
        assert!(!args.iter().any(|a| a == "-c"));
        assert!(!args.iter().any(|a| a.contains("extraHeader")));
    }

    #[test]
    fn https_clone_without_token_has_no_auth_header() {
        let args = build_clone_args(
            "https://github.com/acme/widgets.git",
            Path::new("/tmp/widgets"),
            false,
            None,
        );
        assert!(!args.iter().any(|a| a == "-c"));
        assert_eq!(args[0], "clone");
    }

    #[test]
    fn sanitize_clone_error_trims_and_caps_length() {
        let noisy = format!("  {}  ", "x".repeat(5000));
        let cleaned = sanitize_clone_error(&noisy);
        assert!(!cleaned.starts_with(' '));
        assert!(cleaned.len() <= 500);
    }

    #[test]
    fn cleanup_partial_clone_removes_directory() {
        let parent = tempdir().unwrap();
        let target = parent.path().join("half-clone");
        std::fs::create_dir_all(target.join("nested")).unwrap();
        std::fs::write(target.join("nested/file.txt"), b"x").unwrap();
        cleanup_partial_clone(&target);
        assert!(!target.exists());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `src-tauri/`): `cargo test build_clone_args` then `cargo test auth_header`
Expected: FAIL — missing functions.

- [ ] **Step 3: Write the implementation**

Add to `src-tauri/src/git_clone.rs` (above the test module). Add these imports near the top of the file:

```rust
use base64::{engine::general_purpose, Engine as _};
use tokio::process::Command;
```

Then the functions:

```rust
/// Builds the `Authorization: Basic <base64>` header value used to authenticate
/// an HTTPS clone. GitHub accepts a PAT as the password with any username; we
/// use `x-access-token` to match the actions/checkout convention.
pub fn auth_header_value(token: &str) -> String {
    let encoded = general_purpose::STANDARD.encode(format!("x-access-token:{token}"));
    format!("Authorization: Basic {encoded}")
}

/// Assembles the `git` args for the clone. For HTTPS clones with a token, the
/// credential is passed via an ephemeral `-c http.extraHeader` so it is used for
/// the fetch but never written into the cloned repo's `.git/config`. SSH clones
/// rely on the user's ambient SSH keys and never receive the token.
pub fn build_clone_args(
    clone_url: &str,
    target: &Path,
    is_ssh: bool,
    token: Option<&str>,
) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if let (false, Some(token)) = (is_ssh, token) {
        args.push("-c".to_string());
        args.push(format!("http.extraHeader={}", auth_header_value(token)));
    }
    args.push("clone".to_string());
    args.push(clone_url.to_string());
    args.push(target.to_string_lossy().to_string());
    args
}

/// Trims and length-caps git's stderr for user display.
pub fn sanitize_clone_error(stderr: &str) -> String {
    let trimmed = stderr.trim();
    if trimmed.len() > 500 {
        format!("{}…", &trimmed[..500])
    } else {
        trimmed.to_string()
    }
}

/// Removes a partial clone directory so a failed attempt doesn't block a retry.
pub fn cleanup_partial_clone(target: &Path) {
    if target.exists() {
        let _ = std::fs::remove_dir_all(target);
    }
}

/// Clones `parsed` into `target` via the `git` binary, cleaning up on failure.
pub async fn clone_repo(
    parsed: &ParsedRepo,
    target: &Path,
    token: Option<&str>,
) -> Result<(), String> {
    let args = build_clone_args(&parsed.clone_url, target, parsed.is_ssh, token);
    let output = Command::new("git")
        .env("PATH", crate::user_environment::user_tool_path())
        .args(&args)
        .output()
        .await
        .map_err(|e| format!("Failed to run git clone: {e}"))?;

    if !output.status.success() {
        cleanup_partial_clone(target);
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("git clone failed: {}", sanitize_clone_error(&stderr)));
    }
    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run (from `src-tauri/`): `cargo test build_clone_args`, then `cargo test auth_header`, then `cargo test cleanup_partial_clone`, then `cargo test sanitize_clone_error`
Expected: PASS for each.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/git_clone.rs
git commit -m "feat: add git clone command construction with ephemeral auth"
```

---

## Task 5: Rust — GitHub access pre-check

**Files:**
- Modify: `src-tauri/src/github_client/mod.rs`
- Test: the existing `#[cfg(test)] mod tests` in `src-tauri/src/github_client/mod.rs`

**Interfaces:**
- Consumes: `self.github_get(url, token)` (existing private method), `GitHubError::NetworkError` (existing).
- Produces:
  - `pub(crate) fn classify_repo_access_status(status: u16) -> RepoAccess` with `pub(crate) enum RepoAccess { Accessible, Denied, Unknown }`
  - `pub async fn check_repo_access(&self, owner: &str, repo: &str, token: &str) -> Result<bool, GitHubError>`

- [ ] **Step 1: Write the failing test**

Add to the `tests` module in `src-tauri/src/github_client/mod.rs`:

```rust
    #[test]
    fn classify_repo_access_status_maps_codes() {
        assert!(matches!(classify_repo_access_status(200), RepoAccess::Accessible));
        assert!(matches!(classify_repo_access_status(301), RepoAccess::Unknown));
        assert!(matches!(classify_repo_access_status(401), RepoAccess::Denied));
        assert!(matches!(classify_repo_access_status(403), RepoAccess::Denied));
        assert!(matches!(classify_repo_access_status(404), RepoAccess::Denied));
        assert!(matches!(classify_repo_access_status(500), RepoAccess::Unknown));
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test classify_repo_access_status`
Expected: FAIL — `cannot find function classify_repo_access_status`.

- [ ] **Step 3: Write the implementation**

Add near the top-level of `src-tauri/src/github_client/mod.rs` (outside the `impl` block, e.g. just above `impl GitHubClient`):

```rust
/// Result of interpreting the HTTP status of a `GET /repos/{owner}/{repo}` call.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RepoAccess {
    Accessible,
    Denied,
    Unknown,
}

/// Maps a repo-lookup HTTP status to an access verdict. 401/403/404 mean the
/// caller cannot see the repo (private-without-access or nonexistent); anything
/// non-2xx and non-denied is treated as unknown so the clone attempt decides.
pub(crate) fn classify_repo_access_status(status: u16) -> RepoAccess {
    match status {
        200..=299 => RepoAccess::Accessible,
        401 | 403 | 404 => RepoAccess::Denied,
        _ => RepoAccess::Unknown,
    }
}
```

Add this method inside `impl GitHubClient` (e.g. right after `get_authenticated_user`):

```rust
    /// Checks whether the authenticated token can see the given repository.
    /// Returns Ok(true) when accessible or when the outcome is inconclusive
    /// (let the clone decide), Ok(false) only when GitHub clearly denies access.
    pub async fn check_repo_access(
        &self,
        owner: &str,
        repo: &str,
        token: &str,
    ) -> Result<bool, GitHubError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}");
        let response = self
            .github_get(&url, token)
            .send()
            .await
            .map_err(|e| GitHubError::NetworkError(e.to_string()))?;
        Ok(match classify_repo_access_status(response.status().as_u16()) {
            RepoAccess::Accessible | RepoAccess::Unknown => true,
            RepoAccess::Denied => false,
        })
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run (from `src-tauri/`): `cargo test classify_repo_access_status`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/github_client/mod.rs
git commit -m "feat: add GitHub repo access pre-check"
```

---

## Task 6: Rust — orchestrator + command wiring

**Files:**
- Modify: `src-tauri/src/git_clone.rs` (orchestrator)
- Modify: `src-tauri/src/app_invoke/core.rs` (command arm)
- Modify: `src/electron/backendBridge.ts` (allowlist)
- Test: inline `#[cfg(test)] mod tests` in `src-tauri/src/git_clone.rs`

**Interfaces:**
- Consumes: `parse_repo_url`, `resolve_target_path`, `check_target_available`, `clone_repo` (Tasks 1/3/4); `crate::github_runtime::github_token()` (`pub` re-export); `crate::github_client::GitHubClient::check_repo_access` (Task 5); `crate::git_worktree::acquire_lock` (`pub(crate)`, returns `Arc<tokio::sync::Mutex<()>>`); `crate::db::acquire_db`; `Database::create_project`; `crate::db::projects::ProjectRow`.
- Produces: `pub async fn create_project_from_git(db: &std::sync::Arc<std::sync::Mutex<crate::db::Database>>, github_client: &crate::github_client::GitHubClient, url: &str, parent_dir: &str, name: &str) -> Result<crate::db::projects::ProjectRow, String>`.

- [ ] **Step 1: Write the failing test**

This test exercises the pre-clone guard path (collision) which needs no network or git. Add to the `tests` module in `src-tauri/src/git_clone.rs`:

```rust
    #[tokio::test]
    async fn create_project_from_git_rejects_existing_target_before_cloning() {
        let (db, dbpath) = crate::db::test_helpers::make_test_db("clone_orch_collision");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));
        let client = crate::github_client::GitHubClient::new();

        let parent = tempdir().unwrap();
        // Pre-create the destination so the collision guard trips.
        std::fs::create_dir(parent.path().join("widgets")).unwrap();

        let url = format!("{}/widgets", parent.path().to_string_lossy());
        // Use a shorthand-style owner/repo so parsing yields repo "widgets".
        let result = create_project_from_git(
            &db,
            &client,
            "acme/widgets",
            &parent.path().to_string_lossy(),
            "Widgets",
        )
        .await;

        assert!(result.is_err(), "existing target dir must be rejected");
        let _ = url; // silence unused in case of edits
        drop(db);
        let _ = std::fs::remove_file(&dbpath);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test create_project_from_git_rejects_existing_target`
Expected: FAIL — `cannot find function create_project_from_git`.

- [ ] **Step 3: Write the orchestrator**

Add to `src-tauri/src/git_clone.rs` (above the test module):

```rust
use std::sync::{Arc, Mutex};

/// End-to-end: parse the URL, guard against collisions, optionally pre-check
/// access with the stored PAT, clone, then register the project.
pub async fn create_project_from_git(
    db: &Arc<Mutex<crate::db::Database>>,
    github_client: &crate::github_client::GitHubClient,
    url: &str,
    parent_dir: &str,
    name: &str,
) -> Result<crate::db::projects::ProjectRow, String> {
    let parsed = parse_repo_url(url)?;
    let target = resolve_target_path(Path::new(parent_dir), &parsed.repo)?;

    // Serialize concurrent clones to the same destination.
    let lock = crate::git_worktree::acquire_lock(&target);
    let _guard = lock.lock().await;

    // Collision guard — release the DB lock before any network/subprocess work.
    {
        let db = crate::db::acquire_db(db);
        check_target_available(&target, &db)?;
    }

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

    clone_repo(&parsed, &target, token.as_deref()).await?;

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
```

> Note: `acquire_lock` returns `Arc<tokio::sync::Mutex<()>>` (confirmed by `.lock().await` usage in `git_worktree.rs`), so holding `_guard` across `.await` is sound. If `log` is not already imported in this file, use the fully-qualified `log::warn!` as shown (the `log` crate is a workspace dependency used across the sidecar).

- [ ] **Step 4: Wire the command arm**

In `src-tauri/src/app_invoke/core.rs`, inside `handle_app_unmatched_command`, add a new arm right after the existing `"create_project" => { … }` arm (around line 185):

```rust
        "create_project_from_git" => {
            let url = payload_string(&request.payload, "url")?;
            let parent_dir = payload_string(&request.payload, "parentDir")?;
            let name = payload_string(&request.payload, "name")?;
            let project = crate::git_clone::create_project_from_git(
                &state.db,
                &state.github_client,
                &url,
                &parent_dir,
                &name,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(project)?
        }
```

> Note: `handle_app_unmatched_command` opens with `let db = crate::db::acquire_db(&state.db);` at the top (line 123), which holds the DB lock for the whole function. The orchestrator also acquires the DB lock internally, which would deadlock. Fix: this new arm must NOT run under that outer guard. Move the outer `let db = …` acquisition out of the top of the function into each arm that needs it, OR handle `create_project_from_git` in `handle_app_core_task_project_command` (in the same file) instead, which does not hold a function-wide DB lock. **Implement it in `handle_app_core_task_project_command`** — add the arm there (that function returns `Ok(Some(value))`), matching the pattern of the `"delete_project"` arm which acquires its own short-lived `db` guard. Place the arm before the `_ => return Ok(None),` line.

Concretely, add to `handle_app_core_task_project_command` (before `_ => return Ok(None),`):

```rust
        "create_project_from_git" => {
            let url = payload_string(&request.payload, "url")?;
            let parent_dir = payload_string(&request.payload, "parentDir")?;
            let name = payload_string(&request.payload, "name")?;
            let project = crate::git_clone::create_project_from_git(
                &state.db,
                &state.github_client,
                &url,
                &parent_dir,
                &name,
            )
            .await
            .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;
            json_value(project)?
        }
```

(Do NOT also add it to `handle_app_unmatched_command`.)

- [ ] **Step 5: Add the command to the Electron allowlist**

In `src/electron/backendBridge.ts`, add `'create_project_from_git',` to the `SIDECAR_BACKED_COMMANDS` set, right after the existing `'create_project',` entry (line 66):

```ts
  'create_project',
  'create_project_from_git',
```

- [ ] **Step 6: Run tests to verify they pass**

Run (from `src-tauri/`): `cargo test create_project_from_git_rejects_existing_target`
Expected: PASS.
Then compile-check the touched crate: `cargo build`
Expected: builds without errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/git_clone.rs src-tauri/src/app_invoke/core.rs src/electron/backendBridge.ts
git commit -m "feat: wire create_project_from_git sidecar command"
```

---

## Task 7: Frontend — repo-name helper + IPC wrapper

**Files:**
- Create: `src/lib/deriveRepoNameFromUrl.ts`
- Create: `src/lib/deriveRepoNameFromUrl.test.ts`
- Modify: `src/lib/ipc.ts`
- Test: `src/lib/ipc.createProjectFromGit.test.ts` (new)

**Interfaces:**
- Produces: `deriveRepoNameFromUrl(url: string): string`; `createProjectFromGit(args: { url: string; parentDir: string; name: string }): Promise<Project>`.

- [ ] **Step 1: Write the failing helper test**

Create `src/lib/deriveRepoNameFromUrl.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { deriveRepoNameFromUrl } from './deriveRepoNameFromUrl'

describe('deriveRepoNameFromUrl', () => {
  it('derives from a full HTTPS url', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets')).toBe('widgets')
  })

  it('strips a trailing .git', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets.git')).toBe('widgets')
  })

  it('derives from an SSH url', () => {
    expect(deriveRepoNameFromUrl('git@github.com:acme/widgets.git')).toBe('widgets')
  })

  it('derives from owner/repo shorthand', () => {
    expect(deriveRepoNameFromUrl('acme/widgets')).toBe('widgets')
  })

  it('ignores a trailing path segment', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets/tree/main')).toBe('widgets')
  })

  it('returns an empty string when no repo can be derived', () => {
    expect(deriveRepoNameFromUrl('acme')).toBe('')
    expect(deriveRepoNameFromUrl('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/deriveRepoNameFromUrl.test.ts`
Expected: FAIL — cannot resolve `./deriveRepoNameFromUrl`.

- [ ] **Step 3: Write the helper**

Create `src/lib/deriveRepoNameFromUrl.ts`:

```ts
/**
 * Derives the repository name from a GitHub reference in HTTPS, SSH, or
 * `owner/repo` shorthand form, for the "From GitHub" project-add preview.
 * Returns an empty string when a repo name cannot be derived. The authoritative
 * parse happens in the Rust sidecar; this mirror is display-only.
 */
export function deriveRepoNameFromUrl(url: string): string {
  const trimmed = url.trim()
  if (!trimmed) return ''

  // Normalize SSH (git@github.com:owner/repo) and scheme prefixes down to the
  // "owner/repo…" tail.
  let rest = trimmed
    .replace(/^git@github\.com:/i, '')
    .replace(/^https?:\/\/github\.com\//i, '')

  const segments = rest.split('/').filter(Boolean)
  if (segments.length < 2) return ''

  const repoSegment = segments[1].split(/[?#]/)[0]
  return repoSegment.replace(/\.git$/i, '')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/deriveRepoNameFromUrl.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing IPC wrapper test**

Create `src/lib/ipc.createProjectFromGit.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const invoke = vi.fn()
vi.mock('./desktopIpc', () => ({
  invokeDesktopCommand: (...args: unknown[]) => invoke(...args),
  isElectronDesktopBridgeAvailable: () => true,
}))

import { createProjectFromGit } from './ipc'

describe('createProjectFromGit', () => {
  beforeEach(() => invoke.mockReset())

  it('invokes create_project_from_git with a camelCase payload', async () => {
    invoke.mockResolvedValue({ id: 'P-1', name: 'Widgets', path: '/tmp/widgets', created_at: 1, updated_at: 1 })
    const project = await createProjectFromGit({
      url: 'https://github.com/acme/widgets',
      parentDir: '/tmp',
      name: 'Widgets',
    })
    expect(invoke).toHaveBeenCalledWith('create_project_from_git', {
      url: 'https://github.com/acme/widgets',
      parentDir: '/tmp',
      name: 'Widgets',
    })
    expect(project.id).toBe('P-1')
  })
})
```

- [ ] **Step 6: Run test to verify it fails**

Run: `pnpm exec vitest run src/lib/ipc.createProjectFromGit.test.ts`
Expected: FAIL — `createProjectFromGit is not exported`.

- [ ] **Step 7: Add the IPC wrapper**

In `src/lib/ipc.ts`, add right after `createProject` (line 63):

```ts
export async function createProjectFromGit(args: {
  url: string
  parentDir: string
  name: string
}): Promise<Project> {
  return invoke<Project>("create_project_from_git", args);
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `pnpm exec vitest run src/lib/ipc.createProjectFromGit.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/deriveRepoNameFromUrl.ts src/lib/deriveRepoNameFromUrl.test.ts src/lib/ipc.ts src/lib/ipc.createProjectFromGit.test.ts
git commit -m "feat: add deriveRepoNameFromUrl helper and createProjectFromGit IPC"
```

---

## Task 8: Frontend — `ProjectSetupDialog` GitHub mode

**Files:**
- Modify: `src/components/project/ProjectSetupDialog.svelte`
- Create: `src/components/project/projectSetupDialogLogic.ts`
- Create: `src/components/project/projectSetupDialogLogic.test.ts`

**Interfaces:**
- Consumes: `createProjectFromGit`, `selectDirectory`, `createProject` (existing); `deriveRepoNameFromUrl` (Task 7).
- Produces: pure helpers `computeTargetPathPreview(parentDir: string, repoName: string): string` and `canSubmitGithub(args: { repoUrl: string; parentDir: string; projectName: string; isSubmitting: boolean }): boolean`.

Rationale: the dialog logic worth testing (submit gating, path preview) is extracted into a pure module so tests assert behavior without touching markup/styling.

- [ ] **Step 1: Write the failing logic tests**

Create `src/components/project/projectSetupDialogLogic.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { computeTargetPathPreview, canSubmitGithub } from './projectSetupDialogLogic'

describe('computeTargetPathPreview', () => {
  it('joins parent and repo name with a slash', () => {
    expect(computeTargetPathPreview('/Users/you/code', 'widgets')).toBe('/Users/you/code/widgets')
  })

  it('normalizes a trailing slash on the parent', () => {
    expect(computeTargetPathPreview('/Users/you/code/', 'widgets')).toBe('/Users/you/code/widgets')
  })

  it('returns an empty string until both parts are present', () => {
    expect(computeTargetPathPreview('', 'widgets')).toBe('')
    expect(computeTargetPathPreview('/Users/you/code', '')).toBe('')
  })
})

describe('canSubmitGithub', () => {
  it('is true when url + parent are set and not submitting', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: 'W', isSubmitting: false })).toBe(true)
  })

  it('is false while submitting', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: 'W', isSubmitting: true })).toBe(false)
  })

  it('is false when url or parent is missing', () => {
    expect(canSubmitGithub({ repoUrl: '', parentDir: '/tmp', projectName: 'W', isSubmitting: false })).toBe(false)
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '', projectName: 'W', isSubmitting: false })).toBe(false)
  })

  it('is false when project name is empty', () => {
    expect(canSubmitGithub({ repoUrl: 'acme/widgets', parentDir: '/tmp', projectName: '  ', isSubmitting: false })).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: FAIL — cannot resolve `./projectSetupDialogLogic`.

- [ ] **Step 3: Write the logic module**

Create `src/components/project/projectSetupDialogLogic.ts`:

```ts
/** Display-only preview of the clone destination: `<parent>/<repoName>`. */
export function computeTargetPathPreview(parentDir: string, repoName: string): string {
  const parent = parentDir.trim().replace(/[/\\]+$/, '')
  const repo = repoName.trim()
  if (!parent || !repo) return ''
  return `${parent}/${repo}`
}

/** Submit gating for the "From GitHub" mode. */
export function canSubmitGithub(args: {
  repoUrl: string
  parentDir: string
  projectName: string
  isSubmitting: boolean
}): boolean {
  return (
    !args.isSubmitting &&
    args.repoUrl.trim().length > 0 &&
    args.parentDir.trim().length > 0 &&
    args.projectName.trim().length > 0
  )
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the mode into the dialog**

Edit `src/components/project/ProjectSetupDialog.svelte`. Add imports (top `<script>`):

```ts
  import { createProject, createProjectFromGit, selectDirectory } from '../../lib/ipc'
  import { deriveRepoNameFromUrl } from '../../lib/deriveRepoNameFromUrl'
  import { computeTargetPathPreview, canSubmitGithub } from './projectSetupDialogLogic'
```

(Replace the existing `import { createProject, selectDirectory } from '../../lib/ipc'` line.)

Add state below the existing state declarations:

```ts
  let mode = $state<'local' | 'github'>('local')
  let repoUrl = $state('')
  let parentDir = $state('')

  let targetPathPreview = $derived(computeTargetPathPreview(parentDir, deriveRepoNameFromUrl(repoUrl)))

  let canSubmitLocal = $derived(!isSubmitting && path.trim().length > 0 && projectName.trim().length > 0)
  let canSubmitGithubMode = $derived(canSubmitGithub({ repoUrl, parentDir, projectName, isSubmitting }))
  let canSubmit = $derived(mode === 'local' ? canSubmitLocal : canSubmitGithubMode)
```

(Remove the old single `canSubmit` derived on line 24 — it is replaced by the three lines above.)

Add a URL-input handler and a parent-folder picker:

```ts
  function handleRepoUrlInput() {
    if (createError) createError = null
    if (!nameManuallyEdited || !projectName.trim()) {
      const derived = deriveRepoNameFromUrl(repoUrl)
      if (derived) projectName = derived
    }
  }

  async function handleSelectParentFolder() {
    createError = null
    try {
      const selected = await selectDirectory({
        defaultPath: parentDir.trim() || undefined,
        buttonLabel: 'Choose Parent Folder',
        message: 'Choose the folder OpenForge should clone the repository into.',
      })
      if (!selected) return
      parentDir = selected
    } catch (e) {
      createError = getFailureMessage(e)
      console.error('Failed to select parent folder:', e)
    }
  }
```

Update `handleSubmit` to branch on mode. Replace the body of `handleSubmit` with:

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
      } else {
        if (!repoUrl.trim() || !parentDir.trim() || !projectName.trim()) return
        project = await createProjectFromGit({
          url: repoUrl.trim(),
          parentDir: parentDir.trim(),
          name: projectName.trim(),
        })
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

(Note the early `return`s now sit inside the `try`; because they run before `isSubmitting` is meaningfully used, also reset `isSubmitting = false` in the `finally` — already handled.)

Add the mode toggle at the top of the `<form>` (above the existing intro `<p>`), using daisyUI semantic tab classes:

```svelte
    <div role="tablist" class="tabs tabs-boxed">
      <button
        type="button"
        role="tab"
        class="tab {mode === 'local' ? 'tab-active' : ''}"
        onclick={() => { mode = 'local'; createError = null }}
        disabled={isSubmitting}
      >Local folder</button>
      <button
        type="button"
        role="tab"
        class="tab {mode === 'github' ? 'tab-active' : ''}"
        onclick={() => { mode = 'github'; createError = null }}
        disabled={isSubmitting}
      >From GitHub</button>
    </div>
```

Wrap the existing local-mode body (the `{#if !path} … {:else} … {/if}` block and its project-name label) in `{#if mode === 'local'}` and add the GitHub-mode markup in the `{:else}` branch:

```svelte
    {:else}
      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Repository URL <span class="text-error" aria-hidden="true">*</span></span>
        <input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={repoUrl}
          oninput={handleRepoUrlInput}
          placeholder="https://github.com/owner/repo"
          autocomplete="off"
        />
        <span class="text-[0.65rem] text-base-content/40">Paste an HTTPS or SSH URL, or owner/repo. Private repos use your saved GitHub token.</span>
      </label>

      <div class="flex flex-col gap-1.5">
        <span id="add-project-parent-label" class="text-xs text-base-content/60 font-medium">Parent Folder <span class="text-error" aria-hidden="true">*</span></span>
        <div class="flex items-center gap-2">
          <span class="input input-bordered input-sm w-full flex items-center font-mono text-xs truncate" role="group" aria-labelledby="add-project-parent-label" title={parentDir}>{parentDir || 'No folder selected'}</span>
          <button class="btn btn-ghost btn-sm" type="button" onclick={handleSelectParentFolder} disabled={isSubmitting}>Choose</button>
        </div>
      </div>

      <label class="flex flex-col gap-1.5">
        <span class="text-xs text-base-content/60 font-medium">Project Name <span class="text-error" aria-hidden="true">*</span></span>
        <input
          data-project-name-input
          type="text"
          class="input input-bordered input-sm w-full"
          bind:value={projectName}
          placeholder="My Awesome Project"
          oninput={handleNameInput}
          autocomplete="off"
        />
      </label>

      {#if targetPathPreview}
        <p class="text-[0.65rem] text-base-content/40 m-0">Will clone into <span class="font-mono">{targetPathPreview}</span></p>
      {/if}
    {/if}
```

Update the submit button label so it reads "Cloning..." in GitHub mode:

```svelte
      {isSubmitting ? (mode === 'github' ? 'Cloning...' : 'Creating...') : 'Create Project'}
```

- [ ] **Step 6: Typecheck and run the extracted-logic tests**

Run: `pnpm exec vitest run src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.
Run: `pnpm exec tsc --noEmit`
Expected: no new errors from the touched files. (See project note: a pre-existing local `ignoreDeprecations "6.0"` TS6 error may appear that is unrelated to this change and does not block CI — do not attempt to fix it here.)

- [ ] **Step 7: Commit**

```bash
git add src/components/project/ProjectSetupDialog.svelte src/components/project/projectSetupDialogLogic.ts src/components/project/projectSetupDialogLogic.test.ts
git commit -m "feat: add From GitHub mode to the add-project dialog"
```

---

## Task 9: Full verification + code review

**Files:** none (verification only)

- [ ] **Step 1: Rust tests for the new module and DB helper**

Run (from `src-tauri/`): `cargo test git_clone`
Expected: PASS. Then: `cargo test project_with_path_exists` and `cargo test classify_repo_access_status`
Expected: PASS.

- [ ] **Step 2: Rust build**

Run (from `src-tauri/`): `cargo build`
Expected: builds without errors or new warnings in touched files.

- [ ] **Step 3: Frontend targeted tests**

Run: `pnpm exec vitest run src/lib/deriveRepoNameFromUrl.test.ts src/lib/ipc.createProjectFromGit.test.ts src/components/project/projectSetupDialogLogic.test.ts`
Expected: PASS.

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no new errors attributable to this change.

- [ ] **Step 5: Code review**

Invoke `superpowers:requesting-code-review` (or the `review` skill / a code-review subagent) against the branch diff. Resolve any blocking findings, especially:
- The PAT never appears in `.git/config`, process logs, or error strings.
- The DB lock is never held across the clone `.await`.
- The command is handled in exactly one place (`handle_app_core_task_project_command`) and present in `SIDECAR_BACKED_COMMANDS`.

- [ ] **Step 6: Manual smoke (user-run)**

Ask the user to run `pnpm electron:dev` and: add a public repo via URL into an empty parent folder (succeeds), retry the same target (rejected as already-exists), and add a private repo they have access to (succeeds using the saved token). Per project convention, do not launch the Electron app yourself.

---

## Self-Review

**Spec coverage:**
- Toggle Local/GitHub in the dialog → Task 8. ✓
- URL input (HTTPS/SSH/shorthand) → Task 1 (parse) + Task 7 (preview) + Task 8 (input). ✓
- Parent-folder picker → Task 8 (reuses `selectDirectory`). ✓
- Derived, editable name → Task 7 helper + Task 8 wiring. ✓
- Target-path preview → Task 8 (`computeTargetPathPreview`). ✓
- Collision check (disk OR registered project) → Task 2 + Task 3. ✓
- Access pre-check with stored PAT → Task 5 + Task 6 orchestrator. ✓
- Clone via git binary; ephemeral, never-persisted auth header; SSH uses ambient keys → Task 4. ✓
- Rollback on failure + per-target lock → Task 4 (`cleanup_partial_clone`) + Task 6 (lock, rollback on insert failure). ✓
- Create project via existing `create_project` → Task 6. ✓
- IPC wrapper + Electron allowlist → Task 7 + Task 6. ✓
- Error messages for each failure mode → Tasks 1/3/4/6. ✓
- No schema change → confirmed (reuses `projects`). ✓
- Testing business logic only, no CSS assertions → Tasks 1–8. ✓

**Placeholder scan:** No TBD/TODO; every code step has concrete code and every run step has a command + expected result.

**Type consistency:** `ParsedRepo`, `parse_repo_url`, `resolve_target_path`, `check_target_available`, `project_with_path_exists`, `auth_header_value`, `build_clone_args`, `sanitize_clone_error`, `clone_repo`, `cleanup_partial_clone`, `classify_repo_access_status`/`RepoAccess`, `check_repo_access`, `create_project_from_git`, `deriveRepoNameFromUrl`, `createProjectFromGit`, `computeTargetPathPreview`, `canSubmitGithub` — names are used identically across their producing and consuming tasks. Command name `create_project_from_git` and payload keys `url`/`parentDir`/`name` match between IPC wrapper (Task 7), Electron allowlist (Task 6), and the Rust arm (Task 6).

**Known risk called out inline:** the DB-lock/deadlock hazard in `handle_app_unmatched_command` is documented in Task 6 with the concrete fix (handle in `handle_app_core_task_project_command`).
