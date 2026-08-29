use serde::Serialize;
use std::{
    collections::VecDeque,
    future::Future,
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::task::JoinHandle;

pub const PROCESS_MEMORY_HISTORY_ENABLED_CONFIG: &str = "process_memory_history_enabled";
pub const PROCESS_MEMORY_SAMPLE_INTERVAL_SECONDS: u64 = 60;
pub const PROCESS_MEMORY_MAX_SAMPLES: usize = 60;
pub const PROCESS_MEMORY_RSS_SEMANTICS: &str = "RSS is resident physical memory reported by the operating system. Totals include each category root and its descendants. Electron can include the sidecar, and the sidecar can include plugin-host and managed PTY processes. The trackedUniqueRssBytes field counts each sidecar-tracked process ID once.";

pub fn enabled_preference(db: &Arc<Mutex<crate::db::Database>>) -> Result<bool, String> {
    crate::db::acquire_db(db)
        .get_config(PROCESS_MEMORY_HISTORY_ENABLED_CONFIG)
        .map(|value| value.as_deref() == Some("true"))
        .map_err(|error| format!("failed to load process memory history preference: {error}"))
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryHistorySample {
    pub collected_at: String,
    pub electron_total_tree_rss_bytes: u64,
    pub sidecar_total_tree_rss_bytes: u64,
    pub managed_pty_total_tree_rss_bytes: u64,
    pub plugin_host_total_tree_rss_bytes: u64,
    pub tracked_unique_rss_bytes: u64,
}
impl From<crate::process_memory::ProcessMemoryDiagnostics> for ProcessMemoryHistorySample {
    fn from(diagnostics: crate::process_memory::ProcessMemoryDiagnostics) -> Self {
        let crate::process_memory::ProcessMemoryDiagnostics {
            collected_at,
            totals,
            ..
        } = diagnostics;
        Self {
            collected_at,
            electron_total_tree_rss_bytes: totals.electron_total_tree_rss_bytes,
            sidecar_total_tree_rss_bytes: totals.sidecar_total_tree_rss_bytes,
            managed_pty_total_tree_rss_bytes: totals.pty_total_tree_rss_bytes,
            plugin_host_total_tree_rss_bytes: totals.plugin_host_total_tree_rss_bytes,
            tracked_unique_rss_bytes: totals.tracked_unique_rss_bytes,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProcessMemoryHistorySnapshot {
    pub enabled: bool,
    pub sample_interval_seconds: u64,
    pub max_samples: usize,
    pub rss_semantics: &'static str,
    pub samples: Vec<ProcessMemoryHistorySample>,
}

#[derive(Clone)]
pub struct ProcessMemorySamplingContext {
    pub db: Arc<Mutex<crate::db::Database>>,
    pub pty_manager: Option<crate::pty_manager::PtyManager>,
    pub plugin_host: Option<crate::plugin_host::PluginHost>,
    pub github_client: crate::github_client::GitHubClient,
}

#[derive(Debug, Default)]
struct ProcessMemoryHistoryState {
    enabled: bool,
    samples: VecDeque<ProcessMemoryHistorySample>,
}

#[derive(Debug, Clone, Default)]
pub struct ProcessMemoryHistory {
    state: Arc<Mutex<ProcessMemoryHistoryState>>,
    sampler: Arc<Mutex<Option<JoinHandle<()>>>>,
    transition: Arc<tokio::sync::Mutex<()>>,
}

impl ProcessMemoryHistory {
    pub fn snapshot(&self) -> ProcessMemoryHistorySnapshot {
        let state = self
            .state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        ProcessMemoryHistorySnapshot {
            enabled: state.enabled,
            sample_interval_seconds: PROCESS_MEMORY_SAMPLE_INTERVAL_SECONDS,
            max_samples: PROCESS_MEMORY_MAX_SAMPLES,
            rss_semantics: PROCESS_MEMORY_RSS_SEMANTICS,
            samples: state.samples.iter().cloned().collect(),
        }
    }

    #[cfg(test)]
    fn record(&self, sample: ProcessMemoryHistorySample) {
        record_sample(&self.state, sample);
    }

    fn start_sampling_with<F, Fut>(&self, interval: Duration, collect: F)
    where
        F: Fn() -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<ProcessMemoryHistorySample, String>> + Send + 'static,
    {
        {
            let mut state = self
                .state
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            state.enabled = true;
        }

        let mut sampler = self
            .sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if sampler.as_ref().is_some_and(|task| !task.is_finished()) {
            return;
        }

        let state = Arc::clone(&self.state);
        *sampler = Some(tokio::spawn(async move {
            loop {
                match collect().await {
                    Ok(sample) => {
                        if !record_sample_if_enabled(&state, sample) {
                            return;
                        }
                    }
                    Err(error) => {
                        log::warn!("[process_memory] History sample failed: {error}");
                    }
                }
                tokio::time::sleep(interval).await;
            }
        }));
    }

    pub fn enable(&self, context: ProcessMemorySamplingContext) {
        let ProcessMemorySamplingContext {
            db,
            pty_manager,
            plugin_host,
            github_client,
        } = context;
        self.start_sampling_with(
            Duration::from_secs(PROCESS_MEMORY_SAMPLE_INTERVAL_SECONDS),
            move || {
                let db = Arc::clone(&db);
                let pty_manager = pty_manager.clone();
                let plugin_host = plugin_host.clone();
                let github_response_cache = github_client.response_cache_diagnostics();
                async move {
                    crate::process_memory::collect_process_memory_diagnostics(
                        db,
                        pty_manager,
                        plugin_host,
                        github_response_cache,
                    )
                    .await
                    .map(ProcessMemoryHistorySample::from)
                }
            },
        );
    }

    pub async fn set_enabled(
        &self,
        enabled: bool,
        context: ProcessMemorySamplingContext,
    ) -> Result<ProcessMemoryHistorySnapshot, String> {
        let _transition = self.transition.lock().await;
        {
            let db = crate::db::acquire_db(&context.db);
            let enabled_value = enabled.to_string();
            db.set_config(PROCESS_MEMORY_HISTORY_ENABLED_CONFIG, &enabled_value)
                .map_err(|error| {
                    format!("failed to persist process memory history preference: {error}")
                })?;
        }

        if enabled {
            self.enable(context);
        } else {
            self.disable();
        }
        Ok(self.snapshot())
    }

    pub fn disable(&self) {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .enabled = false;
        if let Some(task) = self
            .sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            task.abort();
        }
    }

    #[cfg(test)]
    fn sampler_running(&self) -> bool {
        self.sampler
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .as_ref()
            .is_some_and(|task| !task.is_finished())
    }
}

impl Drop for ProcessMemoryHistory {
    fn drop(&mut self) {
        if Arc::strong_count(&self.sampler) == 1 {
            if let Some(task) = self
                .sampler
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .take()
            {
                task.abort();
            }
        }
    }
}

#[cfg(test)]
fn record_sample(
    state: &Arc<Mutex<ProcessMemoryHistoryState>>,
    sample: ProcessMemoryHistorySample,
) {
    let mut state = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    push_sample(&mut state, sample);
}

fn record_sample_if_enabled(
    state: &Arc<Mutex<ProcessMemoryHistoryState>>,
    sample: ProcessMemoryHistorySample,
) -> bool {
    let mut state = state
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if !state.enabled {
        return false;
    }
    push_sample(&mut state, sample);
    true
}

fn push_sample(state: &mut ProcessMemoryHistoryState, sample: ProcessMemoryHistorySample) {
    state.samples.push_back(sample);
    while state.samples.len() > PROCESS_MEMORY_MAX_SAMPLES {
        state.samples.pop_front();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(index: u64) -> ProcessMemoryHistorySample {
        ProcessMemoryHistorySample {
            collected_at: format!("2026-07-03T12:{index:02}:00Z"),
            electron_total_tree_rss_bytes: index,
            sidecar_total_tree_rss_bytes: index + 1,
            managed_pty_total_tree_rss_bytes: index + 2,
            plugin_host_total_tree_rss_bytes: index + 3,
            tracked_unique_rss_bytes: index + 4,
        }
    }

    #[test]
    fn history_retains_only_the_latest_sixty_samples() {
        let history = ProcessMemoryHistory::default();

        for index in 0..61 {
            history.record(sample(index));
        }

        let snapshot = history.snapshot();
        assert_eq!(snapshot.samples.len(), 60);
        assert_eq!(snapshot.samples.first(), Some(&sample(1)));
        assert_eq!(snapshot.samples.last(), Some(&sample(60)));
        assert_eq!(snapshot.sample_interval_seconds, 60);
        assert_eq!(snapshot.max_samples, 60);
    }

    #[test]
    fn serialized_history_samples_contain_totals_only() {
        let history = ProcessMemoryHistory::default();
        history.record(sample(1));

        let value = serde_json::to_value(history.snapshot()).expect("serialize history");
        let stored_sample = value["samples"][0]
            .as_object()
            .expect("history sample object");

        assert_eq!(
            stored_sample.keys().map(String::as_str).collect::<Vec<_>>(),
            vec![
                "collectedAt",
                "electronTotalTreeRssBytes",
                "managedPtyTotalTreeRssBytes",
                "pluginHostTotalTreeRssBytes",
                "sidecarTotalTreeRssBytes",
                "trackedUniqueRssBytes",
            ]
        );
    }

    #[tokio::test]
    async fn opt_in_sampling_starts_immediately_and_disable_cleans_up_the_timer() {
        use std::sync::atomic::{AtomicU64, Ordering};
        use std::time::Duration;

        let history = ProcessMemoryHistory::default();
        let calls = Arc::new(AtomicU64::new(0));
        let collector_calls = Arc::clone(&calls);
        history.start_sampling_with(Duration::from_millis(5), move || {
            let index = collector_calls.fetch_add(1, Ordering::SeqCst);
            async move { Ok(sample(index)) }
        });

        tokio::time::timeout(Duration::from_millis(100), async {
            while history.snapshot().samples.len() < 2 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("sampler should collect without waiting a minute in the injected test interval");

        assert!(history.snapshot().enabled);
        assert!(history.sampler_running());
        history.disable();
        let calls_after_disable = calls.load(Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(20)).await;

        assert!(!history.snapshot().enabled);
        assert!(!history.sampler_running());
        assert_eq!(calls.load(Ordering::SeqCst), calls_after_disable);
    }
}
