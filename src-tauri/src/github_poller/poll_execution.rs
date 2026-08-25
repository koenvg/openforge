use super::common::{json_value_for_event, GitHubEventTarget, PollOutcome, PollResult};
use super::persistence::{get_open_prs_for_task, poll_prs_for_project};
use super::review_sync::{
    count_poll_phase_error, poll_authored_prs, poll_review_prs, sync_authored_task_prs,
};
use super::scheduling::{
    build_poll_plan, current_unix_timestamp, get_scheduled_prs_for_project,
    parse_poll_interval_seconds, poll_scheduler_snapshot,
    rate_limit_sleep_duration_with_optional_now, scheduled_pr_in_scope, select_projects,
    PollContext, PollScope,
};
use super::sync_logging::{
    format_rate_limit_pause_log, format_sync_phase_log, format_sync_scope_log, poll_scope_log_name,
};
use crate::app_events::AppEventSender;
use crate::db::{acquire_db, Database};
use crate::github_client::GitHubClient;
use log::{debug, error, info, warn};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio::time::{sleep, Duration};

async fn github_token_for_poll(github_client: &GitHubClient) -> Result<String, PollOutcome> {
    match github_client.github_token().await {
        Ok(Some(token)) if !token.trim().is_empty() => Ok(token),
        Ok(_) => Err(PollOutcome::MissingGithubToken),
        Err(error) => {
            log::error!("[GitHub Poller] Failed to read GitHub token: {error}");
            Err(PollOutcome::GithubTokenUnavailable)
        }
    }
}

fn poll_outcome(errors: usize, rate_limited: bool) -> PollOutcome {
    if rate_limited {
        PollOutcome::RateLimited
    } else if errors > 0 {
        PollOutcome::Failed
    } else {
        PollOutcome::Completed
    }
}

/// Start the GitHub poller background task.
///
/// Runs indefinitely: reads the poll interval from the database, calls scoped
/// poll cycles, then sleeps. The `GitHubClient` is created once and reused
/// across cycles so ETag caching persists.
pub async fn start_github_poller_for_sidecar(
    db: Arc<Mutex<Database>>,
    github_client: GitHubClient,
    app_event_tx: Option<AppEventSender>,
    poll_context: PollContext,
) {
    let events = GitHubEventTarget::sidecar(app_event_tx);
    start_github_poller_with_state(db, github_client, events, poll_context).await;
}

async fn start_github_poller_with_state(
    db: Arc<Mutex<Database>>,
    github_client: GitHubClient,
    events: GitHubEventTarget,
    poll_context: PollContext,
) {
    let mut last_global_review_at = 0;

    loop {
        let poll_interval = {
            let db_lock = acquire_db(&db);
            parse_poll_interval_seconds(db_lock.get_config("github_poll_interval").ok().flatten())
        };

        let now = match current_unix_timestamp() {
            Ok(now) => now,
            Err(error) => {
                warn!(
                    "[GitHub Poller] Failed to read current time: {error}; retrying in {poll_interval}s"
                );
                sleep(Duration::from_secs(poll_interval)).await;
                continue;
            }
        };
        let global_review_interval = (poll_interval * 4) as i64;
        let global_review_due = now.saturating_sub(last_global_review_at) >= global_review_interval;
        let scheduler_snapshot = poll_scheduler_snapshot(&db, false, None, global_review_due);
        let plan = build_poll_plan(
            &poll_context.snapshot(),
            scheduler_snapshot,
            poll_interval,
            now,
        );

        if plan.scopes.is_empty() {
            debug!(
                "[GitHub Poller] No GitHub sync scopes due; sleeping {}s",
                plan.sleep_secs
            );
            sleep(Duration::from_secs(plan.sleep_secs)).await;
            continue;
        }

        let ran_global_review = plan.scopes.iter().any(PollScope::polls_global_lists);
        let mut result = PollResult::empty();
        let mut last_scope = None;
        for scope in plan.scopes {
            last_scope = Some(scope.clone());
            let scope_result =
                poll_github_once_with_state(db.clone(), &github_client, &events, &scope).await;
            let stop_for_rate_limit = scope_result.rate_limited;
            result.absorb(scope_result);
            if stop_for_rate_limit {
                break;
            }
        }

        let has_changes = result.new_comments > 0
            || result.ci_changes > 0
            || result.review_changes > 0
            || result.pr_changes > 0;

        if has_changes {
            events.emit("github-sync-complete", json_value_for_event(&result));
        }

        if result.rate_limited {
            events.emit(
                "github-rate-limited",
                serde_json::json!({
                    "reset_at": result.rate_limit_reset_at
                }),
            );
        }

        if ran_global_review {
            match current_unix_timestamp() {
                Ok(now) => last_global_review_at = now,
                Err(error) => warn!("[GitHub Poller] Failed to record global review time: {error}"),
            }
        }

        let sleep_secs = if result.rate_limited {
            let now = match current_unix_timestamp() {
                Ok(now) => Some(now),
                Err(error) => {
                    warn!(
                        "[GitHub Poller] Failed to read current time while rate limited: {error}"
                    );
                    None
                }
            };
            let sleep_secs = rate_limit_sleep_duration_with_optional_now(
                poll_interval,
                result.rate_limit_reset_at,
                now,
            );
            if let Some(scope) = &last_scope {
                if let Some(now) = now {
                    warn!(
                        "{}",
                        format_rate_limit_pause_log(
                            result.rate_limit_reset_at,
                            now,
                            scope,
                            sleep_secs
                        )
                    );
                } else {
                    warn!(
                        "[GitHub Poller] Rate limited in scope={}; current time unavailable, retrying in {} seconds",
                        poll_scope_log_name(scope),
                        sleep_secs
                    );
                }
            }
            sleep_secs
        } else {
            plan.sleep_secs
        };
        sleep(Duration::from_secs(sleep_secs)).await;
    }
}

