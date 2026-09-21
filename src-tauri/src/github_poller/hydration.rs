use super::{common::GitHubEventTarget, persistence::poll_prs_for_project};
use crate::{
    app_events::RuntimeEventPublisher,
    db::{acquire_db, Database, PrRow},
    github_client::{GitHubClient, PullRequest},
};
use std::sync::{Arc, Mutex};

/// One background attempt. Linking remains visible even if GitHub is unavailable.
pub(crate) fn hydrate_linked_pr(
    db: Arc<Mutex<Database>>,
    client: GitHubClient,
    events: RuntimeEventPublisher,
    pr: PrRow,
    verified_details: Option<PullRequest>,
) {
    let mut requests =
        super::refresh_requests::RefreshRequests::new(&client, std::slice::from_ref(&pr));
    requests.seed(pr.id, verified_details);
    tokio::spawn(async move {
        let _permit = client.acquire_refresh_permit().await;
        let current = acquire_db(&db).get_pull_request_by_id(pr.id).ok().flatten();
        if !current
            .as_ref()
            .is_some_and(|current| super::persistence::same_pr_snapshot(&pr, current))
        {
            return;
        }
        let now = super::scheduling::current_unix_timestamp();
        if client
            .get_last_rate_limit_reset()
            .is_some_and(|reset| now.map_or(true, |now| reset > now))
        {
            return;
        }
        let Ok(Some(token)) = client.github_token().await else {
            return;
        };
        let username = acquire_db(&db).get_config("github_username").ok().flatten();
        let _ = tokio::time::timeout(
            std::time::Duration::from_secs(30),
            poll_prs_for_project(
                &client,
                &db,
                &GitHubEventTarget::runtime(events),
                &token,
                username.as_deref(),
                vec![pr],
                &mut requests,
            ),
        )
        .await;
    });
}
