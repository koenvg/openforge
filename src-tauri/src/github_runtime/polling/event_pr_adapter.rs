use crate::github_client::{PrRef, PullRequest, SearchPrResult};

/// Adapt a detail response for a PR already known to the authored-PR cache.
pub(super) fn from_event_detail(
    pr_ref: &PrRef,
    existing_id: i64,
    details: PullRequest,
) -> SearchPrResult {
    SearchPrResult {
        id: existing_id,
        number: details.number,
        title: details.title,
        body: details
            .extra
            .get("body")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        state: details.state,
        draft: details.draft.unwrap_or(false),
        html_url: details.html_url,
        user_login: details.user.login,
        user_avatar_url: details
            .user
            .extra
            .get("avatar_url")
            .and_then(|value| value.as_str())
            .map(ToOwned::to_owned),
        repo_owner: pr_ref.repo_owner.clone(),
        repo_name: pr_ref.repo_name.clone(),
        head_ref: details.head.ref_name,
        base_ref: details
            .extra
            .get("base")
            .and_then(|base| base.get("ref"))
            .and_then(|value| value.as_str())
            .unwrap_or("main")
            .to_string(),
        head_sha: details.head.sha,
        additions: details
            .extra
            .get("additions")
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
        deletions: details
            .extra
            .get("deletions")
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
        changed_files: details
            .extra
            .get("changed_files")
            .and_then(|value| value.as_i64())
            .unwrap_or(0),
        mergeable: details.mergeable,
        mergeable_state: details.mergeable_state,
        created_at: details
            .extra
            .get("created_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        updated_at: details
            .extra
            .get("updated_at")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_string(),
        labels: details
            .extra
            .get("labels")
            .and_then(|value| {
                serde_json::from_value::<Vec<crate::github_client::PrLabel>>(value.clone()).ok()
            })
            .unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    use super::from_event_detail;
    use crate::github_client::{PrRef, PullRequest};
    use serde_json::json;

    #[test]
    fn missing_optional_detail_fields_use_event_refresh_defaults() {
        let pr_ref = PrRef {
            repo_owner: "acme".into(),
            repo_name: "widgets".into(),
            number: 7,
        };
        let details: PullRequest = serde_json::from_value(json!({
            "number": 7,
            "title": "Fix widgets",
            "state": "open",
            "html_url": "https://github.com/acme/widgets/pull/7",
            "user": {"login": "alice"},
            "head": {"ref": "fix", "sha": "abc123"},
            "labels": "not an array"
        }))
        .unwrap();

        let result = from_event_detail(&pr_ref, 987, details);
        assert_eq!(result.id, 987);
        assert_eq!(result.number, 7);
        assert_eq!(result.repo_owner, "acme");
        assert_eq!(result.repo_name, "widgets");
        assert_eq!(result.title, "Fix widgets");
        assert_eq!(result.state, "open");
        assert_eq!(result.html_url, "https://github.com/acme/widgets/pull/7");
        assert_eq!(result.user_login, "alice");
        assert_eq!(result.head_ref, "fix");
        assert_eq!(result.head_sha, "abc123");
        assert_eq!(result.body, None);
        assert_eq!(result.user_avatar_url, None);
        assert!(!result.draft);
        assert_eq!(result.base_ref, "main");
        assert_eq!(
            (result.additions, result.deletions, result.changed_files),
            (0, 0, 0)
        );
        assert_eq!(result.mergeable, None);
        assert_eq!(result.mergeable_state, None);
        assert_eq!(result.created_at, "");
        assert_eq!(result.updated_at, "");
        assert!(result.labels.is_empty());
    }

    #[test]
    fn populated_detail_fields_are_preserved() {
        let pr_ref = PrRef {
            repo_owner: "upstream".into(),
            repo_name: "project".into(),
            number: 42,
        };
        let details: PullRequest = serde_json::from_value(json!({
            "number": 42, "title": "Ready", "state": "closed", "draft": true,
            "html_url": "https://github.com/upstream/project/pull/42",
            "user": {"login": "bob", "avatar_url": "https://example.com/avatar.png"},
            "head": {"ref": "topic", "sha": "deadbeef"},
            "body": "The change", "base": {"ref": "release"},
            "additions": 12, "deletions": 3, "changed_files": 2,
            "mergeable": true, "mergeable_state": "clean",
            "created_at": "2026-01-01T00:00:00Z",
            "updated_at": "2026-01-02T00:00:00Z",
            "labels": [{"name": "ready", "color": "aabbcc"}]
        }))
        .unwrap();

        let result = from_event_detail(&pr_ref, 500, details);
        assert_eq!(result.id, 500);
        assert_eq!(result.body.as_deref(), Some("The change"));
        assert_eq!(
            result.user_avatar_url.as_deref(),
            Some("https://example.com/avatar.png")
        );
        assert!(result.draft);
        assert_eq!(result.base_ref, "release");
        assert_eq!(
            (result.additions, result.deletions, result.changed_files),
            (12, 3, 2)
        );
        assert_eq!(result.mergeable, Some(true));
        assert_eq!(result.mergeable_state.as_deref(), Some("clean"));
        assert_eq!(result.created_at, "2026-01-01T00:00:00Z");
        assert_eq!(result.updated_at, "2026-01-02T00:00:00Z");
        assert_eq!(result.labels.len(), 1);
        assert_eq!(result.labels[0].name, "ready");
        assert_eq!(result.labels[0].color, "aabbcc");
    }
}
