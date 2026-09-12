//! Deferring a session's completion while its background work runs leaves nothing to report
//! the work finishing: Claude only speaks through hooks when it resumes, and work that never
//! ends (a dev server, a `persistent` Monitor) never resumes it.

use super::AppState;
use crate::claude_background_work::{OutstandingWork, PendingBackgroundTask};
use log::{info, warn};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::{Mutex, OwnedMutexGuard};
use tokio::task::JoinHandle;

pub(crate) const BACKGROUND_WORK_GRACE_CONFIG_KEY: &str = "claude_background_work_grace_seconds";
const DEFAULT_BACKGROUND_WORK_GRACE_SECONDS: u64 = 600;
const MAX_BACKGROUND_WORK_GRACE_SECONDS: u64 = 24 * 60 * 60;

/// A declared `Monitor` timeout is arbitrary transcript data, so it never holds a session open
/// beyond this even when it declares days.
const MAX_DEFERRAL: Duration = Duration::from_secs(MAX_BACKGROUND_WORK_GRACE_SECONDS);

use crate::agent_lifecycle::{CompletionPlan, PendingCompletion as DeferredCompletion};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct Deadlines {
    grace_ms: u64,
    ceiling_ms: u64,
}

#[derive(Debug, PartialEq, Eq)]
enum Next {
    CompleteNow,
    WakeAt(u64),
}

struct ScheduledCompletion {
    generation: u64,
    task: JoinHandle<()>,
}

#[derive(Clone)]
pub(crate) struct DeferredCompletionWatcher {
    scheduled: Arc<Mutex<HashMap<String, ScheduledCompletion>>>,
    task_locks: Arc<Mutex<HashMap<String, Arc<Mutex<()>>>>>,
    next_generation: Arc<AtomicU64>,
}

impl DeferredCompletionWatcher {
    pub(crate) fn new() -> Self {
        Self {
            scheduled: Arc::new(Mutex::new(HashMap::new())),
            task_locks: Arc::new(Mutex::new(HashMap::new())),
            next_generation: Arc::new(AtomicU64::new(1)),
        }
    }

    /// A hook and a firing deferral both decide the same session's status, and the deferral is
    /// only stale once the hook has recorded its own. Callers must hold this across both.
    pub(crate) async fn task_guard(&self, task_id: &str) -> OwnedMutexGuard<()> {
        let task_lock = {
            let mut task_locks = self.task_locks.lock().await;
            Arc::clone(task_locks.entry(task_id.to_string()).or_default())
        };
        task_lock.lock_owned().await
    }

    pub(crate) async fn recover(&self, state: &AppState) -> Result<(), String> {
        let db = state.db.clone();
        let pending = tokio::task::spawn_blocking(move || {
            crate::db::acquire_db(&db).pending_agent_completions()
        })
        .await
        .map_err(|_| "completion recovery worker failed")??;
        for completion in pending {
            let _guard = self.task_guard(&completion.task_id).await;
            self.schedule(state, completion).await;
        }
        Ok(())
    }

    pub(crate) async fn schedule(&self, state: &AppState, deferral: DeferredCompletion) {
        let mut scheduled = self.scheduled.lock().await;
        if let Some(previous) = scheduled.remove(&deferral.task_id) {
            previous.task.abort();
        }
        let deadlines = Deadlines {
            grace_ms: deferral.plan.grace_ms,
            ceiling_ms: deferral.plan.ceiling_ms,
        };
        let wake_at_ms = deferral.plan.wake_at_ms;
        let reported = deferral.plan.reported.clone();
        let generation = self.next_generation.fetch_add(1, Ordering::Relaxed);
        let task_id = deferral.task_id.clone();
        let watcher = self.clone();
        let state = state.clone();
        let task = tokio::spawn(async move {
            watcher
                .watch(state, deferral, generation, deadlines, wake_at_ms, reported)
                .await;
        });
        scheduled.insert(task_id, ScheduledCompletion { generation, task });
    }

    pub(crate) async fn resumed(&self, task_id: &str) {
        if let Some(scheduled) = self.scheduled.lock().await.remove(task_id) {
            scheduled.task.abort();
        }
    }

