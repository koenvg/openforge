use super::callbacks::{optional_param_string, required_param_string};
use super::PluginHost;
use serde_json::Value;

const GITHUB_SYNC_PLUGIN_ID: &str = "com.openforge.github-sync";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum GlobalCommandHandler {
    GithubReview,
    FilesReview,
    AgentGenerate,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ResolvedGlobalCommand {
    app_command: &'static str,
    handler: GlobalCommandHandler,
}

impl ResolvedGlobalCommand {
    const fn github_review(app_command: &'static str) -> Self {
        Self {
            app_command,
            handler: GlobalCommandHandler::GithubReview,
        }
    }

    const fn files_review(app_command: &'static str) -> Self {
        Self {
            app_command,
            handler: GlobalCommandHandler::FilesReview,
        }
    }

    const fn agent_generate(app_command: &'static str) -> Self {
        Self {
            app_command,
            handler: GlobalCommandHandler::AgentGenerate,
        }
    }
}

fn resolve_openforge_global_command(qualified_id: &str) -> Result<ResolvedGlobalCommand, String> {
    let command = qualified_id
        .strip_prefix("openforge.")
        .ok_or_else(|| format!("unsupported plugin host global command id: {qualified_id}"))?;

    match command {
        "forceGithubSync" => Ok(ResolvedGlobalCommand::github_review("force_github_sync")),
        "getPullRequests" => Ok(ResolvedGlobalCommand::github_review("get_pull_requests")),
        "refreshTaskGithubStatus" => Ok(ResolvedGlobalCommand::github_review(
            "refresh_task_github_status",
        )),
        "linkPullRequest" => Ok(ResolvedGlobalCommand::github_review("link_pull_request")),
        "getPrComments" => Ok(ResolvedGlobalCommand::github_review("get_pr_comments")),
        "markCommentAddressed" => Ok(ResolvedGlobalCommand::github_review(
            "mark_comment_addressed",
        )),
        "mergeTaskPullRequest" => Ok(ResolvedGlobalCommand::github_review(
            "merge_task_pull_request",
        )),
        "enqueueTaskPullRequest" => Ok(ResolvedGlobalCommand::github_review(
            "enqueue_task_pull_request",
        )),
        "fetchReviewPrs" => Ok(ResolvedGlobalCommand::github_review("fetch_review_prs")),
        "getReviewPrs" => Ok(ResolvedGlobalCommand::github_review("get_review_prs")),
        "fetchAuthoredPrs" => Ok(ResolvedGlobalCommand::github_review("fetch_authored_prs")),
        "getAuthoredPrs" => Ok(ResolvedGlobalCommand::github_review("get_authored_prs")),
        "markReviewPrViewed" => Ok(ResolvedGlobalCommand::github_review(
            "mark_review_pr_viewed",
        )),
        "markReviewPrUnviewed" => Ok(ResolvedGlobalCommand::github_review(
            "mark_review_pr_unviewed",
        )),
        "getPrFileDiffs" => Ok(ResolvedGlobalCommand::github_review("get_pr_file_diffs")),
        "getFileContent" => Ok(ResolvedGlobalCommand::github_review("get_file_content")),
        "getFileContentBase64" => Ok(ResolvedGlobalCommand::github_review(
            "get_file_content_base64",
        )),
        "getFileAtRef" => Ok(ResolvedGlobalCommand::github_review("get_file_at_ref")),
        "getFileAtRefBase64" => Ok(ResolvedGlobalCommand::github_review(
            "get_file_at_ref_base64",
        )),
        "getReviewComments" => Ok(ResolvedGlobalCommand::github_review("get_review_comments")),
        "getPrOverviewComments" => Ok(ResolvedGlobalCommand::github_review(
            "get_pr_overview_comments",
        )),
        "submitPrReview" => Ok(ResolvedGlobalCommand::github_review("submit_pr_review")),
        "replyToReviewComment" => Ok(ResolvedGlobalCommand::github_review(
            "create_review_comment_reply",
        )),
        "createReviewComment" => Ok(ResolvedGlobalCommand::github_review(
            "create_review_comment",
        )),
        "getAgentReviewComments" => Ok(ResolvedGlobalCommand::files_review(
            "get_agent_review_comments",
        )),
        "updateAgentReviewCommentStatus" => Ok(ResolvedGlobalCommand::files_review(
            "update_agent_review_comment_status",
        )),
        "agentGenerate" => Ok(ResolvedGlobalCommand::agent_generate("agent_generate")),
        "abortAgentGenerate" => Ok(ResolvedGlobalCommand::agent_generate(
            "abort_agent_generate",
        )),
        "agentGenerateInRepo" => Ok(ResolvedGlobalCommand::agent_generate(
            "agent_generate_in_repo",
        )),
        _ => Err(format!(
            "unsupported plugin host global command id: {qualified_id}"
        )),
    }
}

/// Whether `plugin_id` may invoke private global commands exposed by this host callback.
///
/// Command selection is allowlisted by `resolve_openforge_global_command`; authorization is
/// intentionally plugin-scoped. The built-in GitHub Sync plugin is trusted for every resolved
/// command, while all other plugins, including externally installed plugins, are denied.
fn plugin_may_invoke_private_host_commands(plugin_id: &str) -> bool {
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
        let resolved = resolve_openforge_global_command(&qualified_id)?;
        let app_command = resolved.app_command;
        if !plugin_may_invoke_private_host_commands(&caller_plugin_id) {
            return Err(format!(
                "plugin {caller_plugin_id} is not authorized to invoke private host command {qualified_id}"
            ));
        }
        let payload = params.get("payload").cloned().unwrap_or(Value::Null);
        let request = crate::http_server::AppInvokeRequest {
            command: app_command.to_string(),
            payload,
        };
        let state = self.app_state_for_host_callback()?;
        let result = match resolved.handler {
            GlobalCommandHandler::GithubReview => {
                crate::app_invoke::handle_github_review_command(&state, &request).await
            }
            GlobalCommandHandler::FilesReview => {
                crate::app_invoke::handle_files_review_command(&state, &request).await
            }
            GlobalCommandHandler::AgentGenerate => {
                crate::app_invoke::handle_agent_generate_command(&state, &request).await
            }
        };

        result
            .map_err(|(status, message)| {
                format!("plugin host command callback {app_command} failed ({status}): {message}")
            })?
            .ok_or_else(|| format!("plugin host command callback returned no value: {app_command}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn global_command_resolution_includes_handler_route() {
        let cases = [
            (
                "openforge.fetchReviewPrs",
                "fetch_review_prs",
                GlobalCommandHandler::GithubReview,
            ),
            (
                "openforge.getAgentReviewComments",
                "get_agent_review_comments",
                GlobalCommandHandler::FilesReview,
            ),
            (
                "openforge.agentGenerateInRepo",
                "agent_generate_in_repo",
                GlobalCommandHandler::AgentGenerate,
            ),
        ];

        for (qualified_id, expected_app_command, expected_handler) in cases {
            let resolved = resolve_openforge_global_command(qualified_id)
                .unwrap_or_else(|error| panic!("{qualified_id} should resolve: {error}"));
            assert_eq!(resolved.app_command, expected_app_command);
            assert_eq!(resolved.handler, expected_handler);
        }
    }

    #[test]
    fn agent_generate_in_repo_maps_to_agent_handler() {
        let resolved = resolve_openforge_global_command("openforge.agentGenerateInRepo").unwrap();
        assert_eq!(resolved.app_command, "agent_generate_in_repo");
        assert_eq!(resolved.handler, GlobalCommandHandler::AgentGenerate);
    }

    #[test]
    fn reply_to_review_comment_maps_to_github_handler() {
        let resolved = resolve_openforge_global_command("openforge.replyToReviewComment").unwrap();
        assert_eq!(resolved.app_command, "create_review_comment_reply");
        assert_eq!(resolved.handler, GlobalCommandHandler::GithubReview);
    }

    #[test]
    fn create_review_comment_maps_to_github_handler() {
        let resolved = resolve_openforge_global_command("openforge.createReviewComment").unwrap();
        assert_eq!(resolved.app_command, "create_review_comment");
        assert_eq!(resolved.handler, GlobalCommandHandler::GithubReview);
    }

    #[test]
    fn built_in_github_sync_plugin_may_invoke_private_host_commands() {
        assert!(plugin_may_invoke_private_host_commands(
            GITHUB_SYNC_PLUGIN_ID
        ));
    }

    #[test]
    fn third_party_plugins_may_not_invoke_private_host_commands() {
        for plugin_id in ["com.openforge.issues", "com.example.evil"] {
            assert!(
                !plugin_may_invoke_private_host_commands(plugin_id),
                "{plugin_id}"
            );
        }
    }
}
