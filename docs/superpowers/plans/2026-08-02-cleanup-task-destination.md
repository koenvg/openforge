# Cleanup Task Destination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When Code Cleanup Tasks is enabled, let each project choose whether cleanup items are filed as OpenForge backlog tasks (today's behavior) or as GitHub Issues.

**Architecture:** Add a per-project `code_cleanup_destination` setting (global default, project override). The agent's `openforge task create --label cleanup` command is unchanged; the local server's create-task handler resolves the project's destination and, for `github_issues`, files a GitHub issue via the existing `github_token` + `github_client` and skips the backlog task. Selecting GitHub Issues in settings is gated by a readiness check so failures are prevented up front; a runtime fallback (create the backlog task + warn) covers state that changes after selection.

**Tech Stack:** Rust (axum HTTP server, rusqlite, reqwest GitHub client), Svelte 5 (runes) + TypeScript renderer, Electron main sidecar bridge, Node CLI (`cli.js`), vitest + `cargo test`.

## Global Constraints

- **Commits:** never mention Claude/Anthropic; never add a Claude co-author line. Conventional commit messages.
- **TDD:** write the failing test first for business logic; run it red, then implement to green. I/O-only glue (GitHub HTTP calls, axum handler wiring, Electron bridge list, CLI print) has no unit-test harness here — verify those with `cargo build` / `pnpm exec tsc --noEmit` and the manual smoke test in Task 13. Never assert on CSS/Tailwind/DOM styling.
- **IPC arg casing:** frontend `invoke("snake_case_command", { camelCaseArgs })`. New command `check_github_issues_ready` takes `{ projectId }`.
- **New renderer→sidecar command MUST be added to `SIDECAR_BACKED_COMMANDS`** in `src/electron/backendBridge.ts` or it silently won't forward.
- **Types:** `import type` (verbatimModuleSyntax); nullable fields use `T | null`, not optional; string-enum uses `'openforge' | 'github_issues'`.
- **Rust command boundaries** return `Result<T, String>` with `.map_err(|e| format!(...))`; DB domain methods live in `impl super::Database`.
- **github_token source is the keychain** (`github_runtime::auth::github_token()`), not db config — use it for both the readiness check and issue creation so they agree.
- **Destination is `levels: ['global', 'project']`** (NOT task) — resolved at file-time on the backend. `taskDefaults.ts` needs no change.
- **Rust test filter:** from `src-tauri/`, `cargo test <filter>` (one filter, before `--`). **Vitest:** `pnpm exec vitest run <path>` (no `--` separator forms).

---

## File Structure

**Rust (`src-tauri/`):**
- `src/db/projects.rs` — add `resolve_cleanup_destination(project_id)` (mirrors `resolve_ai_provider`).
- `src/db/task_config.rs` (test module) — add resolver precedence test.
- `src/http_server/legacy_transport/task_routes.rs` — `decide_cleanup_route`, `build_cleanup_issue_content`, `create_backlog_task` helper, routing in `create_task_handler`; unit tests for the two pure fns.
- `src/http_server/legacy_transport/models.rs` — extend `CreateTaskResponse` with optional `issue_url` / `warning`.
- `src/github_client/issues.rs` (new) — `create_issue`, `ensure_label` on `GitHubClient`.
- `src/github_client/types.rs` — `CreateIssueRequest`, `CreatedIssue`, `CreateLabelRequest`.
- `src/github_client/mod.rs` — `mod issues;`.
- `src/github_runtime/issues.rs` (new) — `create_cleanup_issue`, `check_github_issues_ready`, `IssuesReadiness`, pure `evaluate_issues_readiness`; unit tests for the evaluator.
- `src/github_runtime.rs` — `mod issues;` + re-exports.
- `src/app_invoke/github_review.rs` — `"check_github_issues_ready"` match arm.
- `src/openforge-cli/cli.js` — surface `warning` to stderr + non-zero exit.

**Frontend (`src/`):**
- `src/lib/hierarchicalSettings.ts` — `showWhen?` field, `code_cleanup_destination` select entry, `isSettingVisible` predicate (+ test).
- `src/components/settings/HierarchicalSettingsCard.svelte` — honor `isSettingVisible`.
- `src/lib/settingsConfig.ts` / `settingsSaver.ts` — new key load/default/save (+ test updates).
- `src/lib/ipc.ts` — `checkGithubIssuesReady` wrapper.
- `src/electron/backendBridge.ts` — add command to `SIDECAR_BACKED_COMMANDS`.
- `src/lib/cleanupDestinationGuard.ts` (new) — `validateDestinationChange` (+ test).
- `src/components/settings/SettingsView.svelte` — new state, values map, save payload, onMount seed, gated change handlers, inline reason.

---

## Task 1: `resolve_cleanup_destination` (DB resolver)

**Files:**
- Modify: `src-tauri/src/db/projects.rs` (add method after `resolve_ai_provider`, ~line 244)
- Test: `src-tauri/src/db/task_config.rs` (existing `#[cfg(test)]` module, ~line 87)

**Interfaces:**
- Produces: `Database::resolve_cleanup_destination(&self, project_id: &str) -> String` — returns `project_config ?? global config ?? "openforge"`.

- [ ] **Step 1: Write the failing test** (append inside the existing `#[cfg(test)] mod tests` in `task_config.rs`)

```rust
    #[test]
    fn test_resolve_cleanup_destination_precedence() {
        let (db, path) = make_test_db("resolve_cleanup_destination");
        let project = db.create_project("P", "/tmp/p").unwrap();
        let key = "code_cleanup_destination";

        // Nothing set -> default openforge.
        assert_eq!(db.resolve_cleanup_destination(&project.id), "openforge");
        // Global set.
        db.set_config(key, "github_issues").unwrap();
        assert_eq!(db.resolve_cleanup_destination(&project.id), "github_issues");
        // Project override beats global.
        db.set_project_config(&project.id, key, "openforge").unwrap();
        assert_eq!(db.resolve_cleanup_destination(&project.id), "openforge");

        drop(db);
        let _ = std::fs::remove_file(&path);
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `src-tauri/`): `cargo test resolve_cleanup_destination`
Expected: FAIL — `no method named resolve_cleanup_destination`.

- [ ] **Step 3: Implement the resolver** (in `projects.rs`, immediately after `resolve_ai_provider`)

```rust
    /// Resolve the cleanup destination for a project.
    /// Checks project_config first, falls back to global config, then "openforge".
    pub fn resolve_cleanup_destination(&self, project_id: &str) -> String {
        if !project_id.is_empty() {
            if let Ok(Some(dest)) = self.get_project_config(project_id, "code_cleanup_destination") {
                if !dest.is_empty() {
                    return dest;
                }
            }
        }
        self.get_config("code_cleanup_destination")
            .ok()
            .flatten()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "openforge".to_string())
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test resolve_cleanup_destination`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/projects.rs src-tauri/src/db/task_config.rs
git commit -m "feat(cleanup): resolve cleanup destination per project"
```

