use super::common::{GitHubEventTarget, PollOutcome, PollResult};
use super::persistence::poll_prs_for_project;
use super::review_sync::{
    count_poll_phase_error, poll_authored_prs, poll_authored_prs_from_snapshot, poll_review_prs,
    sync_authored_task_prs,
};
use super::scheduling::{
    current_unix_timestamp, get_scheduled_prs_for_project, scheduled_pr_in_scope, select_projects,
    PollScope,
};
use super::sync_logging::{format_sync_phase_log, format_sync_scope_log, poll_scope_log_name};
use crate::db::{acquire_db, Database, PrRow, ProjectRow};
use crate::github_client::{CompletePrSearchSnapshot, GitHubClient};
use log::{debug, error, info, warn};
use std::sync::{Arc, Mutex};
use std::time::Instant;

pub(super) async fn github_token_for_poll(
    github_client: &GitHubClient,
) -> Result<String, PollOutcome> {
    match github_client.github_token().await {
        Ok(Some(token)) if !token.trim().is_empty() => Ok(token),
        Ok(_) => Err(PollOutcome::MissingGithubToken),
        Err(error) => {
            log::error!("[GitHub Poller] Failed to read GitHub token: {error}");
            Err(PollOutcome::GithubTokenUnavailable)
        }
    }
}

pub(super) fn poll_outcome(errors: usize, rate_limited: bool) -> PollOutcome {
    if rate_limited {
        PollOutcome::RateLimited
    } else if errors > 0 {
        PollOutcome::Failed
    } else {
        PollOutcome::Completed
    }
}

/// Phase success is separate from the overall cycle: a list failure must not
/// turn successful recovery back into work on every scheduler wake.
pub(super) struct ScopeExecution {
    pub(super) result: PollResult,
    pub(super) task_links_succeeded: bool,
}

impl From<PollResult> for ScopeExecution {
    fn from(result: PollResult) -> Self {
        Self {
            result,
            task_links_succeeded: false,
        }
    }
}

type ProjectPrBatch = (ProjectRow, Vec<PrRow>);

#[derive(Default)]
struct ScopeProgress {
    new_comments: usize,
    ci_changes: usize,
    review_changes: usize,
    pr_changes: usize,
    errors: usize,
    rate_limit_count: usize,
    task_links_succeeded: bool,
}

impl ScopeProgress {
    fn absorb_project_poll(
        &mut self,
        (new_comments, ci_changes, review_changes, pr_changes, errors): (
            usize,
            usize,
            usize,
            usize,
            usize,
        ),
    ) {
        self.new_comments += new_comments;
        self.ci_changes += ci_changes;
        self.review_changes += review_changes;
        self.pr_changes += pr_changes;
        self.errors += errors;
    }

    fn has_changes(&self) -> bool {
        self.new_comments > 0
            || self.ci_changes > 0
            || self.review_changes > 0
            || self.pr_changes > 0
    }
}

fn active_rate_limit_execution(github_client: &GitHubClient) -> Option<ScopeExecution> {
    let reset_at = github_client.get_last_rate_limit_reset()?;
    if current_unix_timestamp().is_ok_and(|now| reset_at <= now) {
        return None;
    }

    Some(
        PollResult {
            rate_limited: true,
            rate_limit_reset_at: Some(reset_at),
            ..PollResult::with_outcome(PollOutcome::RateLimited)
        }
        .into(),
    )
}

fn projects_for_scope(
    db: &Mutex<Database>,
    scope: &PollScope,
) -> Result<Vec<ProjectRow>, ScopeExecution> {
    let projects = {
        let db_lock = acquire_db(db);
        db_lock.get_all_projects()
    };

    let projects = projects.map_err(|error| {
        error!("[GitHub Poller] Failed to get projects: {}", error);
        ScopeExecution::from(PollResult {
            errors: 1,
            outcome: PollOutcome::Failed,
            ..PollResult::empty()
        })
    })?;

    if projects.is_empty() && scope.polls_task_prs() {
        return Err(PollResult::empty().into());
    }

    Ok(select_projects(projects, scope))
}

fn log_rate_limit_outcome(progress: &ScopeProgress, rate_limit_reset: Option<i64>) {
    if progress.has_changes() {
        warn!(
            "[GitHub Poller] Rate limit detected BUT cycle has changes: {} new comments, {} CI changes, {} review changes",
            progress.new_comments, progress.ci_changes, progress.review_changes
        );
    } else if let Some(reset_at) = rate_limit_reset {
        match current_unix_timestamp() {
            Ok(now) => {
                let seconds_until_reset = (reset_at - now).max(0);
                warn!(
                    "[GitHub Poller] Rate limit detected, no changes this cycle (resets in {} seconds)",
                    seconds_until_reset
                );
            }
            Err(error) => warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (current time unavailable: {error})"
            ),
        }
    } else {
        warn!("[GitHub Poller] Rate limit detected, no changes this cycle (reset time unknown)");
    }
}

