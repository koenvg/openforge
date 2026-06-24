//! Roadmap board commands.
//!
//! A per-project Kanban board over GitHub Issues. GitHub is the source of truth
//! for issues and labels; only per-issue `value` and the curated `columnLabels`
//! ordering are persisted locally (see `db/roadmap.rs`). Modeled on
//! `github_review.rs`: returns `Ok(None)` for unmatched commands so the
//! dispatcher can fall through.

use super::{json_value, payload_i64, payload_optional_string, payload_string, AppResult};
use crate::github_client::{EditIssueInput, GitHubClient, Issue, RepoLabel};
use crate::{http_server::AppInvokeRequest, http_server::AppState};
use axum::http::StatusCode;
use serde::Serialize;
use std::collections::HashMap;

fn runtime_error(error: String) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, error)
}

fn bad_request(error: String) -> (StatusCode, String) {
    (StatusCode::BAD_REQUEST, error)
}

/// Resolved GitHub coordinates for a project.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RepoRef {
    pub owner: String,
    pub name: String,
}

/// A repo label augmented with whether it is currently used by any open issue.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct LabelUsage {
    pub name: String,
    pub color: String,
    pub used: bool,
}

/// Parse a GitHub `owner/name` from either a `custom_repo_hint` string or a git
/// remote URL.
///
/// Accepts:
/// - `owner/name` (the project-config hint form)
/// - `https://github.com/owner/name(.git)`
/// - `git@github.com:owner/name(.git)`
/// - `ssh://git@github.com/owner/name(.git)`
pub fn parse_owner_name(raw: &str) -> Option<RepoRef> {
    let trimmed = raw.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return None;
    }

    // Strip transport + host to isolate the `owner/name` path.
    let path = if let Some(rest) = trimmed.strip_prefix("git@") {
        // git@github.com:owner/name(.git)
        rest.split_once(':').map(|(_, p)| p).unwrap_or(rest)
    } else if let Some(rest) = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .or_else(|| trimmed.strip_prefix("ssh://git@"))
        .or_else(|| trimmed.strip_prefix("ssh://"))
    {
        // host/owner/name(.git) — drop the host segment.
        rest.split_once('/').map(|(_, p)| p).unwrap_or(rest)
    } else {
        // Bare `owner/name` hint.
        trimmed
    };

    let path = path.trim_matches('/');
    let path = path.strip_suffix(".git").unwrap_or(path);

    let segments: Vec<&str> = path.split('/').filter(|s| !s.is_empty()).collect();
    if segments.len() < 2 {
        return None;
    }
    // Take the first two non-empty segments as owner/name.
    let owner = segments[0].to_string();
    let name = segments[1].to_string();
    if owner.is_empty() || name.is_empty() {
        return None;
    }
    Some(RepoRef { owner, name })
}

/// Compute, for each repo label, whether at least one open issue carries it.
/// Returns labels in the same order as `repo_labels`.
pub fn compute_label_usage(repo_labels: &[RepoLabel], issues: &[Issue]) -> Vec<LabelUsage> {
    let mut used_names: std::collections::HashSet<&str> = std::collections::HashSet::new();
    for issue in issues {
        for label in &issue.labels {
            used_names.insert(label.name.as_str());
        }
    }
    repo_labels
        .iter()
        .map(|label| LabelUsage {
            name: label.name.clone(),
            color: label.color.clone(),
            used: used_names.contains(label.name.as_str()),
        })
        .collect()
}

/// Resolve the GitHub `owner/name` for a project.
///
/// Order: project-config `custom_repo_hint`, then `git remote get-url origin`
/// parsed from the project's working directory. Returns a clear error when the
/// project does not exist or has no GitHub remote.
async fn resolve_repo_ref(state: &AppState, project_id: &str) -> Result<RepoRef, String> {
    let (repo_hint, project_path) = {
        let db = crate::db::acquire_db(&state.db);
        let project = db
            .get_project(project_id)
            .map_err(|e| format!("failed to load project: {e}"))?
            .ok_or_else(|| format!("project {project_id} not found"))?;
        let hint = db
            .get_project_config(project_id, "custom_repo_hint")
            .map_err(|e| format!("failed to load project config: {e}"))?;
        (hint, project.path)
    };

    if let Some(hint) = repo_hint {
        if let Some(repo) = parse_owner_name(&hint) {
            return Ok(repo);
        }
    }

    let remote_url = git_origin_url(&project_path).await.ok_or_else(|| {
        format!(
            "no GitHub repository configured for project {project_id}: \
             set a custom_repo_hint or an origin remote on {project_path}"
        )
    })?;

    parse_owner_name(&remote_url).ok_or_else(|| {
        format!("could not parse a GitHub owner/name from origin remote '{remote_url}'")
    })
}