pub async fn poll_github_once_for_sidecar(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    app_event_tx: Option<AppEventSender>,
    scope: PollScope,
) -> PollResult {
    let events = GitHubEventTarget::sidecar(app_event_tx);
    poll_github_once_with_state(db, github_client, &events, &scope).await
}

pub async fn refresh_task_github_status_for_sidecar(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    app_event_tx: Option<AppEventSender>,
    task_id: &str,
) -> Result<PollResult, String> {
    let events = GitHubEventTarget::sidecar(app_event_tx);
    let open_prs = get_open_prs_for_task(&db, task_id)?;
    if open_prs.is_empty() {
        return Ok(PollResult::empty());
    }

    github_client.clear_rate_limit_reset();
    let github_token = match github_token_for_poll(github_client).await {
        Ok(token) => token,
        Err(outcome) => return Ok(PollResult::with_outcome(outcome)),
    };

    let configured_github_username = {
        let db_lock = acquire_db(&db);
        db_lock.get_config("github_username").ok().flatten()
    };

    let (new_comments, ci_changes, review_changes, pr_changes, errors) = poll_prs_for_project(
        github_client,
        &db,
        &events,
        &github_token,
        configured_github_username.as_deref(),
        open_prs,
        &[],
    )
    .await;

    let rate_limit_reset = github_client.get_last_rate_limit_reset();
    let rate_limited = rate_limit_reset.is_some();
    Ok(PollResult {
        new_comments,
        ci_changes,
        review_changes,
        pr_changes,
        errors,
        rate_limited,
        rate_limit_reset_at: rate_limit_reset,
        outcome: poll_outcome(errors, rate_limited),
    })
}

