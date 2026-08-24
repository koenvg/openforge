use super::{WhisperError, WhisperManager};
use serde::Serialize;
use std::time::Instant;
use whisper_rs::{FullParams, SamplingStrategy};

/// Result of a successful transcription inference.
#[derive(Debug, Clone, Serialize)]
pub struct TranscriptionResult {
    /// Transcribed text, with leading/trailing whitespace trimmed.
    pub text: String,
    /// Wall-clock duration of the inference call in milliseconds.
    pub duration_ms: u64,
}

impl WhisperManager {
    #[cfg(test)]
    pub(crate) fn with_transcription_override_for_test<F>(
        size: super::WhisperModelSize,
        transcribe: F,
    ) -> Self
    where
        F: Fn(&[f32]) -> Result<TranscriptionResult, WhisperError> + Send + Sync + 'static,
    {
        let mut manager = Self::with_active_model(size);
        manager.transcription_override = Some(std::sync::Arc::new(transcribe));
        manager
    }

    /// Run one transcription without occupying Tokio's blocking pool while waiting for capacity.
    ///
    /// Only one Whisper inference runs at a time. Requests waiting for admission are async and
    /// can be cancelled without spawning blocking work. Once admitted, inference cannot be
    /// aborted; it retains the admission permit until the blocking operation finishes.
    ///
    /// # Errors
    ///
    /// Returns the errors documented by [`Self::transcribe`], or [`WhisperError::WorkerError`]
    /// if admission closes or the blocking task cannot complete.
    pub async fn transcribe_async(
        self: &std::sync::Arc<Self>,
        audio_data: Vec<f32>,
    ) -> Result<TranscriptionResult, WhisperError> {
        let admission = std::sync::Arc::clone(&self.transcription_admission)
            .acquire_owned()
            .await
            .map_err(|error| WhisperError::WorkerError(error.to_string()))?;
        let manager = std::sync::Arc::clone(self);

        tokio::task::spawn_blocking(move || {
            let _admission = admission;
            manager.transcribe(&audio_data)
        })
        .await
        .map_err(|error| WhisperError::WorkerError(error.to_string()))?
    }

    /// Transcribe 16 kHz mono f32 PCM audio data to text.
    ///
    /// Lazily loads the active model on first use.
    ///
    /// # Errors
    /// - [`WhisperError::ModelNotFound`] if the model is not downloaded.
    /// - [`WhisperError::ContextLoadError`] if the context cannot be initialised.
    /// - [`WhisperError::InferenceError`] if the inference call fails.
    pub fn transcribe(&self, audio_data: &[f32]) -> Result<TranscriptionResult, WhisperError> {
        #[cfg(test)]
        if let Some(transcribe) = self.transcription_override.as_ref() {
            return transcribe(audio_data);
        }
        let loaded_context = self.acquire_context()?;
        let context = loaded_context.get().ok_or_else(|| {
            WhisperError::ContextLoadError("Context unexpectedly absent after load".to_string())
        })?;

        let mut state = context.context.create_state().map_err(|error| {
            WhisperError::InferenceError(format!("create_state failed: {}", error))
        })?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        params.set_language(Some("en"));
        params.set_print_special(false);
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_timestamps(false);

        let start = Instant::now();
        state
            .full(params, audio_data)
            .map_err(|error| WhisperError::InferenceError(format!("full() failed: {}", error)))?;
        let duration_ms = start.elapsed().as_millis() as u64;

        let mut text = String::new();
        for index in 0..state.full_n_segments() {
            let segment = state.get_segment(index).ok_or_else(|| {
                WhisperError::InferenceError(format!("segment {} not found", index))
            })?;
            let segment_text = segment.to_str_lossy().map_err(|error| {
                WhisperError::InferenceError(format!("segment {} text: {}", index, error))
            })?;
            text.push_str(&segment_text);
        }

        Ok(TranscriptionResult {
            text: text.trim().to_string(),
            duration_ms,
        })
    }
}
