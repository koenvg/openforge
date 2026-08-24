use super::*;
use base64::{engine::general_purpose, Engine as _};

fn payload_float32_pcm_base64(payload: &serde_json::Value) -> AppResult<Vec<f32>> {
    let encoded = payload_string(payload, "audioPcmBase64")?;
    let bytes = general_purpose::STANDARD.decode(encoded).map_err(|e| {
        (
            StatusCode::BAD_REQUEST,
            format!("payload.audioPcmBase64 must be valid base64: {e}"),
        )
    })?;

    if bytes.len() % std::mem::size_of::<f32>() != 0 {
        return Err((
            StatusCode::BAD_REQUEST,
            "payload.audioPcmBase64 decoded byte length must be divisible by 4".to_string(),
        ));
    }

    Ok(bytes
        .as_chunks::<{ std::mem::size_of::<f32>() }>()
        .0
        .iter()
        .map(|chunk| f32::from_le_bytes(*chunk))
        .collect())
}

fn parse_model_size(payload: &serde_json::Value) -> AppResult<WhisperModelSize> {
    let model_size = payload_string(payload, "modelSize")?;
    WhisperModelSize::from_str(&model_size).ok_or_else(|| {
        (
            StatusCode::BAD_REQUEST,
            format!("Invalid model size: {model_size}"),
        )
    })
}

async fn handle_transcription(
    whisper: &std::sync::Arc<crate::whisper_manager::WhisperManager>,
    payload: &serde_json::Value,
) -> AppResult<serde_json::Value> {
    let audio_data = payload_float32_pcm_base64(payload)?;
    let whisper = std::sync::Arc::clone(whisper);
    let transcription = whisper
        .transcribe_async(audio_data)
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Transcription failed: {error}"),
            )
        })?;

    json_value(transcription)
}

fn select_and_persist_model(
    state: &AppState,
    whisper: &crate::whisper_manager::WhisperManager,
    payload: &serde_json::Value,
) -> AppResult<()> {
    let size = parse_model_size(payload)?;
    let db = crate::db::acquire_db(&state.db);
    db.set_config("whisper_model_size", size.as_str())
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Failed to save model size to config: {error}"),
            )
        })?;
    whisper.set_active_model(size);
    Ok(())
}

async fn download_model_and_publish_progress(
    state: &AppState,
    whisper: &crate::whisper_manager::WhisperManager,
    payload: &serde_json::Value,
) -> AppResult<()> {
    let size = parse_model_size(payload)?;
    let app = state.app.clone();
    let event_tx = state.app_event_tx.clone();
    let path = whisper
        .download_model_with_progress(size, move |progress| {
            if let Ok(payload) = serde_json::to_value(&progress) {
                publish_app_event_to_runtime(
                    app.as_ref(),
                    &event_tx,
                    "whisper-download-progress",
                    &payload,
                );
            }
        })
        .await
        .map_err(|error| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Model download failed: {error}"),
            )
        })?;
    let db = crate::db::acquire_db(&state.db);
    db.set_config("whisper_model_path", &path).map_err(|error| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Failed to save model path to config: {error}"),
        )
    })
}

pub(super) async fn handle_app_whisper_command(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<Option<serde_json::Value>> {
    let Some(whisper) = state.whisper.as_ref() else {
        return Ok(None);
    };

    let value = match request.command.as_str() {
        "transcribe_audio" => handle_transcription(whisper, &request.payload).await?,
        "get_whisper_model_status" => json_value(whisper.get_model_status())?,
        "get_all_whisper_model_statuses" => json_value(whisper.get_all_model_statuses())?,
        "set_whisper_model" => {
            select_and_persist_model(state, whisper, &request.payload)?;
            serde_json::Value::Null
        }
        "download_whisper_model" => {
            download_model_and_publish_progress(state, whisper, &request.payload).await?;
            serde_json::Value::Null
        }
        _ => return Ok(None),
    };

    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decodes_base64_little_endian_float32_pcm() {
        let payload = json!({ "audioPcmBase64": "AAAAAAAAgD4AAIC+" });

        let decoded = payload_float32_pcm_base64(&payload).expect("decode pcm payload");

        assert_eq!(decoded, vec![0.0, 0.25, -0.25]);
    }

    #[test]
    fn rejects_base64_payloads_not_aligned_to_float32_samples() {
        let payload = json!({ "audioPcmBase64": "AAA=" });

        let error = payload_float32_pcm_base64(&payload).expect_err("reject unaligned payload");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert!(error
            .1
            .contains("payload.audioPcmBase64 decoded byte length must be divisible by 4"));
    }

    #[test]
    fn rejects_invalid_base64_pcm_payloads() {
        let payload = json!({ "audioPcmBase64": "not valid base64" });

        let error = payload_float32_pcm_base64(&payload).expect_err("reject invalid base64");

        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert!(error
            .1
            .contains("payload.audioPcmBase64 must be valid base64"));
    }
}
