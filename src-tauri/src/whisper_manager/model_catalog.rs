use super::WhisperManager;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::path::PathBuf;

const APP_DIR_NAME: &str = "openforge";
const MODELS_SUBDIR: &str = "models";

/// Available Whisper model sizes, ordered from smallest to largest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WhisperModelSize {
    Tiny,
    Base,
    Small,
    Medium,
    Large,
}

impl WhisperModelSize {
    /// All available model sizes in order.
    pub fn all() -> &'static [WhisperModelSize] {
        &[
            WhisperModelSize::Tiny,
            WhisperModelSize::Base,
            WhisperModelSize::Small,
            WhisperModelSize::Medium,
            WhisperModelSize::Large,
        ]
    }

    /// Parse a model size from a string (case-insensitive).
    pub fn from_str(s: &str) -> Option<WhisperModelSize> {
        match s.to_lowercase().as_str() {
            "tiny" => Some(WhisperModelSize::Tiny),
            "base" => Some(WhisperModelSize::Base),
            "small" => Some(WhisperModelSize::Small),
            "medium" => Some(WhisperModelSize::Medium),
            "large" => Some(WhisperModelSize::Large),
            _ => None,
        }
    }

    /// Return the specification (metadata) for this model size.
    pub fn spec(&self) -> ModelSpec {
        match self {
            WhisperModelSize::Tiny => ModelSpec {
                display_name: "Tiny",
                filename: "ggml-tiny.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin",
                sha1: "bd577a113a864445d4c299885e0cb97d4ba92b5f",
                disk_size_mb: 75,
                ram_usage_mb: 390,
            },
            WhisperModelSize::Base => ModelSpec {
                display_name: "Base",
                filename: "ggml-base.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin",
                sha1: "465707469ff3a37a2b9b8d8f89f2f99de7299dac",
                disk_size_mb: 142,
                ram_usage_mb: 500,
            },
            WhisperModelSize::Small => ModelSpec {
                display_name: "Small",
                filename: "ggml-small.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
                sha1: "55356645c2b361a969dfd0ef2c5a50d530afd8d5",
                disk_size_mb: 466,
                ram_usage_mb: 1000,
            },
            WhisperModelSize::Medium => ModelSpec {
                display_name: "Medium",
                filename: "ggml-medium.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
                sha1: "fd9727b6e1217c2f614f9b698455c4ffd82463b4",
                disk_size_mb: 1500,
                ram_usage_mb: 2600,
            },
            WhisperModelSize::Large => ModelSpec {
                display_name: "Large",
                filename: "ggml-large-v3.bin",
                url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
                sha1: "ad82bf6a9043ceed055076d0fd39f5f186ff8062",
                disk_size_mb: 3100,
                ram_usage_mb: 4000,
            },
        }
    }

    /// Serde-compatible string representation.
    pub fn as_str(&self) -> &'static str {
        match self {
            WhisperModelSize::Tiny => "tiny",
            WhisperModelSize::Base => "base",
            WhisperModelSize::Small => "small",
            WhisperModelSize::Medium => "medium",
            WhisperModelSize::Large => "large",
        }
    }
}

impl fmt::Display for WhisperModelSize {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Metadata for a specific Whisper model variant.
pub struct ModelSpec {
    pub display_name: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub sha1: &'static str,
    pub disk_size_mb: u32,
    pub ram_usage_mb: u32,
}

/// Status of a Whisper model on disk.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperModelStatus {
    /// Model size identifier ("tiny", "base", "small", "medium", "large").
    pub size: String,
    /// Human-readable display name ("Tiny", "Base", "Small", "Medium", "Large").
    pub display_name: String,
    /// Whether the model file exists on disk.
    pub downloaded: bool,
    /// Absolute path to the model file, if resolvable.
    pub model_path: Option<String>,
    /// File size in bytes, if present.
    pub model_size_bytes: Option<u64>,
    /// Human-readable model filename.
    pub model_name: String,
    /// Approximate download size in megabytes.
    pub disk_size_mb: u32,
    /// Approximate RAM usage during inference in megabytes.
    pub ram_usage_mb: u32,
    /// Whether this model is the currently active/selected model.
    pub is_active: bool,
}

impl WhisperManager {
    /// Return the expected on-disk path for a model file of the given size.
    ///
    /// Path: `$DATA_DIR/openforge/models/<filename>`
    pub(super) fn model_file_path_for(size: WhisperModelSize) -> Option<PathBuf> {
        let spec = size.spec();
        dirs::data_dir().map(|dir| {
            dir.join(APP_DIR_NAME)
                .join(MODELS_SUBDIR)
                .join(spec.filename)
        })
    }

    /// Return the status of the currently active model.
    pub fn get_model_status(&self) -> WhisperModelStatus {
        self.get_model_status_for(self.get_active_model())
    }

    /// Return the status of a specific model size.
    pub fn get_model_status_for(&self, size: WhisperModelSize) -> WhisperModelStatus {
        let spec = size.spec();
        let active = self.get_active_model();

        match Self::model_file_path_for(size) {
            None => WhisperModelStatus {
                size: size.as_str().to_string(),
                display_name: spec.display_name.to_string(),
                downloaded: false,
                model_path: None,
                model_size_bytes: None,
                model_name: spec.filename.to_string(),
                disk_size_mb: spec.disk_size_mb,
                ram_usage_mb: spec.ram_usage_mb,
                is_active: size == active,
            },
            Some(path) if path.exists() => {
                let file_size = std::fs::metadata(&path).ok().map(|metadata| metadata.len());
                WhisperModelStatus {
                    size: size.as_str().to_string(),
                    display_name: spec.display_name.to_string(),
                    downloaded: true,
                    model_path: Some(path.to_string_lossy().to_string()),
                    model_size_bytes: file_size,
                    model_name: spec.filename.to_string(),
                    disk_size_mb: spec.disk_size_mb,
                    ram_usage_mb: spec.ram_usage_mb,
                    is_active: size == active,
                }
            }
            Some(path) => WhisperModelStatus {
                size: size.as_str().to_string(),
                display_name: spec.display_name.to_string(),
                downloaded: false,
                model_path: Some(path.to_string_lossy().to_string()),
                model_size_bytes: None,
                model_name: spec.filename.to_string(),
                disk_size_mb: spec.disk_size_mb,
                ram_usage_mb: spec.ram_usage_mb,
                is_active: size == active,
            },
        }
    }

    /// Return the status of all available models.
    pub fn get_all_model_statuses(&self) -> Vec<WhisperModelStatus> {
        WhisperModelSize::all()
            .iter()
            .map(|size| self.get_model_status_for(*size))
            .collect()
    }
}