---

## Task 2: `decide_cleanup_route` (routing decision)

**Files:**
- Modify: `src-tauri/src/http_server/legacy_transport/task_routes.rs` (add fn + enum near top, and a test module at bottom)

**Interfaces:**
- Produces: `enum CleanupRoute { Backlog, GithubIssue }` and `fn decide_cleanup_route(labels: &[String], destination: &str) -> CleanupRoute` (both `pub(in crate::http_server)`).

- [ ] **Step 1: Write the failing test** (append a `#[cfg(test)]` module at the end of `task_routes.rs`)

```rust
#[cfg(test)]
mod cleanup_route_tests {
    use super::*;

    #[test]
    fn cleanup_label_with_github_destination_routes_to_issue() {
        assert_eq!(
            decide_cleanup_route(&["cleanup".to_string()], "github_issues"),
            CleanupRoute::GithubIssue
        );
    }

    #[test]
    fn cleanup_label_with_openforge_destination_routes_to_backlog() {
        assert_eq!(
            decide_cleanup_route(&["cleanup".to_string()], "openforge"),
            CleanupRoute::Backlog
        );
    }

    #[test]
    fn non_cleanup_label_routes_to_backlog_even_for_github() {
        assert_eq!(
            decide_cleanup_route(&["chore".to_string()], "github_issues"),
            CleanupRoute::Backlog
        );
    }

    #[test]
    fn empty_labels_route_to_backlog() {
        assert_eq!(decide_cleanup_route(&[], "github_issues"), CleanupRoute::Backlog);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test cleanup_route`
Expected: FAIL — `cannot find function decide_cleanup_route`.

- [ ] **Step 3: Implement** (near the top of `task_routes.rs`, after the imports)

```rust
/// Where a create_task request should be routed.
#[derive(Debug, PartialEq)]
pub(in crate::http_server) enum CleanupRoute {
    Backlog,
    GithubIssue,
}

/// Cleanup-labeled requests go to GitHub Issues only when the project's
/// destination is "github_issues"; everything else creates a backlog task.
pub(in crate::http_server) fn decide_cleanup_route(
    labels: &[String],
    destination: &str,
) -> CleanupRoute {
    let is_cleanup = labels.iter().any(|l| l == "cleanup");
    if is_cleanup && destination == "github_issues" {
        CleanupRoute::GithubIssue
    } else {
        CleanupRoute::Backlog
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test cleanup_route`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server/legacy_transport/task_routes.rs
git commit -m "feat(cleanup): add cleanup route decision"
```

---

## Task 3: `build_cleanup_issue_content` (prompt → issue title/body)

**Files:**
- Modify: `src-tauri/src/http_server/legacy_transport/task_routes.rs` (add fn + extend the test module)

**Interfaces:**
- Produces: `fn build_cleanup_issue_content(initial_prompt: &str, depends_on: &[String]) -> (String, String)` returning `(title, body)`, `pub(in crate::http_server)`.

- [ ] **Step 1: Write the failing tests** (add to the `cleanup_route_tests` module — or a new `issue_content_tests` module — in `task_routes.rs`)

```rust
#[cfg(test)]
mod issue_content_tests {
    use super::*;

    #[test]
    fn title_is_first_nonempty_line() {
        let (title, _) = build_cleanup_issue_content("Split the God object\nmore detail", &[]);
        assert_eq!(title, "Split the God object");
    }

    #[test]
    fn empty_prompt_gets_default_title() {
        let (title, _) = build_cleanup_issue_content("   \n  ", &[]);
        assert_eq!(title, "Code cleanup");
    }

    #[test]
    fn long_title_is_truncated_with_ellipsis() {
        let long = "x".repeat(200);
        let (title, _) = build_cleanup_issue_content(&long, &[]);
        assert!(title.chars().count() <= 80);
        assert!(title.ends_with('…'));
    }

    #[test]
    fn body_includes_originating_task_footer() {
        let (_, body) = build_cleanup_issue_content("Fix this", &["T-42".to_string()]);
        assert!(body.contains("Fix this"));
        assert!(body.contains("T-42"));
    }