    /// Claude's own inventory is a complete account of its in-flight work, so a deferral it
    /// sourced is not re-checked: replaying the transcript at the deadline would let work the
    /// inventory omitted extend a deferral it never authorised. Replayed work is re-polled,
    /// because a backgrounded shell may have exited since the turn ended.
    async fn watch(
        &self,
        state: AppState,
        deferral: DeferredCompletion,
        generation: u64,
        deadlines: Deadlines,
        mut wake_at_ms: u64,
        reported: Option<String>,
    ) {
        while let Some(now_ms) = current_ms() {
            tokio::time::sleep(sleep_for(now_ms, wake_at_ms)).await;

            if let Some(reported) = &reported {
                let reason = format!("its background work outlived the grace period: {reported}");
                self.complete(&state, &deferral, generation, &reason).await;
                return;
            }

            let live = crate::claude_background_work::live_pending_background_tasks(
                state.pty_manager.as_ref(),
                &deferral.task_id,
                deferral.pty_instance_id,
                deferral.plan.transcript_path.as_deref(),
            )
            .await;
            let Some(now_ms) = current_ms() else { break };

            match next_wake(expiries(&live), now_ms, deadlines) {
                Next::WakeAt(next_wake_at_ms) => wake_at_ms = next_wake_at_ms,
                Next::CompleteNow if live.is_empty() => {
                    self.complete(
                        &state,
                        &deferral,
                        generation,
                        "its background work finished",
                    )
                    .await;
                    return;
                }
                Next::CompleteNow => {
                    let reason = format!(
                        "its background work outlived the grace period: {}",
                        crate::claude_background_work::describe_tasks(&live)
                    );
                    self.complete(&state, &deferral, generation, &reason).await;
                    return;
                }
            }
        }

        self.complete(&state, &deferral, generation, "the clock could not be read")
            .await;
    }

