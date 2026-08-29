use crate::db;
use std::sync::{Arc, Mutex};

use super::current_unix_timestamp;

#[derive(Debug, Clone, PartialEq, Eq)]
struct GitHubPrLink {
    owner: String,
    repo: String,
    number: i64,
    normalized_url: String,
}

fn parse_github_pr_url(pr_url: &str) -> Result<GitHubPrLink, String> {
    let trimmed = pr_url.trim();
    let without_scheme = trimmed
        .strip_prefix("https://")
        .or_else(|| trimmed.strip_prefix("http://"))
        .ok_or_else(|| "Invalid pull request URL: expected a GitHub PR URL".to_string())?;
    let without_host = without_scheme
        .strip_prefix("github.com/")
        .ok_or_else(|| "Invalid pull request URL: expected github.com".to_string())?;
    let path = without_host
        .split(['?', '#'])
        .next()
        .unwrap_or("")
        .trim_matches('/');
    let segments: Vec<&str> = path
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect();

    if segments.len() < 4 || segments[2] != "pull" {
        return Err("Invalid pull request URL: expected /owner/repo/pull/number".to_string());
    }

    let owner = segments[0].to_string();
    let repo = segments[1].to_string();
    let number = segments[3]
        .parse::<i64>()
        .map_err(|_| "Invalid pull request URL: pull request number must be numeric".to_string())?;

    if owner.is_empty() || repo.is_empty() || number <= 0 {
        return Err(
            "Invalid pull request URL: expected a positive pull request number".to_string(),
        );
    }

    Ok(GitHubPrLink {
        normalized_url: format!("https://github.com/{owner}/{repo}/pull/{number}"),
        owner,
        repo,
        number,
    })
}

fn synthetic_pr_id(link: &GitHubPrLink) -> i64 {
    const FNV_OFFSET: u64 = 0xcbf29ce484222325;
    const FNV_PRIME: u64 = 0x100000001b3;
    let key = format!("{}/{}/{}", link.owner, link.repo, link.number);
    let hash = key.as_bytes().iter().fold(FNV_OFFSET, |acc, byte| {
        (acc ^ u64::from(*byte)).wrapping_mul(FNV_PRIME)
    });
    let positive = (hash & 0x3fff_ffff_ffff_ffff).max(1);
    -(positive as i64)
}

pub fn link_pull_request(
    db: &Arc<Mutex<db::Database>>,
    task_id: &str,
    pr_url: &str,
) -> Result<db::PrRow, String> {
    let link = parse_github_pr_url(pr_url)?;
    let now = current_unix_timestamp()?;

    let db_lock = crate::db::acquire_db(db);
    if db_lock
        .get_task(task_id)
        .map_err(|e| format!("Failed to find task: {e}"))?
        .is_none()
    {
        return Err(format!("Task not found: {task_id}"));
    }

    let existing_pr = db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read existing pull requests: {e}"))?
        .into_iter()
        .find(|pr| {
            pr.repo_owner == link.owner && pr.repo_name == link.repo && pr.pr_number == link.number
        });

    let row_id = existing_pr
        .as_ref()
        .map(|pr| pr.id)
        .unwrap_or_else(|| synthetic_pr_id(&link));
    let title = existing_pr
        .as_ref()
        .map(|pr| pr.title.clone())
        .unwrap_or_else(|| format!("{}/{}#{}", link.owner, link.repo, link.number));
    let url = existing_pr
        .as_ref()
        .map(|pr| pr.url.clone())
        .unwrap_or_else(|| link.normalized_url.clone());
    let state = existing_pr
        .as_ref()
        .map(|pr| pr.state.clone())
        .unwrap_or_else(|| "open".to_string());
    let created_at = existing_pr.as_ref().map(|pr| pr.created_at).unwrap_or(now);
    let draft = existing_pr.as_ref().map(|pr| pr.draft).unwrap_or(false);

    db_lock
        .insert_pull_request_with_number(
            row_id,
            link.number,
            task_id,
            &link.owner,
            &link.repo,
            &title,
            &url,
            &state,
            created_at,
            now,
            draft,
        )
        .map_err(|e| format!("Failed to link pull request: {e}"))?;

    db_lock
        .get_all_pull_requests()
        .map_err(|e| format!("Failed to read linked pull request: {e}"))?
        .into_iter()
        .find(|pr| pr.id == row_id)
        .ok_or_else(|| "Failed to read linked pull request after insert".to_string())
}

#[cfg(test)]
mod tests {
    use crate::db::test_helpers::make_test_db;

    #[test]
    fn parses_github_pull_request_url() {
        let parsed = super::parse_github_pr_url(
            " https://github.com/openforge/app/pull/1431?notification_referrer_id=1 ",
        )
        .expect("valid GitHub PR URL should parse");

        assert_eq!(parsed.owner, "openforge");
        assert_eq!(parsed.repo, "app");
        assert_eq!(parsed.number, 1431);
        assert_eq!(
            parsed.normalized_url,
            "https://github.com/openforge/app/pull/1431"
        );
    }

    #[test]
    fn link_pull_request_persists_synthetic_pr_for_task() {
        let (db, _temp_dir) = make_test_db("link_pull_request_persists");
        let task = db
            .create_task("Link a PR", "doing", None, None, None)
            .expect("create task");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr = super::link_pull_request(&db, &task.id, "https://github.com/owner/repo/pull/77")
            .expect("link PR");

        assert_eq!(pr.ticket_id, task.id);
        assert_eq!(pr.repo_owner, "owner");
        assert_eq!(pr.repo_name, "repo");
        assert_eq!(pr.pr_number, 77);
        assert!(pr.id < 0, "manual links use a synthetic negative row id");
        assert_eq!(pr.title, "owner/repo#77");
        assert_eq!(pr.state, "open");
    }

    #[test]
    fn link_pull_request_reuses_existing_pr_row_for_same_repository_number() {
        let (db, _temp_dir) = make_test_db("link_pull_request_reuses_existing");
        let old_task = db
            .create_task("Old link", "doing", None, None, None)
            .expect("create old task");
        let new_task = db
            .create_task("New link", "doing", None, None, None)
            .expect("create new task");
        db.insert_pull_request_with_number(
            123456,
            77,
            &old_task.id,
            "owner",
            "repo",
            "Fetched GitHub title",
            "https://github.com/owner/repo/pull/77",
            "open",
            1000,
            2000,
            false,
        )
        .expect("insert existing PR");
        let db = std::sync::Arc::new(std::sync::Mutex::new(db));

        let pr =
            super::link_pull_request(&db, &new_task.id, "https://github.com/owner/repo/pull/77")
                .expect("link PR");

        assert_eq!(pr.id, 123456);
        assert_eq!(pr.ticket_id, new_task.id);
        assert_eq!(pr.title, "Fetched GitHub title");
    }
}
