use crate::{
    db::PrRow,
    github_client::{GitHubClient, PrRefreshRequest},
};
use std::collections::HashMap;

/// Retain tickets for a whole refresh, so recovery and normal polling in the same
/// cycle cannot fetch the same newly associated PR twice.
#[derive(Default)]
pub(super) struct RefreshRequests {
    tickets: HashMap<String, PrRefreshRequest>,
    seeds: HashMap<i64, crate::github_client::PullRequest>,
}
impl RefreshRequests {
    pub(super) fn new(client: &GitHubClient, prs: &[PrRow]) -> Self {
        let mut requests = Self::default();
        for pr in prs {
            requests.register(client, pr);
        }
        requests
    }
    fn key(pr: &PrRow) -> String {
        format!(
            "{}/{}/{}:{}",
            pr.repo_owner.to_ascii_lowercase(),
            pr.repo_name.to_ascii_lowercase(),
            pr.pr_number,
            pr.ticket_id
        )
    }
    fn register(&mut self, client: &GitHubClient, pr: &PrRow) -> &PrRefreshRequest {
        let key = Self::key(pr);
        self.tickets
            .entry(key.clone())
            .or_insert_with(|| client.pr_refresh_request(key))
    }
    pub(super) fn seed(&mut self, id: i64, details: Option<crate::github_client::PullRequest>) {
        if let Some(details) = details {
            self.seeds.insert(id, details);
        }
    }
    pub(super) fn take_seed(&mut self, id: i64) -> Option<crate::github_client::PullRequest> {
        self.seeds.remove(&id)
    }
    pub(super) fn claim(&mut self, client: &GitHubClient, pr: &PrRow) -> bool {
        self.register(client, pr).claim()
    }
}