    async fn complete(
        &self,
        state: &AppState,
        deferral: &DeferredCompletion,
        generation: u64,
        reason: &str,
    ) {
        loop {
            let guard = self.task_guard(&deferral.task_id).await;
            let is_current = self
                .scheduled
                .lock()
                .await
                .get(&deferral.task_id)
                .is_some_and(|scheduled| scheduled.generation == generation);
            if !is_current {
                return;
            }
            let db = state.db.clone();
            let pending = deferral.clone();
            let result = tokio::task::spawn_blocking(move || {
                crate::db::acquire_db(&db).complete_agent_completion(&pending)
            })
            .await;
            let change = match result {
                Ok(Ok(change)) => change,
                _ => {
                    warn!(
                        "[deferred_completion] domain commit failed; obligation retained for retry"
                    );
                    drop(guard);
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            self.scheduled.lock().await.remove(&deferral.task_id);
            info!(
                "[deferred_completion] completing task {} because {}",
                deferral.task_id, reason
            );
            let notification = crate::agent_lifecycle::AgentLifecycleNotification {
                provider: "claude-code".into(),
                task_id: deferral.task_id.clone(),
                pty_instance_id: deferral.pty_instance_id,
                provider_session_id: None,
                kind: crate::agent_lifecycle::AgentLifecycleEventKind::Ended,
                raw_event_type: Some("stop".into()),
                raw_status_type: None,
            };
            if super::legacy_transport::events::publish_recorded_lifecycle(
                state.clone(),
                notification,
                deferral.plan.transcript_path.clone(),
                None,
                change,
                |db, refresh| async move {
                    crate::task_metadata_refresh::refresh_queued_task_display_title_with_ai_once(
                        db, refresh,
                    )
                    .await
                },
            )
            .await
            .is_err()
            {
                warn!("[deferred_completion] completion committed; presentation follow-up failed");
            }
            return;
        }
    }
}

impl Default for DeferredCompletionWatcher {
    fn default() -> Self {
        Self::new()
    }
}

/// Resolve timing before the transaction; the transaction decides session eligibility.
pub(crate) fn completion_plan(
    state: &AppState,
    transcript_path: Option<String>,
    outstanding: &OutstandingWork,
) -> Result<Option<CompletionPlan>, String> {
    if outstanding.is_empty() {
        return Ok(None);
    }
    let now_ms = current_ms().ok_or("completion clock unavailable")?;
    let deadlines = Deadlines {
        grace_ms: now_ms.saturating_add(grace_period(state).as_millis() as u64),
        ceiling_ms: now_ms.saturating_add(MAX_DEFERRAL.as_millis() as u64),
    };
    let wake_at_ms = match next_wake(expiries(outstanding.tasks()), now_ms, deadlines) {
        Next::WakeAt(at) => at,
        Next::CompleteNow => now_ms,
    };
    let reported = match outstanding {
        OutstandingWork::Reported(tasks) => {
            Some(crate::claude_background_work::describe_tasks(tasks))
        }
        OutstandingWork::Replayed(_) => None,
    };
    Ok(Some(CompletionPlan {
        grace_ms: deadlines.grace_ms,
        ceiling_ms: deadlines.ceiling_ms,
        wake_at_ms,
        transcript_path,
        reported,
    }))
}

fn expiries(live: &[PendingBackgroundTask]) -> impl Iterator<Item = Option<u64>> + '_ {
    live.iter().map(PendingBackgroundTask::expires_at_ms)
}

fn next_wake(
    expiries: impl Iterator<Item = Option<u64>>,
    now_ms: u64,
    deadlines: Deadlines,
) -> Next {
    let wake_at_ms = expiries
        .map(|expires_at_ms| expires_at_ms.unwrap_or(deadlines.grace_ms))
        .max()
        .map(|wake_at_ms| wake_at_ms.min(deadlines.ceiling_ms));

    match wake_at_ms {
        Some(wake_at_ms) if wake_at_ms > now_ms => Next::WakeAt(wake_at_ms),
        _ => Next::CompleteNow,
    }
}

fn sleep_for(now_ms: u64, wake_at_ms: u64) -> Duration {
    Duration::from_millis(wake_at_ms.saturating_sub(now_ms)).min(MAX_DEFERRAL)
}

fn current_ms() -> Option<u64> {
    crate::unix_timestamp::milliseconds(std::time::SystemTime::now()).ok()
}

fn grace_period(state: &AppState) -> Duration {
    let configured = state
        .db
        .lock()
        .ok()
        .and_then(|db| db.get_config(BACKGROUND_WORK_GRACE_CONFIG_KEY).ok())
        .flatten()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(DEFAULT_BACKGROUND_WORK_GRACE_SECONDS)
        .min(MAX_BACKGROUND_WORK_GRACE_SECONDS);
    Duration::from_secs(configured)
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW_MS: u64 = 1_700_000_000_000;
    const DEADLINES: Deadlines = Deadlines {
        grace_ms: NOW_MS + 600_000,
        ceiling_ms: NOW_MS + 86_400_000,
    };

    fn next_wake_for(expiries: [Option<u64>; 2], now_ms: u64) -> Next {
        next_wake(expiries.into_iter(), now_ms, DEADLINES)
    }

    #[test]
    fn a_drained_task_list_completes_immediately() {
        assert_eq!(
            next_wake(std::iter::empty(), NOW_MS, DEADLINES),
            Next::CompleteNow
        );
    }

    #[test]
    fn the_last_monitor_to_expire_sets_the_wake() {
        assert_eq!(
            next_wake_for([Some(NOW_MS + 5_000), Some(NOW_MS + 90_000)], NOW_MS),
            Next::WakeAt(NOW_MS + 90_000)
        );
    }

    #[test]
    fn work_that_declares_no_end_waits_for_the_grace_deadline() {
        assert_eq!(
            next_wake_for([None, Some(NOW_MS + 5_000)], NOW_MS),
            Next::WakeAt(DEADLINES.grace_ms)
        );
    }

    #[test]
    fn work_that_declares_no_end_completes_once_the_grace_deadline_has_passed() {
        assert_eq!(
            next_wake_for([None, None], DEADLINES.grace_ms),
            Next::CompleteNow
        );
    }

    #[test]
    fn a_monitor_armed_past_the_grace_deadline_holds_endless_work_open() {
        assert_eq!(
            next_wake_for([None, Some(DEADLINES.grace_ms + 60_000)], NOW_MS),
            Next::WakeAt(DEADLINES.grace_ms + 60_000)
        );
    }

    #[test]
    fn a_monitor_declaring_more_than_the_maximum_deferral_is_cut_short() {
        assert_eq!(
            next_wake_for([Some(u64::MAX), None], NOW_MS),
            Next::WakeAt(DEADLINES.ceiling_ms)
        );
        assert_eq!(
            next_wake_for([Some(u64::MAX), None], DEADLINES.ceiling_ms),
            Next::CompleteNow
        );
    }

    #[test]
    fn a_single_sleep_never_runs_longer_than_the_maximum_deferral() {
        assert_eq!(sleep_for(NOW_MS, NOW_MS + 30_000), Duration::from_secs(30));
        assert_eq!(sleep_for(NOW_MS, u64::MAX), MAX_DEFERRAL);
        assert_eq!(sleep_for(NOW_MS, NOW_MS - 1), Duration::ZERO);
    }
}
