use super::{
    CompanionActionPaletteError, CompanionMergeMethodPolicy, CompanionTaskActionId,
    DatabaseCompanionActionPaletteService,
};
use crate::db::{PullRequestReadinessStatus, PullRequestReadinessView};

fn matches_current_readiness(
    pull_request: &crate::db::PrRow,
    status: PullRequestReadinessStatus,
) -> bool {
    if let Some(matches) = PullRequestReadinessView::matches_current_persisted(pull_request, status)
    {
        return matches;
    }
    PullRequestReadinessView::from(pull_request).status() == status
}

fn merge_method_policy_from_pr(
    pull_request: &crate::db::PrRow,
) -> Option<CompanionMergeMethodPolicy> {
    let policy = pull_request.merge_method_policy()?;
    if policy.allowed.is_empty() {
        return None;
    }
    Some(CompanionMergeMethodPolicy {
        allowed: policy.allowed,
        default: policy.default,
    })
}

pub(super) fn available_actions(
    database: &crate::db::Database,
    task_id: &str,
) -> Result<Vec<CompanionTaskActionId>, CompanionActionPaletteError> {
    let pull_requests = database
        .get_open_prs()
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    let ready_count = |status: PullRequestReadinessStatus| {
        pull_requests
            .iter()
            .filter(|pull_request| {
                pull_request.ticket_id == task_id && matches_current_readiness(pull_request, status)
            })
            .count()
    };

    let mut actions = Vec::new();
    if ready_count(PullRequestReadinessStatus::ReadyToMerge) == 1
        && pull_requests
            .iter()
            .find(|pull_request| {
                pull_request.ticket_id == task_id
                    && matches_current_readiness(
                        pull_request,
                        PullRequestReadinessStatus::ReadyToMerge,
                    )
            })
            .and_then(merge_method_policy_from_pr)
            .is_some()
    {
        actions.push(CompanionTaskActionId::MergePullRequest);
    }
    if ready_count(PullRequestReadinessStatus::ReadyToEnqueue) == 1 {
        actions.push(CompanionTaskActionId::EnqueuePullRequest);
    }
    Ok(actions)
}

