use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use serde_json::Value;

const GITHUB_SYNC_PLUGIN_ID: &str = "com.openforge.github-sync";

fn openforge_global_command_to_app_invoke(qualified_id: &str) -> Result<&'static str, String> {
    let command = qualified_id
        .strip_prefix("openforge.")
        .ok_or_else(|| format!("unsupported plugin host global command id: {qualified_id}"))?;

    match command {
        "forceGithubSync" => Ok("force_github_sync"),
        "getPullRequests" => Ok("get_pull_requests"),
        "refreshTaskGithubStatus" => Ok("refresh_task_github_status"),
        "linkPullRequest" => Ok("link_pull_request"),
        "getPrComments" => Ok("get_pr_comments"),
        "markCommentAddressed" => Ok("mark_comment_addressed"),
        "mergeTaskPullRequest" => Ok("merge_task_pull_request"),
        "enqueueTaskPullRequest" => Ok("enqueue_task_pull_request"),
        "fetchReviewPrs" => Ok("fetch_review_prs"),
        "getReviewPrs" => Ok("get_review_prs"),
        "fetchAuthoredPrs" => Ok("fetch_authored_prs"),
        "getAuthoredPrs" => Ok("get_authored_prs"),
        "markReviewPrViewed" => Ok("mark_review_pr_viewed"),
        "markReviewPrUnviewed" => Ok("mark_review_pr_unviewed"),
        "getPrFileDiffs" => Ok("get_pr_file_diffs"),
        "getFileContent" => Ok("get_file_content"),
        "getFileContentBase64" => Ok("get_file_content_base64"),
        "getFileAtRef" => Ok("get_file_at_ref"),
        "getFileAtRefBase64" => Ok("get_file_at_ref_base64"),
        "getReviewComments" => Ok("get_review_comments"),
        "getPrOverviewComments" => Ok("get_pr_overview_comments"),
        "submitPrReview" => Ok("submit_pr_review"),
        "replyToReviewComment" => Ok("create_review_comment_reply"),
        "createReviewComment" => Ok("create_review_comment"),
        "getAgentReviewComments" => Ok("get_agent_review_comments"),
        "updateAgentReviewCommentStatus" => Ok("update_agent_review_comment_status"),
        "agentGenerate" => Ok("agent_generate"),
        "abortAgentGenerate" => Ok("abort_agent_generate"),
        "agentGenerateInRepo" => Ok("agent_generate_in_repo"),
        _ => Err(format!(
            "unsupported plugin host global command id: {qualified_id}"
        )),
    }
}

fn is_files_review_app_command(command: &str) -> bool {
    matches!(
        command,
        "get_agent_review_comments" | "update_agent_review_comment_status"
    )
}

fn is_agent_generate_app_command(command: &str) -> bool {
    matches!(
        command,
        "agent_generate" | "abort_agent_generate" | "agent_generate_in_repo"
    )
}

/// Whether `plugin_id` may invoke the given resolved app command.
///
/// Only built-in plugins reach app commands, and each owns its own namespace.
/// Everything else — including every externally installed plugin — is denied.
fn plugin_may_invoke_command(plugin_id: &str, command: &str) -> bool {
    let _ = command;
    matches!(plugin_id, GITHUB_SYNC_PLUGIN_ID)
}

impl PluginHost {
    pub(super) async fn list_command_catalog_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let Some(project_id) = optional_param_string(params, "projectId")? else {
            return Ok(Value::Array(Vec::new()));
        };
        let state = self.app_state_for_host_callback()?;
        let request = crate::http_server::AppInvokeRequest {
            command: "list_opencode_commands".to_string(),
            payload: serde_json::json!({ "projectId": project_id }),
        };
        crate::app_invoke::handle_runtime_command(&state, &request)
            .await
            .map_err(|(status, message)| {
                format!("plugin host command catalog callback failed ({status}): {message}")
            })?
            .ok_or_else(|| "plugin host command catalog callback returned no value".to_string())
    }

    pub(super) async fn invoke_global_command_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let qualified_id = required_param_string(params, "qualifiedId")?;
        let caller_plugin_id = required_param_string(params, "callerPluginId")?;
        let command = openforge_global_command_to_app_invoke(&qualified_id)?;
        if !plugin_may_invoke_command(&caller_plugin_id, command) {
            return Err(format!(
                "plugin {caller_plugin_id} is not authorized to invoke private host command {qualified_id}"
            ));
        }
        let payload = params.get("payload").cloned().unwrap_or(Value::Null);
        let request = crate::http_server::AppInvokeRequest {
            command: command.to_string(),
            payload,
        };
        let state = self.app_state_for_host_callback()?;
        let result = if is_agent_generate_app_command(command) {
            crate::app_invoke::handle_agent_generate_command(&state, &request).await
        } else if is_files_review_app_command(command) {
            crate::app_invoke::handle_files_review_command(&state, &request).await
        } else {
            crate::app_invoke::handle_github_review_command(&state, &request).await
        };

        result
            .map_err(|(status, message)| {
                format!("plugin host command callback {command} failed ({status}): {message}")
            })?
            .ok_or_else(|| format!("plugin host command callback returned no value: {command}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_generate_in_repo_maps_and_is_authorized() {
        assert_eq!(
            openforge_global_command_to_app_invoke("openforge.agentGenerateInRepo").unwrap(),
            "agent_generate_in_repo"
        );
        assert!(is_agent_generate_app_command("agent_generate_in_repo"));
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "agent_generate_in_repo"
        ));
    }

    #[test]
    fn reply_to_review_comment_maps_and_is_authorized() {
        assert_eq!(
            openforge_global_command_to_app_invoke("openforge.replyToReviewComment").unwrap(),
            "create_review_comment_reply"
        );
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "create_review_comment_reply"
        ));
    }

    #[test]
    fn create_review_comment_maps_and_is_authorized() {
        assert_eq!(
            openforge_global_command_to_app_invoke("openforge.createReviewComment").unwrap(),
            "create_review_comment"
        );
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "create_review_comment"
        ));
    }

    #[test]
    fn authorization_gate_admits_only_built_in_plugins() {
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "fetch_review_prs"
        ));
        assert!(plugin_may_invoke_command(
            GITHUB_SYNC_PLUGIN_ID,
            "get_agent_review_comments"
        ));
        assert!(!plugin_may_invoke_command(
            "com.openforge.issues",
            "fetch_review_prs"
        ));
        assert!(!plugin_may_invoke_command(
            "com.example.evil",
            "fetch_review_prs"
        ));
    }
}
