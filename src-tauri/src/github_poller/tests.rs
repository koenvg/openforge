use super::common::*;
use super::persistence::*;
use super::poll_events::*;
use super::pr_execution::*;
use super::pr_readiness::*;
use super::review_sync::*;
use super::scheduling::*;
use super::sync_logging::*;
use crate::backend_runtime::AppHandle;
use crate::db::test_helpers::{insert_test_task, make_test_db};
use crate::db::{select_snapshot_readiness_inputs, PrMergeReadinessFacts, PrRow, ProjectRow};
use crate::github_client::{
    CheckRun, CheckRunsResponse, CombinedStatusResponse, GitHubClient, GitHubHead,
    GitHubReadinessSnapshot, GitHubUser, PrComment, PrReview, PullRequest, SearchPrResult,
};
use std::collections::HashSet;
use std::sync::Mutex;

fn poison_mutex<T>(mutex: &Mutex<T>) {
    let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _guard = mutex.lock().expect("lock mutex before poisoning");
        panic!("poison test mutex");
    }));
    assert!(poisoned.is_err(), "test mutex should be poisoned");
}

fn make_project(id: &str) -> ProjectRow {
    ProjectRow {
        id: id.to_string(),
        name: format!("project {id}"),
        path: format!("/tmp/{id}"),
        created_at: 0,
        updated_at: 0,
    }
}

fn reported_ctx(
    focused: bool,
    active_project_id: Option<&str>,
    global_view_open: bool,
) -> PollContextSnapshot {
    PollContextSnapshot {
        reported: true,
        focused,
        active_project_id: active_project_id.map(|s| s.to_string()),
        global_view_open,
    }
}
fn make_pr(
    id: i64,
    ticket_id: &str,
    project_id: &str,
    task_status: &str,
    ci_status: Option<&str>,
    readiness_status: Option<&str>,
) -> ScheduledPr {
    ScheduledPr {
        pr: PrRow {
            id,
            pr_number: id,
            ticket_id: ticket_id.to_string(),
            repo_owner: "acme".to_string(),
            repo_name: project_id.to_string(),
            title: format!("PR {id}"),
            url: format!("https://github.com/acme/{project_id}/pull/{id}"),
            state: "open".to_string(),
            head_sha: format!("sha-{id}"),
            ci_status: ci_status.map(str::to_string),
            ci_check_runs: None,
            review_status: None,
            mergeable: None,
            mergeable_state: None,
            merged_at: None,
            created_at: 0,
            updated_at: 0,
            draft: false,
            is_queued: false,
            merge_readiness_status: readiness_status.map(str::to_string),
            merge_readiness_action: None,
            merge_readiness_blockers: None,
            merge_readiness_warnings: None,
            readiness_source_head_sha: None,
            merge_group_sha: None,
            required_checks_policy_known: None,
            required_reviews_policy_known: None,
            merge_queue_required: None,
            merge_queue_state: None,
            readiness_updated_at: None,
            github_node_id: None,
            merge_methods_policy_known: None,
            allowed_merge_methods: None,
            default_merge_method: None,
            unaddressed_comment_count: 0,
        },
        project_id: project_id.to_string(),
        task_status: task_status.to_string(),
        out_of_focus: false,
    }
}

mod common_tests;
mod persistence_tests;
mod poll_execution_tests;
mod pr_execution_tests;
mod pr_readiness_tests;
mod review_sync_tests;
mod scheduling_tests;
mod sync_logging_tests;
