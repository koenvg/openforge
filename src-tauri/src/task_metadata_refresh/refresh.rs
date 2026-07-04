#[cfg(test)]
use super::prompt::MetadataJobSnapshot;
use super::prompt::{
    build_task_display_title_metadata_job, build_task_display_title_prompt,
    task_display_title_candidate,
};
use super::providers::run_task_display_title_metadata_job;
use crate::db;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

const TITLE_REFRESH_DELAY_SECONDS: u64 = 8;

#[cfg(test)]
pub(crate) fn refresh_task_display_title_once(
    db: &db::Database,
    task_id: &str,
) -> Result<bool, String> {
    refresh_task_display_title_once_with_provider(db, task_id, None, |_| Ok(None))
}

#[cfg(test)]
pub(crate) fn refresh_task_display_title_once_with_provider<F>(
    db: &db::Database,
    task_id: &str,
    snapshot: Option<&MetadataJobSnapshot>,
    title_provider: F,
) -> Result<bool, String>
where
    F: FnOnce(&str) -> Result<Option<String>, String>,
{
    let Some(task) = db
        .get_task(task_id)
        .map_err(|error| format!("failed to load task for title refresh: {error}"))?
    else {
        return Ok(false);
    };

    if task.title_source.as_deref() == Some("manual") || task.title_generated_at.is_some() {
        return Ok(false);
    }

    let prompt = build_task_display_title_prompt(&task, snapshot);
    let candidate = title_provider(&prompt)
        .ok()
        .flatten()
        .or_else(|| task_display_title_candidate(&task));
    let Some(candidate) = candidate else {
        return Ok(false);
    };

    db.update_generated_task_title_once(task_id, &candidate)
        .map_err(|error| format!("failed to write generated task display title: {error}"))
}

pub(crate) async fn refresh_task_display_title_with_ai_once(
    db: Arc<Mutex<db::Database>>,
    task_id: String,
    provider: String,
    transcript_path: Option<PathBuf>,
    activity_snapshot: Option<String>,
) -> Result<bool, String> {
    let transcript_path_present = transcript_path.is_some();
    let activity_snapshot_bytes = activity_snapshot.as_ref().map_or(0, String::len);
    info!(
        "[task_metadata_refresh] scheduling AI title refresh task_id={} provider={} delay_seconds={} has_transcript_path={} activity_snapshot_bytes={}",
        task_id,
        provider,
        TITLE_REFRESH_DELAY_SECONDS,
        transcript_path_present,
        activity_snapshot_bytes
    );
    tokio::time::sleep(Duration::from_secs(TITLE_REFRESH_DELAY_SECONDS)).await;

    let task = {
        let guard = db.lock().unwrap();
        guard
            .get_task(&task_id)
            .map_err(|error| format!("failed to load task for AI title refresh: {error}"))?
    };
    let job = build_task_display_title_metadata_job(
        &task_id,
        &provider,
        transcript_path,
        activity_snapshot,
    );
    let snapshot = job.snapshot.as_ref();
    info!(
        "[task_metadata_refresh] built AI title refresh snapshot task_id={} provider={} has_snapshot={} transcript_excerpt_bytes={} activity_excerpt_bytes={}",
        task_id,
        provider,
        snapshot.is_some(),
        snapshot
            .and_then(|snapshot| snapshot.transcript_excerpt.as_ref())
            .map_or(0, String::len),
        snapshot
            .and_then(|snapshot| snapshot.activity_excerpt.as_ref())
            .map_or(0, String::len)
    );
    let Some(task) = task else {
        info!(
            "[task_metadata_refresh] skipping AI title refresh because task no longer exists task_id={} provider={}",
            task_id, provider
        );
        return Ok(false);
    };
    if task.title_source.as_deref() == Some("manual") || task.title_generated_at.is_some() {
        info!(
            "[task_metadata_refresh] skipping AI title refresh because task is no longer eligible task_id={} provider={} title_source={:?} title_generated={}",
            task_id,
            provider,
            task.title_source,
            task.title_generated_at.is_some()
        );
        return Ok(false);
    }

    let prompt = build_task_display_title_prompt(&task, snapshot);
    debug!(
        "[task_metadata_refresh] built AI title prompt task_id={} provider={} prompt_bytes={}",
        task_id,
        provider,
        prompt.len()
    );
    let (candidate, candidate_source) = match run_task_display_title_metadata_job(&job, &prompt)
        .await
    {
        Ok(Some(title)) => (Some(title), "provider"),
        Ok(None) => {
            info!(
                "[task_metadata_refresh] AI title provider returned no title; using prompt fallback if available task_id={} provider={}",
                task_id, provider
            );
            (task_display_title_candidate(&task), "fallback")
        }
        Err(_) => {
            warn!(
                "[task_metadata_refresh] AI title provider failed; using prompt fallback if available task_id={} provider={}; suppressing provider error detail to avoid leaking provider content",
                task_id, provider
            );
            (task_display_title_candidate(&task), "fallback")
        }
    };
    let Some(candidate) = candidate else {
        info!(
            "[task_metadata_refresh] no AI title candidate available task_id={} provider={}",
            task_id, provider
        );
        return Ok(false);
    };
    info!(
        "[task_metadata_refresh] selected AI title candidate task_id={} provider={} source={} title_chars={}",
        task_id,
        provider,
        candidate_source,
        candidate.chars().count()
    );

    let guard = db.lock().unwrap();
    let result = guard.update_generated_task_title_once(&task_id, &candidate);
    match &result {
        Ok(updated) => info!(
            "[task_metadata_refresh] AI title refresh write completed task_id={} provider={} source={} updated={}",
            task_id, provider, candidate_source, updated
        ),
        Err(error) => warn!(
            "[task_metadata_refresh] failed to write AI generated task display title task_id={} provider={} source={}: {error}",
            task_id, provider, candidate_source
        ),
    }
    result.map_err(|error| format!("failed to write AI generated task display title: {error}"))
}
