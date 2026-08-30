#[cfg(test)]
use super::prompt::MetadataJobSnapshot;
use super::prompt::{
    build_task_display_title_metadata_job, build_task_display_title_prompt,
    task_display_title_candidate, MetadataJob,
};
use super::providers::run_task_display_title_metadata_job;
use crate::db;
use log::{debug, info, warn};
use std::collections::HashMap;
use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock, Mutex, Weak};
use std::time::Duration;

const TITLE_REFRESH_DELAY_SECONDS: u64 = 8;

#[derive(Debug, Clone)]
struct PendingTaskDisplayTitleRefresh {
    generation: u64,
    provider: String,
    transcript_path: Option<PathBuf>,
    activity_snapshot: Option<String>,
}

#[derive(Debug, Clone)]
pub(crate) struct QueuedTaskDisplayTitleRefresh {
    task_id: String,
    generation: u64,
}

static PENDING_TASK_DISPLAY_TITLE_REFRESHES: LazyLock<
    Mutex<HashMap<String, PendingTaskDisplayTitleRefresh>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));

static TASK_DISPLAY_TITLE_REFRESH_LOCKS: LazyLock<
    Mutex<HashMap<String, Weak<tokio::sync::Mutex<()>>>>,
> = LazyLock::new(|| Mutex::new(HashMap::new()));
fn lock_pending_task_display_title_refreshes(
) -> std::sync::MutexGuard<'static, HashMap<String, PendingTaskDisplayTitleRefresh>> {
    PENDING_TASK_DISPLAY_TITLE_REFRESHES
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn task_display_title_refresh_lock(task_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let mut locks = TASK_DISPLAY_TITLE_REFRESH_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    locks.retain(|_, lock| lock.strong_count() > 0);
    if let Some(lock) = locks.get(task_id).and_then(Weak::upgrade) {
        return lock;
    }
    let lock = Arc::new(tokio::sync::Mutex::new(()));
    locks.insert(task_id.to_string(), Arc::downgrade(&lock));
    lock
}

#[cfg(test)]
pub(crate) fn poison_pending_task_display_title_refreshes_for_test() {
    let poison_result = std::thread::spawn(|| {
        let _pending = lock_pending_task_display_title_refreshes();
        panic!("poison pending task display title refreshes lock");
    })
    .join();

    assert!(poison_result.is_err());
}
pub(crate) fn queue_task_display_title_refresh(
    task_id: String,
    provider: String,
    transcript_path: Option<PathBuf>,
    activity_snapshot: Option<String>,
) -> QueuedTaskDisplayTitleRefresh {
    let transcript_path_present = transcript_path.is_some();
    let activity_snapshot_bytes = activity_snapshot.as_ref().map_or(0, String::len);
    let mut pending = lock_pending_task_display_title_refreshes();
    let generation = pending
        .get(&task_id)
        .map_or(1, |refresh| refresh.generation.saturating_add(1));
    pending.insert(
        task_id.clone(),
        PendingTaskDisplayTitleRefresh {
            generation,
            provider,
            transcript_path,
            activity_snapshot,
        },
    );
    info!(
        "[task_metadata_refresh] scheduling AI title refresh task_id={} generation={} delay_seconds={} has_transcript_path={} activity_snapshot_bytes={}",
        task_id,
        generation,
        TITLE_REFRESH_DELAY_SECONDS,
        transcript_path_present,
        activity_snapshot_bytes
    );
    QueuedTaskDisplayTitleRefresh {
        task_id,
        generation,
    }
}

fn latest_task_display_title_refresh(
    task_id: &str,
    generation: u64,
) -> Option<PendingTaskDisplayTitleRefresh> {
    let pending = lock_pending_task_display_title_refreshes();
    match pending.get(task_id) {
        Some(refresh) if refresh.generation == generation => Some(refresh.clone()),
        _ => None,
    }
}

fn finish_task_display_title_refresh_if_latest(task_id: &str, generation: u64) -> bool {
    let mut pending = lock_pending_task_display_title_refreshes();
    match pending.get(task_id) {
        Some(refresh) if refresh.generation == generation => {
            pending.remove(task_id);
            true
        }
        _ => false,
    }
}

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

pub(crate) async fn refresh_queued_task_display_title_with_ai_once(
    db: Arc<Mutex<db::Database>>,
    queued: QueuedTaskDisplayTitleRefresh,
) -> Result<bool, String> {
    refresh_queued_task_display_title_with_ai_once_after(
        db,
        queued,
        Duration::from_secs(TITLE_REFRESH_DELAY_SECONDS),
        |job, prompt| async move { run_task_display_title_metadata_job(&job, &prompt).await },
    )
    .await
}