pub(super) async fn poll_github_once_with_state(
    db: Arc<Mutex<Database>>,
    github_client: &GitHubClient,
    events: &GitHubEventTarget,
    scope: &PollScope,
) -> PollResult {
    let cycle_start = Instant::now();
    github_client.clear_rate_limit_reset();

    let github_token = match github_token_for_poll(github_client).await {
        Ok(token) => token,
        Err(outcome) => return PollResult::with_outcome(outcome),
    };

    let projects = {
        let db_lock = acquire_db(&db);
        db_lock.get_all_projects()
    };

    let projects = match projects {
        Ok(projects) => projects,
        Err(e) => {
            error!("[GitHub Poller] Failed to get projects: {}", e);
            return PollResult {
                new_comments: 0,
                ci_changes: 0,
                review_changes: 0,
                pr_changes: 0,
                errors: 1,
                rate_limited: false,
                rate_limit_reset_at: None,
                outcome: PollOutcome::Failed,
            };
        }
    };

    if projects.is_empty() && scope.polls_task_prs() {
        return PollResult::empty();
    }

    let projects = select_projects(projects, scope);

    debug!(
        "[GitHub Poller] Polling {} projects for PR updates (scope={:?})...",
        projects.len(),
        scope
    );

    let project_count = projects.len();
    let mut total_new_comments = 0;
    let mut total_ci_changes = 0;
    let mut total_review_changes = 0;
    let mut total_pr_changes = 0;
    let mut total_errors = 0;
    let mut rate_limit_count = 0;

    if scope.refreshes_task_links() {
        let sync_start = Instant::now();
        info!(
            "[GitHub Poller] Starting authored task PR link sync (scope={})",
            poll_scope_log_name(scope)
        );
        match sync_authored_task_prs(github_client, &db, &github_token).await {
            Ok(synced) => {
                let detail = format!("synced {synced} task-linked PRs");
                debug!(
                    "{}",
                    format_sync_phase_log(
                        "authored task PR link sync",
                        sync_start.elapsed().as_secs_f64(),
                        Some(&detail),
                    )
                );
            }
            Err(e) => {
                error!(
                    "[GitHub Poller] Failed to sync authored task PRs: {}",
                    e.sanitized_log_message("authored task PR link sync")
                );
                total_errors += 1;
                if e.should_increment_rate_limit_count() {
                    rate_limit_count += 1;
                }
            }
        }
    }

    let configured_github_username = {
        let db_lock = acquire_db(&db);
        db_lock.get_config("github_username").ok().flatten()
    };

    let mut project_pr_batches = Vec::new();
    if scope.polls_task_prs() {
        for project in projects {
            let open_prs = match get_scheduled_prs_for_project(&db, &project.id) {
                Ok(prs) => prs
                    .into_iter()
                    .filter(|pr| scheduled_pr_in_scope(pr, scope))
                    .map(|pr| pr.pr)
                    .collect::<Vec<_>>(),
                Err(e) => {
                    error!(
                        "[GitHub Poller] Failed to get PRs for project {} while preparing scope={}: {}",
                        project.id,
                        poll_scope_log_name(scope),
                        e
                    );
                    total_errors += 1;
                    continue;
                }
            };
            debug!(
                "[GitHub Poller] Prepared project {} for scope={} (prs={})",
                project.id,
                poll_scope_log_name(scope),
                open_prs.len()
            );
            project_pr_batches.push((project, open_prs));
        }
    }

    let planned_pr_count = project_pr_batches
        .iter()
        .map(|(_, prs)| prs.len())
        .sum::<usize>();
    info!(
        "{}",
        format_sync_scope_log(scope, project_count, planned_pr_count)
    );

    if scope.polls_task_prs() {
        for (project, open_prs) in project_pr_batches {
            let open_pr_count = open_prs.len();
            debug!(
                "[GitHub Poller] Polling project {} GitHub PRs (scope={}, prs={})",
                project.id,
                poll_scope_log_name(scope),
                open_pr_count
            );
            let poll_start = Instant::now();
            let (new_comments, ci_changes, review_changes, pr_changes, errors) =
                poll_prs_for_project(
                    github_client,
                    &db,
                    events,
                    &github_token,
                    configured_github_username.as_deref(),
                    open_prs,
                    &[],
                )
                .await;
            let detail = format!(
                "{} PRs, {} new comments, {} CI changes, {} review changes, {} PR changes, {} errors",
                open_pr_count, new_comments, ci_changes, review_changes, pr_changes, errors
            );
            debug!(
                "{}",
                format_sync_phase_log(
                    &format!("task PR polling for project {}", project.id),
                    poll_start.elapsed().as_secs_f64(),
                    Some(&detail),
                )
            );
            total_new_comments += new_comments;
            total_ci_changes += ci_changes;
            total_review_changes += review_changes;
            total_pr_changes += pr_changes;
            total_errors += errors;
        }
    }

    if total_new_comments > 0 || total_errors > 0 {
        info!(
            "[GitHub Poller] Found {} new comments ({} errors)",
            total_new_comments, total_errors
        );
    }

    if scope.polls_global_lists() {
        let review_start = Instant::now();
        info!("[GitHub Poller] Starting global review PR list sync");
        count_poll_phase_error(
            "review PRs",
            poll_review_prs(github_client, &db, events, &github_token).await,
            &mut total_errors,
            &mut rate_limit_count,
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
        count_poll_phase_error(
            "authored PRs",
            poll_authored_prs(github_client, &db, events, &github_token).await,
            &mut total_errors,
            &mut rate_limit_count,
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

    let rate_limit_reset = github_client.get_last_rate_limit_reset();
    let rate_limited = rate_limit_reset.is_some() || rate_limit_count > 0;

    info!(
        "[GitHub Poller] Completed GitHub sync scope={} in {:.1}s (projects={}, prs={}, new_comments={}, ci_changes={}, review_changes={}, errors={}, rate_limited={}, reset_at={})",
        poll_scope_log_name(scope),
        cycle_start.elapsed().as_secs_f64(),
        project_count,
        planned_pr_count,
        total_new_comments,
        total_ci_changes,
        total_review_changes,
        total_errors,
        rate_limited,
        rate_limit_reset
            .map(|ts| ts.to_string())
            .unwrap_or_else(|| "none".to_string())
    );

    if rate_limited {
        let has_changes = total_new_comments > 0
            || total_ci_changes > 0
            || total_review_changes > 0
            || total_pr_changes > 0;

        if has_changes {
            warn!(
                "[GitHub Poller] Rate limit detected BUT cycle has changes: {} new comments, {} CI changes, {} review changes",
                total_new_comments, total_ci_changes, total_review_changes
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
            warn!(
                "[GitHub Poller] Rate limit detected, no changes this cycle (reset time unknown)"
            );
        }
    }

    PollResult {
        new_comments: total_new_comments,
        ci_changes: total_ci_changes,
        review_changes: total_review_changes,
        pr_changes: total_pr_changes,
        errors: total_errors,
        rate_limited,
        rate_limit_reset_at: rate_limit_reset,
        outcome: poll_outcome(total_errors, rate_limited),
    }
}
