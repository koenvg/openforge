//! Whisper model management for local speech-to-text transcription.
//!
//! The command-facing [`WhisperManager`] interface coordinates four focused
//! implementations: model catalog/status, downloads, inference, and context lifecycle.

mod download;
mod inference;
mod lifecycle;
mod model_catalog;

use crate::idle_resource::IdleResource;
use reqwest::Client;
use std::error::Error as StdError;
use std::fmt;
use std::sync::{Arc, Mutex, RwLock};

use lifecycle::LoadedWhisperContext;
// Preserve the command-facing facade while implementations live in focused modules.
#[allow(unused_imports)]
pub use {
    download::WhisperDownloadProgress,
    inference::TranscriptionResult,
    model_catalog::{ModelSpec, WhisperModelSize, WhisperModelStatus},
};

#[cfg(test)]
type TestTranscriptionOverride =
    dyn Fn(&[f32]) -> Result<TranscriptionResult, WhisperError> + Send + Sync;

/// Errors that can occur during Whisper model management and transcription.
#[derive(Debug)]
pub enum WhisperError {
    /// The model file is not present on disk.
    ModelNotFound,
    /// Downloading the model file failed.
    ModelDownloadFailed(String),
    /// The downloaded file's SHA1 hash does not match the expected value.
    HashMismatch { expected: String, actual: String },
    /// Transcription inference failed.
    InferenceError(String),
    /// Loading the WhisperContext from the model file failed.
    ContextLoadError(String),
}

impl fmt::Display for WhisperError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            WhisperError::ModelNotFound => {
                write!(f, "Whisper model not found — download it first")
            }
            WhisperError::ModelDownloadFailed(msg) => {
                write!(f, "Model download failed: {}", msg)
            }
            WhisperError::HashMismatch { expected, actual } => {
                write!(
                    f,
                    "Model hash mismatch — expected {}, got {}",
                    expected, actual
                )
            }
            WhisperError::InferenceError(msg) => {
                write!(f, "Transcription inference error: {}", msg)
            }
            WhisperError::ContextLoadError(msg) => {
                write!(f, "Failed to load Whisper context: {}", msg)
            }
        }
    }
}

impl StdError for WhisperError {}

/// Manages the selected Whisper model, its download, and its lazy inference context.
pub struct WhisperManager {
    context: Arc<IdleResource<LoadedWhisperContext>>,
    active_model: RwLock<WhisperModelSize>,
    client: Client,
    idle_reaper: Mutex<Option<tokio::task::JoinHandle<()>>>,
    #[cfg(test)]
    transcription_override: Option<Arc<TestTranscriptionOverride>>,
}

#[cfg(test)]
mod tests;
