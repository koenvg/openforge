//! Jira Cloud REST v3 client, scoped to the single read the PR review needs.

use serde::Serialize;
use serde_json::Value;

use super::adf::adf_to_text;

/// The fields every Jira instance has.
const BASE_FIELDS: &str = "summary,description,status,issuetype";

/// A Jira work item, flattened for the prompt and the review UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct JiraWorkItem {
    pub issue_key: String,
    pub url: String,
    pub summary: String,
    pub description: String,
    /// Text of the configured acceptance-criteria custom field. Empty when no
    /// field id is configured or the ticket leaves it blank; the prompt then
    /// falls back to an "Acceptance Criteria" section in the description.
    pub acceptance_criteria: String,
    pub status: Option<String>,
    pub issue_type: Option<String>,
}

/// Acceptance criteria live in a custom field whose id differs per Jira
/// instance (Collibra uses `customfield_12100`), so it is configuration rather
/// than a constant. A blank id is treated as "not configured".
fn normalized_field_id(ac_field_id: Option<&str>) -> Option<&str> {
    ac_field_id.map(str::trim).filter(|id| !id.is_empty())
}

/// The `fields=` query value: the base set, plus the acceptance-criteria field
/// when one is configured.
fn requested_fields(ac_field_id: Option<&str>) -> String {
    match normalized_field_id(ac_field_id) {
        Some(id) => format!("{BASE_FIELDS},{id}"),
        None => BASE_FIELDS.to_string(),
    }
}

/// Site URLs are pasted from a browser, so a trailing slash is common.
fn normalized_base(base_url: &str) -> &str {
    base_url.trim().trim_end_matches('/')
}

/// REST endpoint for one issue.
pub fn issue_api_url(base_url: &str, issue_key: &str, ac_field_id: Option<&str>) -> String {
    format!(
        "{}/rest/api/3/issue/{issue_key}?fields={}",
        normalized_base(base_url),
        requested_fields(ac_field_id)
    )
}

/// REST endpoint identifying the authenticated account, used by Test connection.
pub fn myself_api_url(base_url: &str) -> String {
    format!("{}/rest/api/3/myself", normalized_base(base_url))
}

/// Human-facing browse link, for the "open in Jira" action.
pub fn browse_url(base_url: &str, issue_key: &str) -> String {
    format!("{}/browse/{issue_key}", normalized_base(base_url))
}

/// Turn a non-success HTTP status into something a reviewer can act on.
pub fn describe_http_error(status: u16, issue_key: &str) -> String {
    match status {
        401 => "Jira rejected the credentials (401). Check the email and API token in the Jira \
                settings."
            .to_string(),
        403 => format!(
            "Jira denied access to {issue_key} (403). The account may not have permission to view \
             this ticket."
        ),
        404 => format!(
            "Jira ticket {issue_key} was not found (404). Check the ticket key and the site URL."
        ),
        429 => "Jira rate-limited the request (429). Try again shortly.".to_string(),
        other => format!("Jira request for {issue_key} failed with HTTP {other}."),
    }
}

/// Build a work item from a Jira issue payload.
pub fn parse_work_item(
    base_url: &str,
    issue_key: &str,
    payload: &Value,
    ac_field_id: Option<&str>,
) -> JiraWorkItem {
    let fields = payload.get("fields");
    let field = |name: &str| fields.and_then(|fields| fields.get(name));
    let named = |name: &str| {
        field(name)
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .map(str::to_string)
    };

    // The AC field is ADF like the description. `acli`'s plaintext renderer
    // drops these silently, which is why this goes through the JSON shape.
    let acceptance_criteria = normalized_field_id(ac_field_id)
        .and_then(field)
        .map(adf_to_text)
        .unwrap_or_default();

    JiraWorkItem {
        issue_key: issue_key.to_string(),
        url: browse_url(base_url, issue_key),
        summary: field("summary")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        description: field("description").map(adf_to_text).unwrap_or_default(),
        acceptance_criteria,
        status: named("status"),
        issue_type: named("issuetype"),
    }
}

