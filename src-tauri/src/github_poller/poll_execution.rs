use super::common::{json_value_for_event, GitHubEventTarget, PollOutcome, PollResult};
use super::persistence::{get_open_prs_for_task, poll_prs_for_project};
use super::scheduling::{
    current_unix_timestamp, parse_poll_interval_seconds, poll_scheduler_snapshot,
    rate_limit_sleep_duration_with_optional_now, PollCadence, PollContext, PollScope,
};
pub(super) use super::scope_execution::poll_github_scope;
use super::scope_execution::{github_token_for_poll, poll_outcome, ScopeExecution};
use super::sync_logging::{format_rate_limit_pause_log, poll_scope_log_name};
use crate::app_events::AppEventSender;
use crate::db::{acquire_db, Database};
use crate::github_client::GitHubClient;
use log::{debug, info, warn};
use std::sync::{Arc, Mutex};
use tokio::time::{sleep, Duration};

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
    let mut cadence = PollCadence::default();

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
        let reset_at = github_client.get_last_rate_limit_reset();
        let rate_limited = reset_at.is_some_and(|reset| reset > now);
        let scheduler_snapshot = poll_scheduler_snapshot(&db, rate_limited, reset_at, false);
        let plan = cadence.plan(
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

        let mut result = PollResult::empty();
        let mut last_scope = None;
        for scope in plan.scopes {
            last_scope = Some(scope.clone());
            let execution = poll_github_scope(db.clone(), &github_client, &events, &scope).await;
            let scope_result = execution.result;
            let stop_for_rate_limit = scope_result.rate_limited;
            match current_unix_timestamp() {
                Ok(now) => cadence.record(
                    &scope,
                    if execution.task_links_succeeded {
                        PollOutcome::Completed
                    } else {
                        PollOutcome::Failed
                    },
                    now,
                ),
                Err(error) => warn!("[GitHub Poller] Failed to record sync time: {error}"),
            }
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
    let _refresh_permit = github_client.acquire_refresh_permit().await;

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
    poll_github_scope(db, github_client, events, scope)
        .await
        .result
}
