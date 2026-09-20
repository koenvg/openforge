use super::{coordinator::Signal, local::Origin, verification::GitContext};
use crate::{
    app_events::RuntimeEventPublisher,
    db::{AutomaticAssociation, AutomaticPr, Database},
    github_client::GitHubClient,
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};

#[derive(Clone)]
pub(super) struct Execution {
    pub db: Arc<Mutex<Database>>,
    pub github: GitHubClient,
    pub events: RuntimeEventPublisher,
    pub clock: Arc<dyn super::clock::Clock>,
}

#[derive(Debug, PartialEq, Eq)]
struct Identity {
    project_id: String,
    workspace_id: i64,
    workspace_kind: &'static str,
    path: PathBuf,
    repo_path: String,
    recorded_branch: Option<String>,
}
fn identity(db: &Database, origin: &Origin) -> Option<Identity> {
    let project_id = db.active_task_project_id(&origin.task_id).ok()??;
    let legacy = db.get_worktree_for_task(&origin.task_id).ok()?;
    let (workspace_id, workspace_kind, path, repo_path, recorded_branch) =
        if let Some(w) = legacy.filter(|w| std::path::Path::new(&w.worktree_path).is_dir()) {
            if w.project_id != project_id {
                return None;
            }
            (
                w.id,
                "worktree",
                w.worktree_path,
                w.repo_path,
                Some(w.branch_name),
            )
        } else {
            let w = db.get_task_workspace_for_task(&origin.task_id).ok()??;
            if w.project_id != project_id {
                return None;
            }
            (
                w.id,
                "workspace",
                w.workspace_path,
                w.repo_path,
                w.branch_name,
            )
        };
    let path = std::fs::canonicalize(path).ok()?;
    if path != origin.cwd {
        return None;
    }
    Some(Identity {
        project_id,
        workspace_id,
        workspace_kind,
        path,
        repo_path,
        recorded_branch,
    })
}

impl Execution {
    pub(super) async fn discover(&self, signal: Signal) {
        let Ok(Some(token)) = self.github.github_token().await else {
            return;
        };
        let db = self.db.clone();
        let origin = signal.origin.clone();
        let Ok(Some((initial, git))) = tokio::task::spawn_blocking(move || {
            if !*origin.current.read().ok()? {
                return None;
            }
            let initial = identity(&*db.lock().ok()?, &origin)?;
            let git = GitContext::resolve(&initial.path)?;
            Some((initial, git))
        })
        .await
        else {
            return;
        };
        if !git.trusted_bases.contains(&(
            signal.candidate.owner.clone(),
            signal.candidate.repo.clone(),
        )) {
            return;
        }
        let mut verified = None;
        for attempt in 0..=2 {
            let retry_delay = [0u64, 2, 10][attempt];
            let server_delay = self
                .github
                .get_last_rate_limit_reset()
                .map(|deadline| deadline.saturating_sub(self.clock.now()).max(0) as u64)
                .unwrap_or(0);
            let delay = retry_delay.max(server_delay);
            if delay > 0 {
                self.clock
                    .sleep(std::time::Duration::from_secs(delay))
                    .await;
            }
            if !signal
                .origin
                .current
                .read()
                .map(|current| *current)
                .unwrap_or(false)
            {
                return;
            }
            let permit = self.github.acquire_refresh_permit().await;
            if self
                .github
                .get_last_rate_limit_reset()
                .is_some_and(|deadline| deadline > self.clock.now())
            {
                drop(permit);
                continue;
            }
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(30),
                self.github.get_pr_details(
                    &signal.candidate.owner,
                    &signal.candidate.repo,
                    signal.candidate.number,
                    &token,
                ),
            )
            .await
            .unwrap_or_else(|_| {
                Err(crate::github_client::GitHubError::NetworkError(
                    "discovery timed out".into(),
                ))
            });
            drop(permit);
            match result {
                Ok(pr) => {
                    verified = Some(pr);
                    break;
                }
                Err(error) => {
                    use crate::github_client::GitHubError;
                    let retry = match &error {
                        GitHubError::NetworkError(_) => true,
                        GitHubError::ApiError {
                            status: 404 | 500..=599,
                            ..
                        } => true,
                        GitHubError::ApiError {
                            status: 403 | 429, ..
                        } => self
                            .github
                            .get_last_rate_limit_reset()
                            .is_some_and(|d| d > self.clock.now()),
                        _ => false,
                    };
                    log::debug!("[PR discovery] {}", error.sanitized_log_message());
                    if !retry {
                        return;
                    }
                }
            }
        }
        let Some(pr) = verified else {
            return;
        };
        let now = self.clock.now();
        if !git.verifies(&signal.candidate, &pr) {
            return;
        }
        let this = self.clone();
        let _ = tokio::task::spawn_blocking(move || -> Option<()> {
            let current = signal.origin.current.read().ok()?;
            if !*current { return None; }
            let db = this.db.lock().ok()?;
            if identity(&db, &signal.origin)? != initial { return None; }
            // Re-read Git after acquiring the database lock: waiting for a concurrent
            // write must not leave a pre-lock branch snapshot eligible to commit.
            if GitContext::resolve(&initial.path)? != git { return None; }
            let id = pr.extra["id"].as_i64()?;
            let url = format!("https://github.com/{}/{}/pull/{}", signal.candidate.owner, signal.candidate.repo, signal.candidate.number);
            let outcome = db.associate_pull_request_automatically(AutomaticPr {
                id, number: pr.number, task_id: &signal.origin.task_id, owner: &signal.candidate.owner,
                repo: &signal.candidate.repo, title: &pr.title, url: &url, state: &pr.state, now, draft: pr.draft.unwrap_or(false),
            }).ok()?;
            if outcome == AutomaticAssociation::Created {
                this.events.publish("task-pull-request-updated", &serde_json::json!({"task_id":signal.origin.task_id,"pr_id":id,"action":"linked"}));
            }
            Some(())
        }).await;
    }
}