/// Run `git -C <path> remote get-url origin`, returning the trimmed URL or
/// `None` when there is no origin remote.
async fn git_origin_url(project_path: &str) -> Option<String> {
    let output = tokio::process::Command::new("git")
        .arg("-C")
        .arg(project_path)
        .arg("remote")
        .arg("get-url")
        .arg("origin")
        .output()
        .await
        .ok()?;

    if !output.status.success() {
        return None;
    }

    let url = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if url.is_empty() {
        None
    } else {
        Some(url)
    }
}

fn token() -> AppResult<String> {
    crate::github_runtime::github_token().map_err(bad_request)
}

/// Serialize the per-issue value map as `{ "<issueNumber>": value }`.
fn values_to_json(values: &HashMap<i64, i64>) -> serde_json::Value {
    let map: serde_json::Map<String, serde_json::Value> = values
        .iter()
        .map(|(issue_number, value)| (issue_number.to_string(), serde_json::json!(value)))
        .collect();
    serde_json::Value::Object(map)
}

pub(super) async fn handle_app_roadmap_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let value = match request.command.as_str() {
        "roadmap_get_board" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let repo = resolve_repo_ref(state, &project_id)
                .await
                .map_err(bad_request)?;
            let token = token()?;
            let client: GitHubClient = state.github_client.clone();

            let issues = client
                .list_open_issues(&repo.owner, &repo.name, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to list issues: {e}")))?;
            let labels = client
                .list_labels(&repo.owner, &repo.name, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to list labels: {e}")))?;

            let (values, column_labels) = {
                let db = crate::db::acquire_db(&state.db);
                let values = db
                    .get_roadmap_values(&project_id)
                    .map_err(|e| runtime_error(format!("failed to load roadmap values: {e}")))?;
                // On first open (no config row yet) seed the columns from the
                // labels actually used by open issues, in repo-label order, and
                // persist so we never re-seed. A user who later clears all
                // columns keeps an empty row and is not re-seeded.
                let column_labels = match db
                    .get_roadmap_column_labels_opt(&project_id)
                    .map_err(|e| runtime_error(format!("failed to load roadmap columns: {e}")))?
                {
                    Some(existing) => existing,
                    None => {
                        let seeded: Vec<String> = compute_label_usage(&labels, &issues)
                            .into_iter()
                            .filter(|usage| usage.used)
                            .map(|usage| usage.name)
                            .collect();
                        db.set_roadmap_column_labels(&project_id, &seeded).map_err(|e| {
                            runtime_error(format!("failed to seed roadmap columns: {e}"))
                        })?;
                        seeded
                    }
                };
                (values, column_labels)
            };

            json_value(serde_json::json!({
                "repo": repo,
                "issues": issues,
                "labels": labels,
                "values": values_to_json(&values),
                "columnLabels": column_labels,
            }))?
        }
        "roadmap_set_value" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let issue_number = payload_i64(&request.payload, "issueNumber")?;
            let value = roadmap_value_field(&request.payload)?;

            let db = crate::db::acquire_db(&state.db);
            db.set_roadmap_value(&project_id, issue_number, value)
                .map_err(|e| runtime_error(format!("failed to set roadmap value: {e}")))?;
            serde_json::Value::Null
        }
        "roadmap_get_config" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let repo = resolve_repo_ref(state, &project_id)
                .await
                .map_err(bad_request)?;
            let token = token()?;
            let client: GitHubClient = state.github_client.clone();

            let issues = client
                .list_open_issues(&repo.owner, &repo.name, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to list issues: {e}")))?;
            let labels = client
                .list_labels(&repo.owner, &repo.name, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to list labels: {e}")))?;

            let column_labels = {
                let db = crate::db::acquire_db(&state.db);
                db.get_roadmap_column_labels(&project_id)
                    .map_err(|e| runtime_error(format!("failed to load roadmap columns: {e}")))?
            };

            json_value(serde_json::json!({
                "columnLabels": column_labels,
                "labels": compute_label_usage(&labels, &issues),
            }))?
        }
        "roadmap_set_column_labels" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let labels = super::payload_string_vec(&request.payload, "labels")?;

            let db = crate::db::acquire_db(&state.db);
            db.set_roadmap_column_labels(&project_id, &labels)
                .map_err(|e| runtime_error(format!("failed to set roadmap columns: {e}")))?;
            serde_json::Value::Null
        }
        "roadmap_create_issue" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let title = payload_string(&request.payload, "title")?;
            let body = payload_optional_string(&request.payload, "body")?.unwrap_or_default();
            let labels =
                super::payload_optional_string_vec(&request.payload, "labels")?.unwrap_or_default();
            let repo = resolve_repo_ref(state, &project_id)
                .await
                .map_err(bad_request)?;
            let token = token()?;

            let issue = state
                .github_client
                .create_issue(&repo.owner, &repo.name, &title, &body, &labels, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to create issue: {e}")))?;

            json_value(serde_json::json!({ "issue": issue }))?
        }
        "roadmap_edit_issue" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let number = payload_i64(&request.payload, "number")?;
            let input = EditIssueInput {
                title: payload_optional_string(&request.payload, "title")?,
                body: payload_optional_string(&request.payload, "body")?,
                state: payload_optional_string(&request.payload, "state")?,
                add_labels: super::payload_optional_string_vec(&request.payload, "addLabels")?
                    .unwrap_or_default(),
                remove_labels: super::payload_optional_string_vec(
                    &request.payload,
                    "removeLabels",
                )?
                .unwrap_or_default(),
            };
            let repo = resolve_repo_ref(state, &project_id)
                .await
                .map_err(bad_request)?;
            let token = token()?;

            state
                .github_client
                .edit_issue(&repo.owner, &repo.name, number, input, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to edit issue: {e}")))?;
            serde_json::Value::Null
        }
        "roadmap_update_label_color" => {
            let project_id = payload_string(&request.payload, "projectId")?;
            let name = payload_string(&request.payload, "name")?;
            let color = roadmap_label_color_field(&request.payload)?;
            let repo = resolve_repo_ref(state, &project_id)
                .await
                .map_err(bad_request)?;
            let token = token()?;

            state
                .github_client
                .update_label_color(&repo.owner, &repo.name, &name, &color, &token)
                .await
                .map_err(|e| runtime_error(format!("failed to update label color: {e}")))?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

/// Read the `value` payload field, which may be a number (1..=10) or null.
fn roadmap_value_field(payload: &serde_json::Value) -> AppResult<Option<i64>> {
    match payload.get("value") {
        None | Some(serde_json::Value::Null) => Ok(None),
        Some(value) => {
            let value = value.as_i64().ok_or_else(|| {
                bad_request("payload.value must be an integer or null".to_string())
            })?;
            if !(1..=10).contains(&value) {
                return Err(bad_request(
                    "payload.value must be between 1 and 10".to_string(),
                ));
            }
            Ok(Some(value))
        }
    }
}

/// Read the `color` payload field as a normalized GitHub six-digit hex string.
fn roadmap_label_color_field(payload: &serde_json::Value) -> AppResult<String> {
    let color = payload_string(payload, "color")?
        .trim()
        .trim_start_matches('#')
        .to_lowercase();
    if color.len() != 6 || !color.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(bad_request(
            "payload.color must be a six-digit hex color".to_string(),
        ));
    }
    Ok(color)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::github_client::{Issue, IssueLabel, RepoLabel};

    fn issue_with_labels(number: i64, label_names: &[&str]) -> Issue {
        Issue {
            number,
            title: format!("Issue {number}"),
            body: None,
            state: "open".to_string(),
            html_url: format!("https://github.com/acme/repo/issues/{number}"),
            user: serde_json::from_value(serde_json::json!({ "login": "octocat" })).unwrap(),
            labels: label_names
                .iter()
                .map(|name| IssueLabel {
                    name: name.to_string(),
                    color: "ffffff".to_string(),
                })
                .collect(),
            pull_request: None,
            created_at: String::new(),
            updated_at: String::new(),
        }
    }

    #[test]
    fn parse_owner_name_handles_https_ssh_scp_and_bare_hint() {
        let expected = Some(RepoRef {
            owner: "acme".to_string(),
            name: "repo".to_string(),
        });
        assert_eq!(parse_owner_name("acme/repo"), expected);
        assert_eq!(parse_owner_name("acme/repo/"), expected);
        assert_eq!(parse_owner_name("https://github.com/acme/repo"), expected);
        assert_eq!(
            parse_owner_name("https://github.com/acme/repo.git"),
            expected
        );
        assert_eq!(parse_owner_name("git@github.com:acme/repo.git"), expected);
        assert_eq!(
            parse_owner_name("ssh://git@github.com/acme/repo.git"),
            expected
        );
        assert_eq!(
            parse_owner_name("https://github.com/acme/repo/extra/path"),
            expected
        );
    }

    #[test]
    fn parse_owner_name_rejects_incomplete_inputs() {
        assert_eq!(parse_owner_name(""), None);
        assert_eq!(parse_owner_name("   "), None);
        assert_eq!(parse_owner_name("acme"), None);
        assert_eq!(parse_owner_name("https://github.com/acme"), None);
    }

    #[test]
    fn compute_label_usage_marks_labels_present_on_any_open_issue() {
        let repo_labels = vec![
            RepoLabel {
                name: "feature".to_string(),
                color: "00ff00".to_string(),
            },
            RepoLabel {
                name: "bug".to_string(),
                color: "ff0000".to_string(),
            },
            RepoLabel {
                name: "stale".to_string(),
                color: "cccccc".to_string(),
            },
        ];
        let issues = vec![
            issue_with_labels(1, &["feature"]),
            issue_with_labels(2, &["feature", "bug"]),
        ];

        let usage = compute_label_usage(&repo_labels, &issues);
        assert_eq!(usage.len(), 3);
        // Order is preserved.
        assert_eq!(usage[0].name, "feature");
        assert!(usage[0].used);
        assert_eq!(usage[1].name, "bug");
        assert!(usage[1].used);
        assert_eq!(usage[2].name, "stale");
        assert!(!usage[2].used);
    }

    #[test]
    fn values_to_json_serializes_issue_number_keyed_map() {
        let mut values = HashMap::new();
        values.insert(7, 5);
        values.insert(9, 10);
        let json = values_to_json(&values);
        assert_eq!(json.get("7").and_then(|v| v.as_i64()), Some(5));
        assert_eq!(json.get("9").and_then(|v| v.as_i64()), Some(10));
    }

    #[test]
    fn roadmap_value_field_accepts_null_and_in_range_and_rejects_out_of_range() {
        assert_eq!(
            roadmap_value_field(&serde_json::json!({ "value": null })).unwrap(),
            None
        );
        assert_eq!(roadmap_value_field(&serde_json::json!({})).unwrap(), None);
        assert_eq!(
            roadmap_value_field(&serde_json::json!({ "value": 1 })).unwrap(),
            Some(1)
        );
        assert_eq!(
            roadmap_value_field(&serde_json::json!({ "value": 10 })).unwrap(),
            Some(10)
        );
        assert!(roadmap_value_field(&serde_json::json!({ "value": 0 })).is_err());
        assert!(roadmap_value_field(&serde_json::json!({ "value": 11 })).is_err());
        assert!(roadmap_value_field(&serde_json::json!({ "value": "x" })).is_err());
    }

    #[test]
    fn roadmap_label_color_field_accepts_six_hex_digits_and_rejects_other_values() {
        assert_eq!(
            roadmap_label_color_field(&serde_json::json!({ "color": "0E8A16" })).unwrap(),
            "0e8a16"
        );
        assert_eq!(
            roadmap_label_color_field(&serde_json::json!({ "color": "#c5def5" })).unwrap(),
            "c5def5"
        );

        assert!(roadmap_label_color_field(&serde_json::json!({})).is_err());
        assert!(roadmap_label_color_field(&serde_json::json!({ "color": "fff" })).is_err());
        assert!(roadmap_label_color_field(&serde_json::json!({ "color": "nothex" })).is_err());
        assert!(roadmap_label_color_field(&serde_json::json!({ "color": 7 })).is_err());
    }
}
