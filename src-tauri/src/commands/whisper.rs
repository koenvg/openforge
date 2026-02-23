use std::sync::Mutex;
use tauri::State;
use crate::{db, whisper_manager::WhisperManager};

#[tauri::command]
pub async fn transcribe_audio(
    whisper: State<'_, WhisperManager>,
    audio_data: Vec<f32>,
) -> Result<crate::whisper_manager::TranscriptionResult, String> {
    whisper.transcribe(&audio_data)
        .map_err(|e| format!("Transcription failed: {}", e))
}

#[tauri::command]
pub async fn get_whisper_model_status(
    whisper: State<'_, WhisperManager>,
) -> Result<crate::whisper_manager::WhisperModelStatus, String> {
    Ok(whisper.get_model_status())
}

#[tauri::command]
pub async fn download_whisper_model(
    whisper: State<'_, WhisperManager>,
    app: tauri::AppHandle,
    db: State<'_, Mutex<db::Database>>,
) -> Result<(), String> {
    let db = db.lock().unwrap();
    whisper.download_model(app, &db).await
        .map_err(|e| format!("Model download failed: {}", e))
}