fn unique_ready_pull_request(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
    status: PullRequestReadinessStatus,
) -> Result<crate::db::PrRow, CompanionActionPaletteError> {
    let pull_requests = crate::github_runtime::get_pull_requests(&service.database)
        .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?
        .into_iter()
        .filter(|pull_request| {
            pull_request.ticket_id == task_id
                && pull_request.state == "open"
                && matches_current_readiness(pull_request, status)
        })
        .collect::<Vec<_>>();
    match pull_requests.as_slice() {
        [pull_request] => Ok(pull_request.clone()),
        _ => Err(CompanionActionPaletteError::InvalidTaskState),
    }
}
pub(super) fn merge_method_policy(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<Option<CompanionMergeMethodPolicy>, CompanionActionPaletteError> {
    let pull_request =
        unique_ready_pull_request(service, task_id, PullRequestReadinessStatus::ReadyToMerge)?;
    Ok(merge_method_policy_from_pr(&pull_request))
}

fn publish_action(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
    pull_request_id: i64,
    action: &str,
) {
    crate::app_events::publish_app_event_to_runtime(
        service.app.as_ref(),
        &service.app_event_tx,
        "task-pull-request-updated",
        &serde_json::json!({
            "task_id": task_id,
            "pr_id": pull_request_id,
            "action": action,
        }),
    );
}

pub(super) async fn merge(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
    merge_method: crate::github_client::PullRequestMergeMethod,
) -> Result<(), CompanionActionPaletteError> {
    let pull_request =
        unique_ready_pull_request(service, task_id, PullRequestReadinessStatus::ReadyToMerge)?;
    let merge_result = crate::github_runtime::merge_task_pull_request(
        &service.database,
        &service.github_client,
        task_id,
        pull_request.id,
        merge_method,
        &pull_request.head_sha,
    )
    .await;
    if let Err(error) = merge_result {
        if let Err(refresh_error) = crate::github_poller::refresh_task_github_status_for_sidecar(
            service.database.clone(),
            &service.github_client,
            service.app_event_tx.clone(),
            task_id,
        )
        .await
        {
            log::warn!(
                "[Companion] Failed to refresh GitHub policy after rejected merge: {refresh_error}"
            );
        }
        return Err(CompanionActionPaletteError::MergeRejected(error));
    }
    publish_action(service, task_id, pull_request.id, "merged");
    Ok(())
}

pub(super) async fn enqueue(
    service: &DatabaseCompanionActionPaletteService,
    task_id: &str,
) -> Result<(), CompanionActionPaletteError> {
    let pull_request =
        unique_ready_pull_request(service, task_id, PullRequestReadinessStatus::ReadyToEnqueue)?;
    crate::github_runtime::enqueue_task_pull_request(
        &service.database,
        &service.github_client,
        task_id,
        pull_request.id,
        &pull_request.head_sha,
    )
    .await
    .map_err(|_| CompanionActionPaletteError::TemporarilyUnavailable)?;
    publish_action(service, task_id, pull_request.id, "enqueued");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::super::{
        execute_task_action, CompanionActionPaletteService, DatabaseCompanionActionPaletteService,
    };
    use super::*;
    use std::sync::{Arc, Mutex};

    fn set_readiness(
        database: &crate::db::Database,
        id: i64,
        status: &str,
        action: &str,
        source_head_sha: &str,
    ) {
        database
            .update_pr_merge_readiness(
                id,
                &crate::db::PrMergeReadinessFacts {
                    status: Some(status.to_string()),
                    action: Some(action.to_string()),
                    blockers_json: Some("[]".to_string()),
                    warnings_json: Some("[]".to_string()),
                    source_head_sha: Some(source_head_sha.to_string()),
                    merge_group_sha: None,
                    required_checks_policy_known: Some(true),
                    required_reviews_policy_known: Some(true),
                    merge_queue_required: Some(false),
                    merge_queue_state: None,
                    updated_at: 1,
                },
            )
            .expect("set pull request readiness");
    }

    #[tokio::test]
    async fn service_requires_one_uniquely_ready_pull_request_per_action() {
        let (database, _temp_dir) =
            crate::db::test_helpers::make_test_db("companion_action_palette_pull_requests");
        let database = Arc::new(Mutex::new(database));
        let task_id = {
            let database = crate::db::acquire_db(&database);
            let project = database
                .create_project("OpenForge", "/tmp/openforge")
                .expect("create Project");
            let task = database
                .create_task("Doing", "doing", Some(&project.id), None, None)
                .expect("create doing Task");
            for (id, status, action) in [
                (1, "ready_to_merge", "merge"),
                (2, "ready_to_enqueue", "enqueue"),
            ] {
                database
                    .insert_pull_request(
                        id,
                        &task.id,
                        "owner",
                        "repo",
                        "Ready PR",
                        "https://example.com/pr",
                        "open",
                        1,
                        1,
                        false,
                    )
                    .expect("insert pull request");
                set_readiness(&database, id, status, action, "");
                if status == "ready_to_merge" {
                    database
                        .update_pr_merge_method_policy(
                            id,
                            true,
                            r#"["squash","rebase"]"#,
                            Some("squash"),
                        )
                        .expect("set merge method policy");
                }
            }
            task.id
        };
        let service = DatabaseCompanionActionPaletteService::new(Arc::clone(&database));

        let actions = service
            .available_actions(&task_id)
            .expect("available actions");
        assert!(actions.contains(&CompanionTaskActionId::MergePullRequest));
        assert!(actions.contains(&CompanionTaskActionId::EnqueuePullRequest));

        {
            let database = crate::db::acquire_db(&database);
            database
                .insert_pull_request(
                    3,
                    &task_id,
                    "owner",
                    "repo",
                    "Second merge-ready PR",
                    "https://example.com/pr-3",
                    "open",
                    1,
                    1,
                    false,
                )
                .expect("insert duplicate merge-ready pull request");
            set_readiness(&database, 3, "ready_to_merge", "enqueue", "");
        }

        let actions = service
            .available_actions(&task_id)
            .expect("available actions after mismatched readiness");
        assert!(actions.contains(&CompanionTaskActionId::MergePullRequest));

        {
            let database = crate::db::acquire_db(&database);
            set_readiness(&database, 3, "ready_to_merge", "merge", "stale-head-sha");
        }

        let actions = service
            .available_actions(&task_id)
            .expect("available actions after stale readiness");
        assert!(actions.contains(&CompanionTaskActionId::MergePullRequest));

        {
            let database = crate::db::acquire_db(&database);
            set_readiness(&database, 3, "ready_to_merge", "merge", "");
        }

        let actions = service
            .available_actions(&task_id)
            .expect("available actions after duplicate readiness");
        assert!(!actions.contains(&CompanionTaskActionId::MergePullRequest));
        assert!(actions.contains(&CompanionTaskActionId::EnqueuePullRequest));
        assert_eq!(
            execute_task_action(&service, &task_id, CompanionTaskActionId::MergePullRequest,).await,
            Err(CompanionActionPaletteError::InvalidTaskState)
        );
    }
}
