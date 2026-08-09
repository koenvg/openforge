use super::*;

pub(super) fn handle(
    _state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "get_app_mode" => json_value(if cfg!(debug_assertions) {
            "dev"
        } else {
            "prod"
        }),
        "get_git_branch" => {
            let output = std::process::Command::new("git")
                .args(["rev-parse", "--abbrev-ref", "HEAD"])
                .output()
                .map_err(|e| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to run git: {e}"),
                    )
                })?;

            if output.status.success() {
                json_value(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                Err((
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Not a git repository".to_string(),
                ))
            }
        }
        _ => unreachable!("app handler only receives app commands"),
    }
}