    #[test]
    fn body_has_no_footer_without_dependencies() {
        let (_, body) = build_cleanup_issue_content("Fix this", &[]);
        assert_eq!(body, "Fix this");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test issue_content`
Expected: FAIL — `cannot find function build_cleanup_issue_content`.

- [ ] **Step 3: Implement** (in `task_routes.rs`, near `decide_cleanup_route`)

```rust
/// Build the GitHub issue title and body for a cleanup task.
/// Title = first non-empty line of the prompt (truncated); body = full prompt
/// plus a footer referencing the originating task ids (a GitHub issue can't
/// carry an OpenForge dependency edge).
pub(in crate::http_server) fn build_cleanup_issue_content(
    initial_prompt: &str,
    depends_on: &[String],
) -> (String, String) {
    const MAX_TITLE: usize = 80;

    let first_line = initial_prompt
        .lines()
        .map(|l| l.trim())
        .find(|l| !l.is_empty())
        .unwrap_or("");

    let title = if first_line.is_empty() {
        "Code cleanup".to_string()
    } else if first_line.chars().count() > MAX_TITLE {
        let truncated: String = first_line.chars().take(MAX_TITLE - 1).collect();
        format!("{truncated}…")
    } else {
        first_line.to_string()
    };

    let mut body = initial_prompt.trim().to_string();
    if !depends_on.is_empty() {
        body.push_str(&format!(
            "\n\n---\nReported by OpenForge code cleanup while working on: {}",
            depends_on.join(", ")
        ));
    }

    (title, body)
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test issue_content`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/http_server/legacy_transport/task_routes.rs
git commit -m "feat(cleanup): map cleanup prompt to issue title and body"
```

---

## Task 4: GitHub `create_issue` + `ensure_label` + runtime `create_cleanup_issue`

**Files:**
- Create: `src-tauri/src/github_client/issues.rs`
- Modify: `src-tauri/src/github_client/mod.rs` (add `mod issues;`)
- Modify: `src-tauri/src/github_client/types.rs` (add request/response types)
- Create: `src-tauri/src/github_runtime/issues.rs`
- Modify: `src-tauri/src/github_runtime.rs` (add `mod issues;` + re-export)

**Interfaces:**
- Consumes: `GitHubClient::github_request`, `send_github`, `github_get`, `api_error_from_response`; `github_runtime::auth::github_token()`; `github_runtime::repo_resolution::get_project_repo(&Mutex<db::Database>, &str) -> Result<Option<ProjectRepo>, String>` (`ProjectRepo { owner, name }`).
- Produces:
  - `GitHubClient::create_issue(&self, owner, repo, title, body, labels: Vec<String>, token) -> Result<CreatedIssue, GitHubError>` (`CreatedIssue { html_url: String, number: i64 }`).
  - `GitHubClient::ensure_label(&self, owner, repo, name, token)` (best-effort, no error surfaced).
  - `github_runtime::create_cleanup_issue(client, db: &Mutex<db::Database>, project_id, title, body) -> Result<String, String>` (returns issue `html_url`).

> **Testing note:** the GitHub client hits `api.github.com` directly with no injectable base URL and no HTTP-mock harness in this repo. Per the Global Constraints, this task's I/O is verified by `cargo build` + the Task 13 smoke test; the pure prompt→content mapping it relies on is already tested in Task 3.

- [ ] **Step 1: Add types** to `src-tauri/src/github_client/types.rs`

```rust
/// Request body for creating an issue.
#[derive(Debug, Serialize)]
pub(crate) struct CreateIssueRequest {
    pub title: String,
    pub body: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub labels: Vec<String>,
}

/// Subset of the created issue we need back.
#[derive(Debug, Deserialize)]
pub struct CreatedIssue {
    pub html_url: String,
    pub number: i64,
}

/// Request body for creating a repo label.
#[derive(Debug, Serialize)]
pub(crate) struct CreateLabelRequest {
    pub name: String,
    pub color: String,
}
```

- [ ] **Step 2: Create `src-tauri/src/github_client/issues.rs`**

```rust
use super::types::{CreateIssueRequest, CreateLabelRequest, CreatedIssue};
use super::{GitHubClient, GitHubError};

impl GitHubClient {
    /// Create an issue on {owner}/{repo}. Labels should already exist (see
    /// `ensure_label`); with push access GitHub applies them, otherwise it
    /// drops them silently rather than failing.
    pub async fn create_issue(
        &self,
        owner: &str,
        repo: &str,
        title: &str,
        body: &str,
        labels: Vec<String>,
        token: &str,
    ) -> Result<CreatedIssue, GitHubError> {
        let url = format!("https://api.github.com/repos/{owner}/{repo}/issues");
        let request_body = CreateIssueRequest {
            title: title.to_string(),
            body: body.to_string(),
            labels,
        };

        let response = self
            .send_github(
                self.github_request(reqwest::Method::POST, &url, token)
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

    /// Best-effort: ensure a label exists so `create_issue` can apply it.
    /// Never surfaces an error — labeling is non-critical.
    pub async fn ensure_label(&self, owner: &str, repo: &str, name: &str, token: &str) {
        let get_url = format!("https://api.github.com/repos/{owner}/{repo}/labels/{name}");
        if let Ok(resp) = self.github_get(&get_url, token).send().await {
            if resp.status().is_success() {
                return;
            }
        }
        let create_url = format!("https://api.github.com/repos/{owner}/{repo}/labels");
        let body = CreateLabelRequest {
            name: name.to_string(),
            color: "ededed".to_string(),
        };
        let _ = self
            .send_github(
                self.github_request(reqwest::Method::POST, &create_url, token)
                    .json(&body),
            )
            .await;
    }
}
```

- [ ] **Step 3: Register the module** — add to `src-tauri/src/github_client/mod.rs` alongside the other `mod` lines (e.g. after `mod graphql;`)

```rust
mod issues;
```

- [ ] **Step 4: Create `src-tauri/src/github_runtime/issues.rs`** (runtime wrapper; the readiness fn is added in Task 5)

```rust
use std::sync::Mutex;

use super::auth::github_token;
use super::repo_resolution::get_project_repo;
use crate::db;
use crate::github_client::GitHubClient;

/// File a cleanup item as a GitHub issue in the project's repo. Returns the
/// issue's html_url. Errors (no token, unresolved repo, API failure) surface as
/// Strings for the caller to handle (fallback + warning).
pub async fn create_cleanup_issue(
    github_client: &GitHubClient,
    db: &Mutex<db::Database>,
    project_id: &str,
    title: &str,
    body: &str,
) -> Result<String, String> {
    let token = github_token()?;
    let repo = get_project_repo(db, project_id)?.ok_or_else(|| {
        "Could not resolve a GitHub repository from this project's git remote".to_string()
    })?;

    github_client
        .ensure_label(&repo.owner, &repo.name, "cleanup", &token)
        .await;

    let issue = github_client
        .create_issue(
            &repo.owner,
            &repo.name,
            title,
            body,
            vec!["cleanup".to_string()],
            &token,
        )
        .await
        .map_err(|e| format!("Failed to create GitHub issue: {e}"))?;

    Ok(issue.html_url)
}
```

- [ ] **Step 5: Register + re-export** in `src-tauri/src/github_runtime.rs` (add `mod issues;` with the other `mod` lines and a `pub use`)

```rust
mod issues;
```
```rust
pub use issues::create_cleanup_issue;
```

- [ ] **Step 6: Build to verify it compiles**

Run (from `src-tauri/`): `cargo build`
Expected: compiles clean (no unused-import or type errors). If `format!("{e}")` fails for `GitHubError`, use `{e}` only if `Display` is implemented (it is — mirrored from `pr_actions.rs`); otherwise switch to `{e:?}`.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/github_client/ src-tauri/src/github_runtime.rs src-tauri/src/github_runtime/issues.rs
git commit -m "feat(cleanup): create github issues for cleanup items"
```

---

## Task 5: Readiness check (`evaluate_issues_readiness` + `check_github_issues_ready` + command)

**Files:**
- Modify: `src-tauri/src/github_runtime/issues.rs` (add evaluator, runtime fn, type, tests)
- Modify: `src-tauri/src/github_runtime.rs` (re-export)
- Modify: `src-tauri/src/app_invoke/github_review.rs` (add match arm)

**Interfaces:**
- Consumes: `GitHubClient::check_repo_access(owner, repo, token) -> Result<bool, GitHubError>`; `get_project_repo`; `github_token()`.
- Produces:
  - `struct IssuesReadiness { ready: bool, reason: Option<String> }` (Serialize).
  - pure `fn evaluate_issues_readiness(token_present: bool, project_scope: bool, repo: Option<(String, String)>, access: Option<bool>) -> IssuesReadiness`.
  - `async fn check_github_issues_ready(client, db: &Mutex<db::Database>, project_id: Option<String>) -> Result<IssuesReadiness, String>`.
  - Command `"check_github_issues_ready"` with payload `{ projectId: string | null }`.

- [ ] **Step 1: Write the failing evaluator tests** (append to `src-tauri/src/github_runtime/issues.rs`)

```rust
#[cfg(test)]
mod readiness_tests {
    use super::*;

    #[test]
    fn missing_token_is_not_ready() {
        let r = evaluate_issues_readiness(false, true, Some(("o".into(), "r".into())), Some(true));
        assert!(!r.ready);
        assert!(r.reason.unwrap().to_lowercase().contains("token"));
    }

    #[test]
    fn global_scope_ready_with_token() {
        let r = evaluate_issues_readiness(true, false, None, None);
        assert!(r.ready);
        assert!(r.reason.is_none());
    }

    #[test]
    fn project_scope_unresolved_repo_is_not_ready() {
        let r = evaluate_issues_readiness(true, true, None, None);
        assert!(!r.ready);
        assert!(r.reason.unwrap().to_lowercase().contains("resolve"));
    }

    #[test]
    fn project_scope_denied_access_is_not_ready() {
        let r = evaluate_issues_readiness(true, true, Some(("o".into(), "r".into())), Some(false));
        assert!(!r.ready);
    }

    #[test]
    fn project_scope_access_ok_is_ready() {
        let r = evaluate_issues_readiness(true, true, Some(("o".into(), "r".into())), Some(true));
        assert!(r.ready);
        assert!(r.reason.is_none());
    }
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `cargo test readiness_tests`
Expected: FAIL — `cannot find function evaluate_issues_readiness`.

- [ ] **Step 3: Implement the type, evaluator, and runtime fn** (in `issues.rs`; add `use serde::Serialize;` at top)

```rust
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct IssuesReadiness {
    pub ready: bool,
    pub reason: Option<String>,
}

/// Pure readiness decision — no I/O.
/// - `token_present`: is a github_token configured?
/// - `project_scope`: true for a project-level choice, false for the global default.
/// - `repo`: resolved (owner, name) for a project, else None.
/// - `access`: Some(result) from check_repo_access, or None when not checked / inconclusive.
pub fn evaluate_issues_readiness(
    token_present: bool,
    project_scope: bool,
    repo: Option<(String, String)>,
    access: Option<bool>,
) -> IssuesReadiness {
    if !token_present {
        return IssuesReadiness {
            ready: false,
            reason: Some("No GitHub token configured. Add one in Credentials.".to_string()),
        };
    }
    if !project_scope {
        return IssuesReadiness { ready: true, reason: None };
    }
    let Some((owner, name)) = repo else {
        return IssuesReadiness {
            ready: false,
            reason: Some(
                "Couldn't resolve a GitHub repository from this project's git remote.".to_string(),
            ),
        };
    };
    match access {
        Some(true) => IssuesReadiness { ready: true, reason: None },
        Some(false) => IssuesReadiness {
            ready: false,
            reason: Some(format!("The configured GitHub token can't access {owner}/{name}.")),
        },
        None => IssuesReadiness {
            ready: false,
            reason: Some(format!("Couldn't verify access to {owner}/{name}.")),
        },
    }
}

/// Gather inputs (token, repo, access) and evaluate readiness for filing issues.
pub async fn check_github_issues_ready(
    github_client: &GitHubClient,
    db: &Mutex<db::Database>,
    project_id: Option<String>,
) -> Result<IssuesReadiness, String> {
    let token = match github_token() {
        Ok(t) => t,
        Err(_) => {
            return Ok(evaluate_issues_readiness(false, project_id.is_some(), None, None));
        }
    };

    let Some(pid) = project_id else {
        return Ok(evaluate_issues_readiness(true, false, None, None));
    };

    let repo_tuple = get_project_repo(db, &pid)?.map(|r| (r.owner, r.name));

    let access = match &repo_tuple {
        Some((owner, name)) => match github_client.check_repo_access(owner, name, &token).await {
            Ok(v) => Some(v),
            Err(_) => None,
        },
        None => None,
    };

    Ok(evaluate_issues_readiness(true, true, repo_tuple, access))
}
```

- [ ] **Step 4: Run to verify the evaluator tests pass**

Run: `cargo test readiness_tests`
Expected: PASS (5 tests).

- [ ] **Step 5: Re-export** in `src-tauri/src/github_runtime.rs`

```rust
pub use issues::{check_github_issues_ready, create_cleanup_issue};
```

- [ ] **Step 6: Add the command arm** in `src-tauri/src/app_invoke/github_review.rs`, immediately before the final `_ => return Ok(None),`

```rust
        "check_github_issues_ready" => {
            let project_id = request
                .payload
                .get("projectId")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            to_app_value(
                crate::github_runtime::check_github_issues_ready(
                    &state.github_client,
                    &state.db,
                    project_id,
                )
                .await
                .map_err(runtime_error)?,
            )?
        }
```

- [ ] **Step 7: Build to verify the wiring compiles**

Run: `cargo build`
Expected: compiles clean.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/src/github_runtime.rs src-tauri/src/github_runtime/issues.rs src-tauri/src/app_invoke/github_review.rs
git commit -m "feat(cleanup): add github issues readiness check command"
```

---

## Task 6: Route `create_task_handler` + extend `CreateTaskResponse`

**Files:**
- Modify: `src-tauri/src/http_server/legacy_transport/models.rs` (`CreateTaskResponse`)
- Modify: `src-tauri/src/http_server/legacy_transport/task_routes.rs` (`create_backlog_task` helper + routing in `create_task_handler`)

**Interfaces:**
- Consumes: `Database::resolve_cleanup_destination`, `decide_cleanup_route`, `build_cleanup_issue_content`, `github_runtime::create_cleanup_issue`, `emit_task_changed`.
- Produces: `CreateTaskResponse { task_id: String, project_id: Option<String>, status: String, issue_url: Option<String>, warning: Option<String> }`.

> **Testing note:** the handler is integration-level (HTTP + git + GitHub). Its decision pieces are unit-tested in Tasks 1–3; the wiring is verified by `cargo build` and the Task 13 smoke test. On the GitHub-success path `task_id` is `""` paired with `status: "issue_created"` and an `issue_url` — chosen to keep `task_id: String` (no ripple to other constructors).

- [ ] **Step 1: Grep for other `CreateTaskResponse` constructors** so the field additions don't miss a site

Run (from repo root): `grep -rn "CreateTaskResponse" src-tauri/src`
Expected: only `models.rs` (definition) and `task_routes.rs` (single construction). If any other site exists, add `issue_url: None, warning: None` there in Step 4.

- [ ] **Step 2: Extend `CreateTaskResponse`** in `models.rs`

```rust
/// Response containing the created task ID
#[derive(Debug, Clone, Serialize)]
pub struct CreateTaskResponse {
    pub task_id: String,
    pub project_id: Option<String>,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub issue_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
}
```

- [ ] **Step 3: Add the `create_backlog_task` helper** in `task_routes.rs` (factor out the existing create+deps+labels+emit logic)

```rust
/// Create a backlog task with the request's dependencies and labels, emitting
/// the task-changed event. Returns (task_id, project_id).
fn create_backlog_task(
    state: &AppState,
    project_id: &str,
    request: &CreateTaskRequest,
) -> Result<(String, Option<String>), (StatusCode, String)> {
    let db = state.db.lock().unwrap();
    let task = db
        .create_task(&request.initial_prompt, "backlog", Some(project_id), None, None)
        .map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to create task: {}", e),
            )
        })?;
    let task_id = task.id.clone();
    let task_project_id = task.project_id.clone();

    if !request.depends_on.is_empty() {
        if let Err(e) = db.set_task_dependencies(&task_id, &request.depends_on) {
            let _ = db.hard_delete_task(&task_id);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to set task dependencies: {e}"),
            ));
        }
    }

    if !request.labels.is_empty() {
        if let Err(e) = db.set_task_labels(&task_id, &request.labels) {
            let _ = db.hard_delete_task(&task_id);
            return Err((
                StatusCode::BAD_REQUEST,
                format!("Failed to set task labels: {e}"),
            ));
        }
    }

    drop(db);
    emit_task_changed(state, "created", &task_id, task_project_id.as_deref());
    Ok((task_id, task_project_id))
}
```

- [ ] **Step 4: Rewrite `create_task_handler`** to route via the destination

```rust
pub async fn create_task_handler(
    State(state): State<AppState>,
    Json(request): Json<CreateTaskRequest>,
) -> Result<Json<CreateTaskResponse>, (StatusCode, String)> {
    // Resolve project + destination under the lock, then release it before any await.
    let (project_id, destination) = {
        let db = state.db.lock().unwrap();
        let project_id = resolve_project_id(
            &db,
            request.project_id.as_deref(),
            request.worktree.as_deref(),
        )
        .map_err(|msg| (StatusCode::UNPROCESSABLE_ENTITY, msg))?;
        let destination = db.resolve_cleanup_destination(&project_id);
        (project_id, destination)
    };

    if decide_cleanup_route(&request.labels, &destination) == CleanupRoute::GithubIssue {
        let (title, body) =
            build_cleanup_issue_content(&request.initial_prompt, &request.depends_on);
        match crate::github_runtime::create_cleanup_issue(
            &state.github_client,
            &state.db,
            &project_id,
            &title,
            &body,
        )
        .await
        {
            Ok(issue_url) => {
                return Ok(Json(CreateTaskResponse {
                    task_id: String::new(),
                    project_id: Some(project_id),
                    status: "issue_created".to_string(),
                    issue_url: Some(issue_url),
                    warning: None,
                }));
            }
            Err(e) => {
                // Fail loudly, but keep it in OpenForge too.
                let (task_id, task_project_id) =
                    create_backlog_task(&state, &project_id, &request)?;
                return Ok(Json(CreateTaskResponse {
                    task_id,
                    project_id: task_project_id,
                    status: "created".to_string(),
                    issue_url: None,
                    warning: Some(format!(
                        "GitHub issue creation failed; filed as an OpenForge task instead: {e}"
                    )),
                }));
            }
        }
    }

    let (task_id, task_project_id) = create_backlog_task(&state, &project_id, &request)?;
    Ok(Json(CreateTaskResponse {
        task_id,
        project_id: task_project_id,
        status: "created".to_string(),
        issue_url: None,
        warning: None,
    }))
}
```

Ensure `AppState` is imported in `task_routes.rs` (the file already imports `crate::http_server::{AppState, TaskOperation}` per its header).

- [ ] **Step 5: Build + run the routing/content tests**

Run: `cargo build && cargo test cleanup_route && cargo test issue_content`
Expected: compiles; all pure-fn tests still PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/http_server/legacy_transport/models.rs src-tauri/src/http_server/legacy_transport/task_routes.rs
git commit -m "feat(cleanup): route cleanup task creation to github issues"
```

