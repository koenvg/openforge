use super::rows::PrRow;

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PersistedMergeMethodPolicy {
    pub(crate) allowed: Vec<crate::github_client::PullRequestMergeMethod>,
    pub(crate) default: Option<crate::github_client::PullRequestMergeMethod>,
}

impl PrRow {
    pub(crate) fn merge_method_policy(&self) -> Option<PersistedMergeMethodPolicy> {
        if self.merge_methods_policy_known != Some(true) {
            return None;
        }
        let allowed = serde_json::from_str::<Vec<crate::github_client::PullRequestMergeMethod>>(
            self.allowed_merge_methods.as_deref()?,
        )
        .ok()?;
        let default = self
            .default_merge_method
            .as_deref()
            .and_then(crate::github_client::PullRequestMergeMethod::from_github_value)
            .filter(|method| allowed.contains(method));
        Some(PersistedMergeMethodPolicy { allowed, default })
    }
}