pub(super) async fn refresh_queued_task_display_title_with_ai_once_after<F, Fut>(
    db: Arc<Mutex<db::Database>>,
    queued: QueuedTaskDisplayTitleRefresh,
    delay: Duration,
    title_provider: F,
) -> Result<bool, String>
where
    F: FnOnce(MetadataJob, String) -> Fut,
    Fut: Future<Output = Result<Option<String>, String>>,
{
    tokio::time::sleep(delay).await;
    let refresh_lock = task_display_title_refresh_lock(&queued.task_id);
    let _refresh_permit = refresh_lock.lock().await;

    let Some(refresh) = latest_task_display_title_refresh(&queued.task_id, queued.generation)
    else {
        info!(
            "[task_metadata_refresh] skipping superseded AI title refresh task_id={} generation={}",
            queued.task_id, queued.generation
        );
        return Ok(false);
    };
    let provider = refresh.provider;
    let transcript_path = refresh.transcript_path;
    let activity_snapshot = refresh.activity_snapshot;

    let task = {
        let guard = db::acquire_db(&db);
        guard
            .get_task(&queued.task_id)
            .map_err(|error| format!("failed to load task for AI title refresh: {error}"))?
    };
    let job = build_task_display_title_metadata_job(
        &queued.task_id,
        &provider,
        transcript_path,
        activity_snapshot,
    );
    let snapshot = job.snapshot.as_ref();
    info!(
        "[task_metadata_refresh] built AI title refresh snapshot task_id={} provider={} generation={} has_snapshot={} transcript_excerpt_bytes={} activity_excerpt_bytes={}",
        queued.task_id,
        provider,
        queued.generation,
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
            queued.task_id, provider
        );
        finish_task_display_title_refresh_if_latest(&queued.task_id, queued.generation);
        return Ok(false);
    };
    if task.title_source.as_deref() == Some("manual") || task.title_generated_at.is_some() {
        info!(
            "[task_metadata_refresh] skipping AI title refresh because task is no longer eligible task_id={} provider={} title_source={:?} title_generated={}",
            queued.task_id,
            provider,
            task.title_source,
            task.title_generated_at.is_some()
        );
        finish_task_display_title_refresh_if_latest(&queued.task_id, queued.generation);
        return Ok(false);
    }

    let prompt = build_task_display_title_prompt(&task, snapshot);
    debug!(
        "[task_metadata_refresh] built AI title prompt task_id={} provider={} prompt_bytes={}",
        queued.task_id,
        provider,
        prompt.len()
    );
    let (candidate, candidate_source) = match title_provider(job, prompt).await {
        Ok(Some(title)) => (Some(title), "provider"),
        Ok(None) => {
            info!(
                "[task_metadata_refresh] AI title provider returned no title; using prompt fallback if available task_id={} provider={}",
                queued.task_id, provider
            );
            (task_display_title_candidate(&task), "fallback")
        }
        Err(_) => {
            warn!(
                "[task_metadata_refresh] AI title provider failed; using prompt fallback if available task_id={} provider={}; suppressing provider error detail to avoid leaking provider content",
                queued.task_id, provider
            );
            (task_display_title_candidate(&task), "fallback")
        }
    };
    let Some(candidate) = candidate else {
        info!(
            "[task_metadata_refresh] no AI title candidate available task_id={} provider={}",
            queued.task_id, provider
        );
        finish_task_display_title_refresh_if_latest(&queued.task_id, queued.generation);
        return Ok(false);
    };
    if !finish_task_display_title_refresh_if_latest(&queued.task_id, queued.generation) {
        info!(
            "[task_metadata_refresh] skipping superseded AI title candidate task_id={} provider={} generation={} source={}",
            queued.task_id, provider, queued.generation, candidate_source
        );
        return Ok(false);
    }
    info!(
        "[task_metadata_refresh] selected AI title candidate task_id={} provider={} source={} title_chars={}",
        queued.task_id,
        provider,
        candidate_source,
        candidate.chars().count()
    );

    let guard = db::acquire_db(&db);
    let result = guard.update_generated_task_title_once(&queued.task_id, &candidate);
    match &result {
        Ok(updated) => info!(
            "[task_metadata_refresh] AI title refresh write completed task_id={} provider={} source={} updated={}",
            queued.task_id, provider, candidate_source, updated
        ),
        Err(error) => warn!(
            "[task_metadata_refresh] failed to write AI generated task display title task_id={} provider={} source={}: {error}",
            queued.task_id, provider, candidate_source
        ),
    }
    result.map_err(|error| format!("failed to write AI generated task display title: {error}"))
}