---

## Task 7: CLI surfaces the fallback warning

**Files:**
- Modify: `src-tauri/src/openforge-cli/cli.js` (`createTask`)

**Interfaces:**
- Consumes: the `warning` field on the `/create_task` response (Task 6).

> **Testing note:** no JS unit-test harness for `cli.js` in this repo; verify by reading the diff and the Task 13 smoke test (fallback prints a warning + non-zero exit).

- [ ] **Step 1: Update `createTask`** to surface a warning

```js
async function createTask(flags) {
  const dependsOn = dependencyIdsFromFlag(flags);
  const labels = labelNamesFromFlag(flags);
  const payload = {
    initial_prompt: requireFlag(flags, 'initialPrompt'),
    project_id: optionalString(flags, 'projectId'),
    worktree: optionalString(flags, 'worktree'),
    depends_on: dependsOn.length > 0 ? dependsOn : undefined,
    labels: labels.length > 0 ? labels : undefined,
  };
  const response = await requestJson('/create_task', { method: 'POST', body: JSON.stringify(payload) });
  printJson(response);
  if (response && response.warning) {
    process.stderr.write(`${response.warning}\n`);
    process.exitCode = 1;
  }
}
```

- [ ] **Step 2: Sanity-check syntax**

Run (from repo root): `node --check src-tauri/src/openforge-cli/cli.js`
Expected: no output (valid syntax).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/openforge-cli/cli.js
git commit -m "feat(cleanup): surface github issue fallback warning in cli"
```

---

## Task 8: `showWhen` field, `isSettingVisible` predicate, destination select

**Files:**
- Modify: `src/lib/hierarchicalSettings.ts`
- Modify: `src/components/settings/HierarchicalSettingsCard.svelte`
- Test: `src/lib/hierarchicalSettings.test.ts`

**Interfaces:**
- Produces: `HierarchicalSettingDef.showWhen?: { key: string; equals: string }`; `isSettingVisible(def, values): boolean`; a `code_cleanup_destination` select entry in `HIERARCHICAL_SETTINGS`.

- [ ] **Step 1: Write the failing tests** (append to `src/lib/hierarchicalSettings.test.ts`; update the import to include `isSettingVisible`)

```ts
import { HIERARCHICAL_SETTINGS, isSettingVisible } from './hierarchicalSettings'

