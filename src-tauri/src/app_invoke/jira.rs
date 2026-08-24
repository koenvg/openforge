//! Jira commands backing the PR review gap analysis.
//!
//! The API token lives in the keychain under `jira_api_token`. It enters here
//! once, when the plugin's settings form saves it, and is never handed back out:
//! `fetch_jira_work_item` reads the secret itself, so the plugin backend does
//! the review without ever holding Jira credentials.

use super::*;

const JIRA_API_TOKEN_SECRET: &str = "jira_api_token";

fn missing_credentials_error() -> String {
    "Jira is not configured. Add the site URL, email, and API token in Settings → GitHub Sync → \
     Jira."
        .to_string()
}

/// Read the stored token, treating an absent one as a configuration error
/// rather than an empty credential we would send to Jira anyway.
async fn stored_token() -> Result<String, (StatusCode, String)> {
    crate::secure_store::get_secret_async(JIRA_API_TOKEN_SECRET)
        .await
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?
        .filter(|token| !token.trim().is_empty())
        .ok_or_else(|| (StatusCode::BAD_REQUEST, missing_credentials_error()))
}

pub(super) async fn handle_app_jira_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let _ = state;

    let value = match request.command.as_str() {
        "set_jira_api_token" => {
            let token = payload_string(&request.payload, "token")?;
            crate::secure_store::set_secret_async(JIRA_API_TOKEN_SECRET, &token)
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
            json_value(serde_json::json!({ "configured": true }))?
        }
        "clear_jira_api_token" => {
            crate::secure_store::delete_secret_async(JIRA_API_TOKEN_SECRET)
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
            json_value(serde_json::json!({ "configured": false }))?
        }
        "get_jira_api_token_status" => {
            // Reports presence only. The token itself never crosses this boundary.
            let configured = crate::secure_store::get_secret_async(JIRA_API_TOKEN_SECRET)
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?
                .is_some_and(|token| !token.trim().is_empty());
            json_value(serde_json::json!({ "configured": configured }))?
        }
        "test_jira_connection" => {
            let base_url = payload_string(&request.payload, "baseUrl")?;
            let email = payload_string(&request.payload, "email")?;
            let token = stored_token().await?;

            match crate::jira_runtime::client::fetch_current_user(&base_url, &email, &token).await {
                Ok(display_name) => {
                    json_value(serde_json::json!({ "ok": true, "displayName": display_name }))?
                }
                // A failed connection test is a normal outcome of the form, not a
                // server fault, so it comes back as data the settings UI renders.
                Err(error) => json_value(serde_json::json!({ "ok": false, "error": error }))?,
            }
        }
        "fetch_jira_work_item" => {
            let base_url = payload_string(&request.payload, "baseUrl")?;
            let email = payload_string(&request.payload, "email")?;
            let issue_key = payload_string(&request.payload, "issueKey")?;
            // Optional: the acceptance-criteria custom field id, which differs
            // per Jira instance. Absent means "read the description only".
            let ac_field_id = payload_optional_string(&request.payload, "acFieldId")?;
            let token = stored_token().await?;

            let item = crate::jira_runtime::client::fetch_work_item(
                &base_url,
                &email,
                &token,
                &issue_key,
                ac_field_id.as_deref(),
            )
            .await
            .map_err(|error| (StatusCode::BAD_GATEWAY, error))?;

            json_value(serde_json::to_value(item).map_err(|error| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("could not serialize the Jira work item: {error}"),
                )
            })?)?
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_credentials_error_points_at_the_plugin_settings() {
        let message = missing_credentials_error();
        assert!(message.contains("Jira"), "{message}");
        assert!(message.contains("GitHub Sync"), "{message}");
    }

    #[test]
    fn the_token_secret_is_a_registered_keychain_account() {
        // secure_store refuses unregistered accounts, so a typo here would only
        // surface at runtime when a user tries to save their token.
        assert!(crate::secure_store::is_secret(JIRA_API_TOKEN_SECRET));
    }
}
