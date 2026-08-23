use super::{WhisperError, WhisperManager, WhisperModelSize};
use crate::idle_resource::{IdleResource, IdleResourceGuard};
use log::info;
use reqwest::Client;
use std::sync::Arc;
use std::time::Duration;
use whisper_rs::{WhisperContext, WhisperContextParameters};

pub(crate) const WHISPER_IDLE_TIMEOUT: Duration = Duration::from_secs(5 * 60);

pub(super) struct LoadedWhisperContext {
    model: WhisperModelSize,
    pub(super) context: WhisperContext,
}

impl WhisperManager {
    /// Create a new manager with a specific active model.
    pub fn with_active_model(size: WhisperModelSize) -> Self {
        Self {
            context: Arc::new(IdleResource::new(WHISPER_IDLE_TIMEOUT)),
            transcription_admission: Arc::new(tokio::sync::Semaphore::new(
                super::MAX_CONCURRENT_TRANSCRIPTIONS,
            )),
            active_model: std::sync::RwLock::new(size),
            client: Client::new(),
            idle_reaper: std::sync::Mutex::new(None),
            #[cfg(test)]
            download_override: None,
            #[cfg(test)]
            transcription_override: None,
        }
    }

    /// Start the background task that releases an idle model context.
    pub fn start_idle_reaper(self: &Arc<Self>) {
        let mut reaper = self
            .idle_reaper
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if reaper.is_some() {
            return;
        }

        *reaper = Some(self.context.start_idle_reaper(|| {
            info!(
                "[whisper] Unloaded model after {} seconds of inactivity",
                WHISPER_IDLE_TIMEOUT.as_secs()
            );
        }));
    }

    /// Return the currently active model size.
    pub fn get_active_model(&self) -> WhisperModelSize {
        *self
            .active_model
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Select the active model and unload a context for the previous model.
    pub fn set_active_model(&self, size: WhisperModelSize) {
        let mut active = self
            .active_model
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let previous = *active;
        *active = size;

        if previous != size {
            self.context.clear();
            info!(
                "[whisper] Unloaded model (switching from {} to {})",
                previous, size
            );
        }
    }

    /// Ensure the active model's inference context is loaded.
    #[cfg(test)]
    pub fn ensure_loaded(&self) -> Result<(), WhisperError> {
        drop(self.acquire_context()?);
        Ok(())
    }

    pub(super) fn acquire_context(
        &self,
    ) -> Result<IdleResourceGuard<'_, LoadedWhisperContext>, WhisperError> {
        let active = self
            .active_model
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let selected_model = *active;
        let context = self.context.acquire_or_try_replace(
            |loaded| loaded.model == selected_model,
            || {
                let path =
                    Self::model_file_path_for(selected_model).ok_or(WhisperError::ModelNotFound)?;
                if !path.exists() {
                    return Err(WhisperError::ModelNotFound);
                }

                let path = path.to_string_lossy().to_string();
                info!(
                    "[whisper] Loading model: {} path_configured=true",
                    selected_model
                );
                let context =
                    WhisperContext::new_with_params(&path, WhisperContextParameters::default())
                        .map_err(|error| WhisperError::ContextLoadError(error.to_string()))?;

                info!("[whisper] Model loaded: {}", selected_model);
                Ok(LoadedWhisperContext {
                    model: selected_model,
                    context,
                })
            },
        );
        drop(active);
        context
    }
}

impl Drop for WhisperManager {
    fn drop(&mut self) {
        let reaper = self
            .idle_reaper
            .get_mut()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(reaper) = reaper.take() {
            reaper.abort();
        }
    }
}