describe('isSettingVisible', () => {
  const destination = HIERARCHICAL_SETTINGS.find((s) => s.key === 'code_cleanup_destination')!

  it('registers a code_cleanup_destination select with openforge + github_issues options', () => {
    expect(destination).toBeDefined()
    expect(destination.control).toBe('select')
    expect(destination.default).toBe('openforge')
    expect(destination.options?.map((o) => o.value)).toEqual(['openforge', 'github_issues'])
    expect(destination.levels).toEqual(['global', 'project'])
  })

  it('hides the destination when cleanup is off', () => {
    expect(isSettingVisible(destination, { code_cleanup_tasks_enabled: 'false' })).toBe(false)
  })

  it('shows the destination when cleanup is on', () => {
    expect(isSettingVisible(destination, { code_cleanup_tasks_enabled: 'true' })).toBe(true)
  })

  it('always shows a setting without showWhen', () => {
    const toggle = HIERARCHICAL_SETTINGS.find((s) => s.key === 'handoff_notes_enabled')!
    expect(isSettingVisible(toggle, {})).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/hierarchicalSettings.test.ts`
Expected: FAIL — `isSettingVisible` not exported / destination undefined.

- [ ] **Step 3: Add `showWhen` to the interface and the predicate; register the select** in `src/lib/hierarchicalSettings.ts`

Interface (add the field):
```ts
export interface HierarchicalSettingDef {
  key: string
  label: string
  description: string
  control: SettingControl
  levels: SettingLevel[]
  default: string
  options?: { value: string; label: string }[]
  showWhen?: { key: string; equals: string }
}
```

Registry entry (insert right after the `code_cleanup_tasks_enabled` entry):
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
    showWhen: { key: 'code_cleanup_tasks_enabled', equals: 'true' },
  },
```

Predicate (add after `computeEffectiveProjectSettings`):
```ts
/** Whether a setting should be shown given the current effective values.
 *  A setting with `showWhen` is visible only when values[showWhen.key] === showWhen.equals. */
export function isSettingVisible(
  def: HierarchicalSettingDef,
  values: Record<string, string>,
): boolean {
  if (!def.showWhen) return true
  return values[def.showWhen.key] === def.showWhen.equals
}
```

- [ ] **Step 4: Honor visibility in the card** — in `src/components/settings/HierarchicalSettingsCard.svelte`, update the import and the `visibleSettings` derivation

```ts
	import { HIERARCHICAL_SETTINGS, isSettingVisible } from '../../lib/hierarchicalSettings'
```
```ts
	const visibleSettings = $derived(
		HIERARCHICAL_SETTINGS.filter(
			(setting) =>
				setting.levels.includes(mode as SettingLevel) &&
				!excludeKeys.includes(setting.key) &&
				isSettingVisible(setting, values),
		),
	)
```

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/hierarchicalSettings.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/hierarchicalSettings.ts src/lib/hierarchicalSettings.test.ts src/components/settings/HierarchicalSettingsCard.svelte
git commit -m "feat(cleanup): add cleanup destination setting with conditional visibility"
```

---

## Task 9: Persist `code_cleanup_destination` (config load + save)

**Files:**
- Modify: `src/lib/settingsConfig.ts`
- Modify: `src/lib/settingsSaver.ts`
- Test: `src/lib/settingsConfig.test.ts`, `src/lib/settingsSaver.test.ts`

**Interfaces:**
- Produces: `GlobalSettingsConfig.codeCleanupDestination: 'openforge' | 'github_issues'`; `GlobalSettingsSavePayload.codeCleanupDestination`; persisted key `code_cleanup_destination`.

- [ ] **Step 1: Update the loader test** in `src/lib/settingsConfig.test.ts` — extend the main `loadGlobalSettings` test to a 9th `getConfig` (append at the END so positions 1–8 are unchanged)

In the `.mockResolvedValueOnce` chain, add a 9th line at the end:
```ts
        .mockResolvedValueOnce('github_issues')
```
Update the call-count and expected object:
```ts
      expect(getConfig).toHaveBeenCalledTimes(9)
      expect(result).toEqual({
        taskIdPrefix: 'T-',
        githubToken: 'gh-token',
        codeCleanupTasksEnabled: true,
        taskDisplayTitleMetadataUpdatesEnabled: true,
        githubPollInterval: 45,
        handoffNotesEnabled: true,
        useWorktrees: false,
        aiProvider: 'opencode',
        codeCleanupDestination: 'github_issues',
      })
```
Also, in any other test in this file that asserts the full result object of `loadGlobalSettings`, add `codeCleanupDestination: 'openforge'` to the expected object (the default when the mock returns null/undefined).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/settingsConfig.test.ts`
Expected: FAIL — result missing `codeCleanupDestination` / call count mismatch.

- [ ] **Step 3: Implement in `src/lib/settingsConfig.ts`**

Interface (`GlobalSettingsConfig`) — add:
```ts
  codeCleanupDestination: 'openforge' | 'github_issues'
```
Default (`DEFAULT_GLOBAL_SETTINGS`) — add:
```ts
  codeCleanupDestination: 'openforge',
```
In `loadGlobalSettings`, add `getConfig('code_cleanup_destination')` as the LAST entry of the `Promise.all` array and the LAST destructured name (`codeCleanupDestination`), then parse with a coercion guard in the returned object:
```ts
    codeCleanupDestination: codeCleanupDestination === 'github_issues' ? 'github_issues' : 'openforge',
```

- [ ] **Step 4: Run the loader test to green**

Run: `pnpm exec vitest run src/lib/settingsConfig.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the saver test** in `src/lib/settingsSaver.test.ts` — add `codeCleanupDestination: 'github_issues'` to the payload object(s) passed to `saveGlobalSettings`, and add the assertion:
```ts
      expect(setConfig).toHaveBeenCalledWith('code_cleanup_destination', 'github_issues')
```

- [ ] **Step 6: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/settingsSaver.test.ts`
Expected: FAIL — `setConfig` not called with `code_cleanup_destination`.

- [ ] **Step 7: Implement in `src/lib/settingsSaver.ts`**

Payload type (`GlobalSettingsSavePayload`) — add:
```ts
  codeCleanupDestination: 'openforge' | 'github_issues'
```
In `saveGlobalSettings`, add (mirroring the `ai_provider` line — no boolean coercion):
```ts
  await setConfig('code_cleanup_destination', payload.codeCleanupDestination)
```

- [ ] **Step 8: Run both tests to green**

Run: `pnpm exec vitest run src/lib/settingsConfig.test.ts src/lib/settingsSaver.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/settingsConfig.ts src/lib/settingsConfig.test.ts src/lib/settingsSaver.ts src/lib/settingsSaver.test.ts
git commit -m "feat(cleanup): persist cleanup destination in global settings"
```

---

## Task 10: IPC wrapper + sidecar command registration

**Files:**
- Modify: `src/lib/ipc.ts`
- Modify: `src/electron/backendBridge.ts`

**Interfaces:**
- Produces: `checkGithubIssuesReady(projectId: string | null): Promise<{ ready: boolean; reason: string | null }>`.

> **Testing note:** thin transport wrappers with no business logic — verified by `pnpm exec tsc --noEmit` and used (and tested) through `cleanupDestinationGuard` in Task 11.

- [ ] **Step 1: Add the wrapper** in `src/lib/ipc.ts` (near `getProjectRepo`)

```ts
export async function checkGithubIssuesReady(projectId: string | null): Promise<{ ready: boolean; reason: string | null }> {
  return invoke<{ ready: boolean; reason: string | null }>("check_github_issues_ready", { projectId });
}
```

- [ ] **Step 2: Register the command** in `src/electron/backendBridge.ts` — add to the `SIDECAR_BACKED_COMMANDS` set (near `'get_project_repo'`)

```ts
  'check_github_issues_ready',
```

- [ ] **Step 3: Typecheck**

Run: `pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/ipc.ts src/electron/backendBridge.ts
git commit -m "feat(cleanup): wire github issues readiness ipc command"
```

---

## Task 11: `validateDestinationChange` guard helper

**Files:**
- Create: `src/lib/cleanupDestinationGuard.ts`
- Test: `src/lib/cleanupDestinationGuard.test.ts`

**Interfaces:**
- Consumes: `checkGithubIssuesReady` from `./ipc`.
- Produces: `validateDestinationChange(value: string, projectId: string | null): Promise<{ accepted: boolean; reason: string | null }>`.

- [ ] **Step 1: Write the failing test** `src/lib/cleanupDestinationGuard.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({ checkGithubIssuesReady: vi.fn() }))

import { checkGithubIssuesReady } from './ipc'
import { validateDestinationChange } from './cleanupDestinationGuard'

describe('validateDestinationChange', () => {
  beforeEach(() => vi.clearAllMocks())

  it('accepts openforge without a readiness check', async () => {
    const result = await validateDestinationChange('openforge', null)
    expect(result.accepted).toBe(true)
    expect(result.reason).toBeNull()
    expect(checkGithubIssuesReady).not.toHaveBeenCalled()
  })

  it('accepts github_issues when the check reports ready, passing the projectId', async () => {
    vi.mocked(checkGithubIssuesReady).mockResolvedValue({ ready: true, reason: null })
    const result = await validateDestinationChange('github_issues', 'P1')
    expect(result.accepted).toBe(true)
    expect(checkGithubIssuesReady).toHaveBeenCalledWith('P1')
  })

  it('rejects github_issues with the reason when not ready', async () => {
    vi.mocked(checkGithubIssuesReady).mockResolvedValue({
      ready: false,
      reason: 'No GitHub token configured. Add one in Credentials.',
    })
    const result = await validateDestinationChange('github_issues', null)
    expect(result.accepted).toBe(false)
    expect(result.reason).toContain('token')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm exec vitest run src/lib/cleanupDestinationGuard.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** `src/lib/cleanupDestinationGuard.ts`

```ts
import { checkGithubIssuesReady } from './ipc'

export interface DestinationChangeResult {
  accepted: boolean
  reason: string | null
}

/** Validate a destination change before it is persisted. `openforge` (and any
 *  non-github value) is always accepted; `github_issues` runs the readiness
 *  check for the scope (projectId null = global). */
export async function validateDestinationChange(
  value: string,
  projectId: string | null,
): Promise<DestinationChangeResult> {
  if (value !== 'github_issues') {
    return { accepted: true, reason: null }
  }
  const { ready, reason } = await checkGithubIssuesReady(projectId)
  return {
    accepted: ready,
    reason: ready ? null : (reason ?? 'GitHub Issues is not available for this project.'),
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm exec vitest run src/lib/cleanupDestinationGuard.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cleanupDestinationGuard.ts src/lib/cleanupDestinationGuard.test.ts
git commit -m "feat(cleanup): guard github issues destination selection"
```

---

## Task 12: Wire the destination into `SettingsView`

**Files:**
- Modify: `src/components/settings/SettingsView.svelte`

**Interfaces:**
- Consumes: `validateDestinationChange` from `../../lib/cleanupDestinationGuard`; `setProjectConfig` (already imported); `loadGlobalSettings` result field `codeCleanupDestination`.

> **Testing note:** the decision logic is unit-tested in Task 11. This task is component wiring — verify by `pnpm exec tsc --noEmit` and that existing `SettingsView*.test.ts` suites still pass.

- [ ] **Step 1: Add local state** near the other global `$state` declarations (~line 79, by `globalAiProvider`)

```ts
  let globalCodeCleanupDestination = $state<'openforge' | 'github_issues'>('openforge')
  let destinationError = $state<string | null>(null)
```

- [ ] **Step 2: Import the guard** (with the other `../../lib/*` imports near the top)

```ts
  import { validateDestinationChange } from '../../lib/cleanupDestinationGuard'
```

- [ ] **Step 3: Seed on load** — in `onMount`, where the other global fields are copied from `loadGlobalSettings()` (~line 377)

```ts
    globalCodeCleanupDestination = globalSettings.codeCleanupDestination
```

- [ ] **Step 4: Include it in `globalHierarchyValues`** (~line 268)

```ts
    code_cleanup_destination: globalCodeCleanupDestination,
```

- [ ] **Step 5: Include it in the global save payload** — in `captureCurrentSave`, the `mode === 'global'` branch (~line 468)

```ts
        codeCleanupDestination: globalCodeCleanupDestination,
```

- [ ] **Step 6: Add the shared gated-change helper** (place near `handleGlobalSettingChange`)

```ts
  async function handleDestinationChange(projectId: string | null, value: string) {
    const result = await validateDestinationChange(value, projectId)
    if (!result.accepted) {
      destinationError = result.reason
      return
    }
    destinationError = null
    if (projectId === null) {
      globalCodeCleanupDestination = value as 'openforge' | 'github_issues'
      scheduleSave()
    } else {
      projectRawOverrides = { ...projectRawOverrides, code_cleanup_destination: value }
      try {
        await setProjectConfig(projectId, 'code_cleanup_destination', value)
      } catch (e) {
        $error = getErrorMessage(e)
      }
    }
  }
```

- [ ] **Step 7: Intercept in `handleGlobalSettingChange`** — add a case that returns before the trailing `scheduleSave()`

```ts
      case 'code_cleanup_destination':
        void handleDestinationChange(null, value)
        return
```

- [ ] **Step 8: Intercept in `handleProjectSettingChange`** — after `const pid = $activeProjectId; if (!pid) return`

```ts
    if (key === 'code_cleanup_destination') {
      await handleDestinationChange(pid, value)
      return
    }
```

- [ ] **Step 9: Render the inline reason** — near both `<HierarchicalSettingsCard>` render sites, add (daisyUI semantic `text-error`, no hex)

```svelte
        {#if destinationError}
          <p class="text-xs text-error mt-2">{destinationError}</p>
        {/if}
```

- [ ] **Step 10: Typecheck + run the settings component suites**

Run: `pnpm exec tsc --noEmit && pnpm exec vitest run src/components/settings/`
Expected: no type errors; existing SettingsView suites pass.

- [ ] **Step 11: Commit**

```bash
git add src/components/settings/SettingsView.svelte
git commit -m "feat(cleanup): choose cleanup destination in settings with validation"
```

---

## Task 13: Integration verification & manual smoke test

**Files:** none (verification only)

- [ ] **Step 1: Full type + unit suites**

Run:
```bash
pnpm exec tsc --noEmit
pnpm exec vitest run src/lib/hierarchicalSettings.test.ts src/lib/settingsConfig.test.ts src/lib/settingsSaver.test.ts src/lib/cleanupDestinationGuard.test.ts src/components/settings/
```
Expected: all PASS.

- [ ] **Step 2: Rust build + tests**

Run (from `src-tauri/`):
```bash
cargo build
cargo test resolve_cleanup_destination
cargo test cleanup_route
cargo test issue_content
cargo test readiness_tests
```
Expected: build clean; all PASS.

- [ ] **Step 3: Manual smoke test** (`pnpm electron:dev`)

  1. Global Settings → enable **Code Cleanup Tasks**; confirm the **Cleanup Destination** select appears (and disappears when toggled off).
  2. With **no** `github_token` set, pick **GitHub Issues** → selection reverts + inline reason mentions the missing token.
  3. Add a valid `github_token` (Credentials). On a project whose git `origin` is a GitHub repo you can access, set the project destination to **GitHub Issues** → accepted and persisted.
  4. Start a task in that project with cleanup on; have the agent run `openforge task create --initial-prompt "cleanup: X" --label cleanup --depends-on <task>` → a GitHub issue appears in the repo (labeled `cleanup`), and **no** backlog task is created.
  5. Revoke/blank the token, repeat step 4 → a backlog task IS created and the CLI prints a warning to stderr with a non-zero exit (fallback path).
  6. Set the project back to **OpenForge backlog** → cleanup items create backlog tasks as before.

- [ ] **Step 4: Final commit (if any verification-driven fixes were made)**

```bash
git add -A
git commit -m "test(cleanup): verify cleanup destination end to end"
```

---

## Self-Review

**Spec coverage:**
- §1 settings/data model → Tasks 8, 9. ✅
- §2 UI (generic card + `showWhen`) → Task 8. ✅
- §2b pre-flight validation → Tasks 5 (backend), 10 (ipc/bridge), 11 (guard), 12 (UI wiring + revert + reason). ✅
- §3 backend routing (label + destination) → Tasks 1, 2, 6. ✅
- §4 GitHub issue creation (create_issue, repo resolution, title/body/label mapping) → Tasks 3, 4. ✅
- §5 runtime failure handling (keep OpenForge task + warning; CLI loud) → Tasks 6, 7. ✅
- §6 testing → each task's TDD steps + Task 13. ✅
- Non-goals (no back-sync, no per-task) respected: destination is `['global','project']`; `taskDefaults.ts` untouched. ✅

**Placeholder scan:** no TBD/TODO; every code step shows real code. I/O-only glue is explicitly flagged as build/manual-verified rather than pretend-unit-tested (no silent gaps).

**Type consistency:** `code_cleanup_destination` (config key) / `codeCleanupDestination` (TS field) / `resolve_cleanup_destination` (Rust) used consistently. `CleanupRoute`, `IssuesReadiness { ready, reason }`, `evaluate_issues_readiness(token_present, project_scope, repo, access)`, `checkGithubIssuesReady(projectId) → { ready, reason }`, `validateDestinationChange(value, projectId) → { accepted, reason }` referenced with matching shapes across producer and consumer tasks. `CreateTaskResponse` keeps `task_id: String` (empty on issue success) with added optional `issue_url`/`warning`.
