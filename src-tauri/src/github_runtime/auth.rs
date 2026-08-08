use crate::{db, github_client::GitHubClient};
use std::sync::{Arc, Mutex};

pub async fn github_token() -> Result<String, String> {
    crate::secure_store::get_secret_async("github_token")
        .await
        .map_err(|e| format!("Failed to get config: {e}"))?
        .ok_or_else(|| "github_token not configured".to_string())
}
pub async fn github_username(
    db: &Arc<Mutex<db::Database>>,
    github_client: &GitHubClient,
) -> Result<String, String> {
    let cached_username = {
        let db_lock = crate::db::acquire_db(db);
        db_lock
            .get_config("github_username")
            .map_err(|e| format!("Failed to get config: {e}"))?
    };

    if let Some(username) = cached_username {
        return Ok(username);
    }

    let token = github_token().await?;
    let username = github_client
        .get_authenticated_user(&token)
        .await
        .map_err(|e| format!("Failed to get authenticated user: {e}"))?;

    let db_lock = crate::db::acquire_db(db);
    db_lock
        .set_config("github_username", &username)
        .map_err(|e| format!("Failed to cache username: {e}"))?;

    Ok(username)
}