struct ScopePoll<'a> {
    db: &'a Mutex<Database>,
    github_client: &'a GitHubClient,
    events: &'a GitHubEventTarget,
    github_token: String,
    scope: &'a PollScope,
    cycle_start: Instant,
    progress: ScopeProgress,
    requests: super::refresh_requests::RefreshRequests,
}

impl<'a> ScopePoll<'a> {
    fn new(
        db: &'a Mutex<Database>,
        github_client: &'a GitHubClient,
        events: &'a GitHubEventTarget,
        github_token: String,
        scope: &'a PollScope,
        cycle_start: Instant,
        requests: super::refresh_requests::RefreshRequests,
    ) -> Self {
        Self {
            db,
            github_client,
            events,
            github_token,
            scope,
            cycle_start,
            progress: ScopeProgress::default(),
            requests,
        }
    }

    async fn execute(mut self, projects: Vec<ProjectRow>) -> ScopeExecution {
        debug!(
            "[GitHub Poller] Polling {} projects for PR updates (scope={:?})...",
            projects.len(),
            self.scope
        );
        let project_count = projects.len();
        let authored_snapshot = self.refresh_task_links().await;
        let configured_github_username = {
            let db_lock = acquire_db(self.db);
            db_lock.get_config("github_username").ok().flatten()
        };
        let project_pr_batches = self.prepare_task_pr_batches(projects);
        let planned_pr_count = project_pr_batches
            .iter()
            .map(|(_, prs)| prs.len())
            .sum::<usize>();
        info!(
            "{}",
            format_sync_scope_log(self.scope, project_count, planned_pr_count)
        );

        self.poll_task_pr_batches(configured_github_username.as_deref(), project_pr_batches)
            .await;
        if self.progress.new_comments > 0 || self.progress.errors > 0 {
            info!(
                "[GitHub Poller] Found {} new comments ({} errors)",
                self.progress.new_comments, self.progress.errors
            );
        }
        self.refresh_global_lists(authored_snapshot).await;
        self.finish(project_count, planned_pr_count)
    }

    async fn refresh_task_links(&mut self) -> Option<CompletePrSearchSnapshot> {
        if !self.scope.refreshes_task_links() {
            return None;
        }

        let sync_start = Instant::now();
        info!(
            "[GitHub Poller] Starting authored task PR link sync (scope={})",
            poll_scope_log_name(self.scope)
        );
        match sync_authored_task_prs(
            self.github_client,
            self.db,
            &self.github_token,
            self.events,
            &mut self.requests,
        )
        .await
        {
            Ok((synced, snapshot)) => {
                self.progress.task_links_succeeded =
                    self.github_client.get_last_rate_limit_reset().is_none();
                let detail = format!("synced {synced} task-linked PRs");
                debug!(
                    "{}",
                    format_sync_phase_log(
                        "authored task PR link sync",
                        sync_start.elapsed().as_secs_f64(),
                        Some(&detail),
                    )
                );
                snapshot
            }
            Err(error) => {
                error!(
                    "[GitHub Poller] Failed to sync authored task PRs: {}",
                    error.sanitized_log_message("authored task PR link sync")
                );
                self.progress.errors += 1;
                if error.should_increment_rate_limit_count() {
                    self.progress.rate_limit_count += 1;
                }
                None
            }
        }
    }

    fn prepare_task_pr_batches(&mut self, projects: Vec<ProjectRow>) -> Vec<ProjectPrBatch> {
        if !self.scope.polls_task_prs() {
            return Vec::new();
        }

        projects
            .into_iter()
            .filter_map(|project| {
                let open_prs = match get_scheduled_prs_for_project(self.db, &project.id) {
                    Ok(prs) => prs
                        .into_iter()
                        .filter(|pr| scheduled_pr_in_scope(pr, self.scope))
                        .map(|pr| pr.pr)
                        .collect::<Vec<_>>(),
                    Err(error) => {
                        error!(
                            "[GitHub Poller] Failed to get PRs for project {} while preparing scope={}: {}",
                            project.id,
                            poll_scope_log_name(self.scope),
                            error
                        );
                        self.progress.errors += 1;
                        return None;
                    }
                };
                debug!(
                    "[GitHub Poller] Prepared project {} for scope={} (prs={})",
                    project.id,
                    poll_scope_log_name(self.scope),
                    open_prs.len()
                );
                Some((project, open_prs))
            })
            .collect()
    }

