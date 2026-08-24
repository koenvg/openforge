use super::{CompanionActionPaletteError, DatabaseCompanionActionPaletteService};
use std::sync::Arc;

fn scope() -> crate::github_poller::PollScope {
    crate::github_poller::PollScope::Global
}

impl From<crate::github_poller::ManualGithubSyncError> for CompanionActionPaletteError {
    fn from(error: crate::github_poller::ManualGithubSyncError) -> Self {
        match error {
            crate::github_poller::ManualGithubSyncError::MissingToken => Self::GithubTokenMissing,
            crate::github_poller::ManualGithubSyncError::TokenUnavailable => {
                Self::GithubTokenUnavailable
            }
            crate::github_poller::ManualGithubSyncError::PollErrors { count } => {
                Self::GithubSyncFailed { errors: count }
            }
            crate::github_poller::ManualGithubSyncError::RateLimited { .. } => {
                Self::GithubRateLimited
            }
        }
    }
}

pub(super) async fn execute(
    service: &DatabaseCompanionActionPaletteService,
) -> Result<(), CompanionActionPaletteError> {
    let result = crate::github_poller::poll_github_once_for_sidecar(
        Arc::clone(&service.database),
        &service.github_client,
        service.app_event_tx.clone(),
        scope(),
    )
    .await;
    if let Some(error) = result.manual_sync_error() {
        return Err(error.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refresh_uses_the_global_poll_scope() {
        assert_eq!(scope(), crate::github_poller::PollScope::Global);
    }

    #[test]
    fn refresh_maps_manual_sync_failures_to_palette_errors() {
        let cases = [
            (
                crate::github_poller::ManualGithubSyncError::MissingToken,
                CompanionActionPaletteError::GithubTokenMissing,
            ),
            (
                crate::github_poller::ManualGithubSyncError::TokenUnavailable,
                CompanionActionPaletteError::GithubTokenUnavailable,
            ),
            (
                crate::github_poller::ManualGithubSyncError::PollErrors { count: 3 },
                CompanionActionPaletteError::GithubSyncFailed { errors: 3 },
            ),
            (
                crate::github_poller::ManualGithubSyncError::RateLimited {
                    reset_at: Some(123),
                },
                CompanionActionPaletteError::GithubRateLimited,
            ),
        ];

        for (source, expected) in cases {
            assert_eq!(CompanionActionPaletteError::from(source), expected);
        }
    }
}