/// Jira is a remote dependency on the walkthrough's critical path; cap it well
/// under the agent generation timeout so a hanging site can't eat the budget.
const REQUEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(20);

fn http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .map_err(|error| format!("could not build the Jira HTTP client: {error}"))
}

/// Fetch one work item. Credentials are passed in by the caller, which reads the
/// token from the keychain — they never reach the plugin layer.
pub async fn fetch_work_item(
    base_url: &str,
    email: &str,
    token: &str,
    issue_key: &str,
    ac_field_id: Option<&str>,
) -> Result<JiraWorkItem, String> {
    let response = http_client()?
        .get(issue_api_url(base_url, issue_key, ac_field_id))
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Jira request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(describe_http_error(status.as_u16(), issue_key));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Jira returned a response that could not be parsed: {error}"))?;

    Ok(parse_work_item(base_url, issue_key, &payload, ac_field_id))
}

/// Verify the credentials and return the account's display name.
pub async fn fetch_current_user(
    base_url: &str,
    email: &str,
    token: &str,
) -> Result<String, String> {
    let response = http_client()?
        .get(myself_api_url(base_url))
        .basic_auth(email, Some(token))
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|error| format!("Jira request failed: {error}"))?;

    let status = response.status();
    if !status.is_success() {
        return Err(describe_http_error(status.as_u16(), "the current user"));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("Jira returned a response that could not be parsed: {error}"))?;

    Ok(payload
        .get("displayName")
        .and_then(Value::as_str)
        .unwrap_or(email)
        .to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn issue_api_url_targets_rest_v3() {
        assert_eq!(
            issue_api_url("https://collibra.atlassian.net", "AVIV-304", None),
            "https://collibra.atlassian.net/rest/api/3/issue/AVIV-304?fields=summary,description,status,issuetype"
        );
    }

    #[test]
    fn issue_api_url_requests_the_acceptance_criteria_field_when_configured() {
        assert_eq!(
            issue_api_url(
                "https://collibra.atlassian.net",
                "AVIV-304",
                Some("customfield_12100")
            ),
            "https://collibra.atlassian.net/rest/api/3/issue/AVIV-304?fields=summary,description,status,issuetype,customfield_12100"
        );
    }

    #[test]
    fn a_blank_acceptance_criteria_field_id_is_treated_as_unconfigured() {
        assert_eq!(
            issue_api_url("https://collibra.atlassian.net", "AVIV-304", Some("   ")),
            issue_api_url("https://collibra.atlassian.net", "AVIV-304", None),
        );
    }

    #[test]
    fn issue_api_url_tolerates_a_trailing_slash_on_the_base_url() {
        // Users paste the site URL from the browser, which often keeps the slash.
        assert_eq!(
            issue_api_url("https://collibra.atlassian.net/", "AVIV-304", None),
            issue_api_url("https://collibra.atlassian.net", "AVIV-304", None),
        );
    }

    #[test]
    fn browse_url_builds_the_human_link() {
        assert_eq!(
            browse_url("https://collibra.atlassian.net/", "AVIV-304"),
            "https://collibra.atlassian.net/browse/AVIV-304"
        );
    }

    #[test]
    fn unauthorized_points_at_the_credentials_setting() {
        let message = describe_http_error(401, "AVIV-304");
        assert!(message.contains("401"), "{message}");
        assert!(message.to_lowercase().contains("token"), "{message}");
    }

    #[test]
    fn forbidden_points_at_permissions_rather_than_credentials() {
        let message = describe_http_error(403, "AVIV-304");
        assert!(message.to_lowercase().contains("permission"), "{message}");
    }

    #[test]
    fn not_found_names_the_ticket() {
        let message = describe_http_error(404, "AVIV-304");
        assert!(message.contains("AVIV-304"), "{message}");
    }

    #[test]
    fn parse_work_item_extracts_fields_and_flattens_the_description() {
        let payload = json!({
            "key": "AVIV-304",
            "fields": {
                "summary": "Compare the PR against its Jira ticket",
                "status": { "name": "In Progress" },
                "issuetype": { "name": "Story" },
                "description": {
                    "type": "doc",
                    "version": 1,
                    "content": [{
                        "type": "paragraph",
                        "content": [{ "type": "text", "text": "Reviewers need the ticket." }],
                    }],
                },
            },
        });

        let item = parse_work_item("https://collibra.atlassian.net", "AVIV-304", &payload, None);

        assert_eq!(item.issue_key, "AVIV-304");
        assert_eq!(item.summary, "Compare the PR against its Jira ticket");
        assert_eq!(item.description, "Reviewers need the ticket.");
        assert_eq!(item.status.as_deref(), Some("In Progress"));
        assert_eq!(item.issue_type.as_deref(), Some("Story"));
        assert_eq!(item.url, "https://collibra.atlassian.net/browse/AVIV-304");
    }

    #[test]
    fn parse_work_item_reads_acceptance_criteria_from_the_configured_custom_field() {
        // The AC field is the source of truth the diff is judged against, so it
        // has to survive ADF flattening intact.
        let payload = json!({
            "fields": {
                "summary": "Compare the PR against its Jira ticket",
                "customfield_12100": {
                    "type": "doc",
                    "version": 1,
                    "content": [{
                        "type": "bulletList",
                        "content": [
                            { "type": "listItem", "content": [{
                                "type": "paragraph",
                                "content": [{ "type": "text", "text": "The reviewer sees per-criterion coverage." }],
                            }]},
                            { "type": "listItem", "content": [{
                                "type": "paragraph",
                                "content": [{ "type": "text", "text": "Out-of-scope changes are listed separately." }],
                            }]},
                        ],
                    }],
                },
            },
        });

        let item = parse_work_item(
            "https://collibra.atlassian.net",
            "AVIV-304",
            &payload,
            Some("customfield_12100"),
        );

        assert_eq!(
            item.acceptance_criteria,
            "- The reviewer sees per-criterion coverage.\n- Out-of-scope changes are listed separately."
        );
    }

    #[test]
    fn acceptance_criteria_is_empty_when_no_field_id_is_configured() {
        // Without a configured id we must not guess at a custom field, even if
        // one happens to be present in the payload.
        let payload = json!({
            "fields": {
                "summary": "s",
                "customfield_12100": { "type": "doc", "version": 1, "content": [] },
            },
        });

        let item = parse_work_item("https://collibra.atlassian.net", "AVIV-304", &payload, None);

        assert_eq!(item.acceptance_criteria, "");
    }

    #[test]
    fn acceptance_criteria_is_empty_when_the_ticket_leaves_the_field_blank() {
        // Jira returns null for an unfilled custom field. The prompt then falls
        // back to an "Acceptance Criteria" section in the description.
        let payload = json!({ "fields": { "summary": "s", "customfield_12100": null } });

        let item = parse_work_item(
            "https://collibra.atlassian.net",
            "AVIV-304",
            &payload,
            Some("customfield_12100"),
        );

        assert_eq!(item.acceptance_criteria, "");
    }

    #[test]
    fn parse_work_item_tolerates_a_ticket_with_no_description_or_status() {
        // A thin ticket is still worth showing; only the gap analysis suffers.
        let payload = json!({ "fields": { "summary": "Thin ticket" } });

        let item = parse_work_item("https://collibra.atlassian.net", "AVIV-9", &payload, None);

        assert_eq!(item.summary, "Thin ticket");
        assert_eq!(item.description, "");
        assert_eq!(item.status, None);
        assert_eq!(item.issue_type, None);
    }

    #[test]
    fn parse_work_item_survives_a_payload_with_no_fields_object() {
        let item = parse_work_item("https://collibra.atlassian.net", "AVIV-9", &json!({}), None);
        assert_eq!(item.issue_key, "AVIV-9");
        assert_eq!(item.summary, "");
    }
}
