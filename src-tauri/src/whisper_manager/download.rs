use super::{WhisperError, WhisperManager, WhisperModelSize};
use log::info;
use serde::Serialize;
use sha1::{Digest, Sha1};
use std::io::Write;
use tokio_stream::StreamExt;

/// Progress reported while a Whisper model is downloaded.
#[derive(Debug, Clone, Serialize)]
pub struct WhisperDownloadProgress {
    /// Which model size is being downloaded.
    pub model_size: String,
    pub bytes_downloaded: u64,
    pub total_bytes: u64,
    pub percentage: f32,
}

pub(super) fn sha1_digest_to_lower_hex(digest: impl AsRef<[u8]>) -> String {
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

impl WhisperManager {
    #[cfg(test)]
    pub(crate) fn with_download_override_for_test<F>(size: WhisperModelSize, download: F) -> Self
    where
        F: Fn(
                WhisperModelSize,
                &mut dyn FnMut(super::WhisperDownloadProgress),
            ) -> Result<String, WhisperError>
            + Send
            + Sync
            + 'static,
    {
        let mut manager = Self::with_active_model(size);
        manager.download_override = Some(std::sync::Arc::new(download));
        manager
    }

    /// Download a Whisper model file and report progress through a caller-provided callback.
    pub async fn download_model_with_progress<F>(
        &self,
        size: WhisperModelSize,
        mut on_progress: F,
    ) -> Result<String, WhisperError>
    where
        F: FnMut(WhisperDownloadProgress),
    {
        #[cfg(test)]
        if let Some(download) = self.download_override.as_ref() {
            return download(size, &mut on_progress);
        }
        let spec = size.spec();
        let dest_path = Self::model_file_path_for(size).ok_or_else(|| {
            WhisperError::ModelDownloadFailed("Cannot resolve data directory".to_string())
        })?;

        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                WhisperError::ModelDownloadFailed(format!("create_dir_all failed: {}", error))
            })?;
        }

        info!(
            "[whisper] Downloading model: {} ({}) from {}",
            size, spec.filename, spec.url
        );

        let response =
            self.client.get(spec.url).send().await.map_err(|error| {
                WhisperError::ModelDownloadFailed(format!("GET failed: {}", error))
            })?;

        if !response.status().is_success() {
            return Err(WhisperError::ModelDownloadFailed(format!(
                "HTTP {}: {}",
                response.status().as_u16(),
                response.status().canonical_reason().unwrap_or("unknown")
            )));
        }

        let total_bytes = response.content_length().unwrap_or(0);
        let tmp_path = dest_path.with_extension("bin.part");
        let mut file = std::fs::File::create(&tmp_path).map_err(|error| {
            WhisperError::ModelDownloadFailed(format!("create temp file: {}", error))
        })?;

        let mut hasher = Sha1::new();
        let mut bytes_downloaded = 0_u64;
        let mut stream = response.bytes_stream();

        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|error| {
                WhisperError::ModelDownloadFailed(format!("stream chunk: {}", error))
            })?;

            hasher.update(&chunk);
            file.write_all(&chunk).map_err(|error| {
                WhisperError::ModelDownloadFailed(format!("write chunk: {}", error))
            })?;

            bytes_downloaded += chunk.len() as u64;
            let percentage = if total_bytes > 0 {
                (bytes_downloaded as f32 / total_bytes as f32) * 100.0
            } else {
                0.0
            };

            on_progress(WhisperDownloadProgress {
                model_size: size.as_str().to_string(),
                bytes_downloaded,
                total_bytes,
                percentage,
            });
        }

        drop(file);

        let actual_hash = sha1_digest_to_lower_hex(hasher.finalize());
        if actual_hash != spec.sha1 {
            let _ = std::fs::remove_file(&tmp_path);
            return Err(WhisperError::HashMismatch {
                expected: spec.sha1.to_string(),
                actual: actual_hash,
            });
        }

        std::fs::rename(&tmp_path, &dest_path).map_err(|error| {
            WhisperError::ModelDownloadFailed(format!("rename temp to dest: {}", error))
        })?;

        let path = dest_path.to_string_lossy().to_string();
        info!("[whisper] Model downloaded and verified: {}", size);
        Ok(path)
    }
}