    async fn poll_task_pr_batches(
        &mut self,
        configured_github_username: Option<&str>,
        batches: Vec<ProjectPrBatch>,
    ) {
        if !self.scope.polls_task_prs() {
            return;
        }

        for (project, open_prs) in batches {
            let open_pr_count = open_prs.len();
            debug!(
                "[GitHub Poller] Polling project {} GitHub PRs (scope={}, prs={})",
                project.id,
                poll_scope_log_name(self.scope),
                open_pr_count
            );
            let poll_start = Instant::now();
            let result = poll_prs_for_project(
                self.github_client,
                self.db,
                self.events,
                &self.github_token,
                configured_github_username,
                open_prs,
                &mut self.requests,
            )
            .await;
            let detail = format!(
                "{} PRs, {} new comments, {} CI changes, {} review changes, {} PR changes, {} errors",
                open_pr_count, result.0, result.1, result.2, result.3, result.4
            );
            debug!(
                "{}",
                format_sync_phase_log(
                    &format!("task PR polling for project {}", project.id),
                    poll_start.elapsed().as_secs_f64(),
                    Some(&detail),
                )
            );
            self.progress.absorb_project_poll(result);
        }
    }

    async fn refresh_global_lists(&mut self, authored_snapshot: Option<CompletePrSearchSnapshot>) {
        if !self.scope.polls_global_lists() {
            return;
        }

        let review_start = Instant::now();
        info!("[GitHub Poller] Starting global review PR list sync");
        count_poll_phase_error(
            "review PRs",
            poll_review_prs(self.github_client, self.db, self.events, &self.github_token).await,
            &mut self.progress.errors,
            &mut self.progress.rate_limit_count,
        );
        debug!(
            "{}",
            format_sync_phase_log(
                "global review PR list",
                review_start.elapsed().as_secs_f64(),
                None,
            )
        );

        let authored_start = Instant::now();
        info!("[GitHub Poller] Starting authored PR list sync");
        let authored_result = match authored_snapshot {
            Some(snapshot) => {
                poll_authored_prs_from_snapshot(
                    self.github_client,
                    self.db,
                    self.events,
                    &self.github_token,
                    snapshot,
                )
                .await
            }
            None => {
                poll_authored_prs(self.github_client, self.db, self.events, &self.github_token)
                    .await
            }
        };
        count_poll_phase_error(
            "authored PRs",
            authored_result,
            &mut self.progress.errors,
            &mut self.progress.rate_limit_count,
        );
        debug!(
            "{}",
            format_sync_phase_log(
                "authored PR list",
                authored_start.elapsed().as_secs_f64(),
                None,
            )
        );
    }

    fn finish(self, project_count: usize, planned_pr_count: usize) -> ScopeExecution {
        let rate_limit_reset = self.github_client.get_last_rate_limit_reset();
        let rate_limited = rate_limit_reset.is_some() || self.progress.rate_limit_count > 0;

        info!(
            "[GitHub Poller] Completed GitHub sync scope={} in {:.1}s (projects={}, prs={}, new_comments={}, ci_changes={}, review_changes={}, errors={}, rate_limited={}, reset_at={})",
            poll_scope_log_name(self.scope),
            self.cycle_start.elapsed().as_secs_f64(),
            project_count,
            planned_pr_count,
            self.progress.new_comments,
            self.progress.ci_changes,
            self.progress.review_changes,
            self.progress.errors,
            rate_limited,
            rate_limit_reset
                .map(|ts| ts.to_string())
                .unwrap_or_else(|| "none".to_string())
        );

        if rate_limited {
            log_rate_limit_outcome(&self.progress, rate_limit_reset);
        }

        ScopeExecution {
            result: PollResult {
                new_comments: self.progress.new_comments,
                ci_changes: self.progress.ci_changes,
                review_changes: self.progress.review_changes,
                pr_changes: self.progress.pr_changes,
                errors: self.progress.errors,
                rate_limited,
                rate_limit_reset_at: rate_limit_reset,
                outcome: poll_outcome(self.progress.errors, rate_limited),
            },
            task_links_succeeded: self.progress.task_links_succeeded,
        }
    }
}

pub(super) async fn poll_github_scope(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    events: &GitHubEventTarget,
    scope: &PollScope,
) -> ScopeExecution {
    let requests = {
        let prs = acquire_db(&db).get_open_prs().unwrap_or_default();
        super::refresh_requests::RefreshRequests::new(github_client, &prs)
    };
    let _refresh_permit = github_client.acquire_refresh_permit().await;
    let cycle_start = Instant::now();
    if let Some(execution) = active_rate_limit_execution(github_client) {
        return execution;
    }
    github_client.clear_rate_limit_reset();

    let github_token = match github_token_for_poll(github_client).await {
        Ok(token) => token,
        Err(outcome) => return PollResult::with_outcome(outcome).into(),
    };
    let projects = match projects_for_scope(&db, scope) {
        Ok(projects) => projects,
        Err(execution) => return execution,
    };

    ScopePoll::new(
        &db,
        github_client,
        events,
        github_token,
        scope,
        cycle_start,
        requests,
    )
    .execute(projects)
    .await
}
