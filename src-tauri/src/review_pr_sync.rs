use crate::db::{acquire_db, Database, ReviewPrRow, ReviewPrUpsert};
use crate::github_client::SearchPrResult;
use std::sync::Mutex;

fn review_pr_upsert(pr: SearchPrResult) -> ReviewPrUpsert {
    let created_at = chrono::DateTime::parse_from_rfc3339(&pr.created_at)
        .map(|timestamp| timestamp.timestamp())
        .unwrap_or(0);
    let updated_at = chrono::DateTime::parse_from_rfc3339(&pr.updated_at)
        .map(|timestamp| timestamp.timestamp())
        .unwrap_or(0);

    ReviewPrUpsert {
        id: pr.id,
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        draft: pr.draft,
        html_url: pr.html_url,
        user_login: pr.user_login,
        user_avatar_url: pr.user_avatar_url,
        repo_owner: pr.repo_owner,
        repo_name: pr.repo_name,
        head_ref: pr.head_ref,
        base_ref: pr.base_ref,
        head_sha: pr.head_sha,
        additions: pr.additions,
        deletions: pr.deletions,
        changed_files: pr.changed_files,
        mergeable: pr.mergeable,
        mergeable_state: pr.mergeable_state,
        labels: pr.labels,
        created_at,
        updated_at,
    }
}

pub(crate) fn enrich_and_persist_review_prs(
    db: &Mutex<Database>,
    prs: Vec<SearchPrResult>,
    all_search_ids: &[i64],
) -> Result<Vec<ReviewPrRow>, String> {
    let search_is_empty = prs.is_empty();
    let rows: Vec<_> = prs.into_iter().map(review_pr_upsert).collect();
    let db = acquire_db(db);

    for row in &rows {
        db.upsert_review_pr(row)
            .map_err(|error| format!("Failed to upsert review PR: {error}"))?;
    }

    if !all_search_ids.is_empty() || search_is_empty {
        db.mark_review_prs_not_requested(all_search_ids)
            .map_err(|error| format!("Failed to update review PR request state: {error}"))?;
    }

    db.get_all_review_prs()
        .map_err(|error| format!("Failed to get review PRs: {error}"))
}
