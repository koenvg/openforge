use super::download::sha1_digest_to_lower_hex;
use super::*;
use sha1::{Digest, Sha1};

#[test]
fn test_sha1_digest_to_lower_hex_preserves_expected_format() {
    let mut hasher = Sha1::new();
    hasher.update(b"abc");

    assert_eq!(
        sha1_digest_to_lower_hex(hasher.finalize()),
        "a9993e364706816aba3e25717850c26c9cd0d89d"
    );
}

#[test]
fn test_manager_with_active_model() {
    let mgr = WhisperManager::with_active_model(WhisperModelSize::Tiny);
    assert_eq!(mgr.get_active_model(), WhisperModelSize::Tiny);
}

#[test]
fn test_model_sizes_all() {
    let sizes = WhisperModelSize::all();
    assert_eq!(sizes.len(), 5);
    assert_eq!(sizes[0], WhisperModelSize::Tiny);
    assert_eq!(sizes[3], WhisperModelSize::Medium);
    assert_eq!(sizes[4], WhisperModelSize::Large);
}

#[test]
fn test_model_size_from_str() {
    assert_eq!(
        WhisperModelSize::from_str("tiny"),
        Some(WhisperModelSize::Tiny)
    );
    assert_eq!(
        WhisperModelSize::from_str("Small"),
        Some(WhisperModelSize::Small)
    );
    assert_eq!(
        WhisperModelSize::from_str("MEDIUM"),
        Some(WhisperModelSize::Medium)
    );
    assert_eq!(
        WhisperModelSize::from_str("large"),
        Some(WhisperModelSize::Large)
    );
    assert_eq!(WhisperModelSize::from_str("huge"), None);
}

#[test]
fn test_model_size_as_str() {
    assert_eq!(WhisperModelSize::Tiny.as_str(), "tiny");
    assert_eq!(WhisperModelSize::Base.as_str(), "base");
    assert_eq!(WhisperModelSize::Small.as_str(), "small");
    assert_eq!(WhisperModelSize::Medium.as_str(), "medium");
    assert_eq!(WhisperModelSize::Large.as_str(), "large");
}

#[test]
fn test_model_size_display() {
    assert_eq!(format!("{}", WhisperModelSize::Tiny), "tiny");
    assert_eq!(format!("{}", WhisperModelSize::Medium), "medium");
    assert_eq!(format!("{}", WhisperModelSize::Large), "large");
}

#[test]
fn test_model_spec_tiny() {
    let spec = WhisperModelSize::Tiny.spec();
    assert_eq!(spec.display_name, "Tiny");
    assert_eq!(spec.filename, "ggml-tiny.bin");
    assert_eq!(spec.disk_size_mb, 75);
}

#[test]
fn test_model_spec_small() {
    let spec = WhisperModelSize::Small.spec();
    assert_eq!(spec.display_name, "Small");
    assert_eq!(spec.filename, "ggml-small.bin");
    assert_eq!(spec.sha1, "55356645c2b361a969dfd0ef2c5a50d530afd8d5");
}

#[test]
fn test_model_spec_medium() {
    let spec = WhisperModelSize::Medium.spec();
    assert_eq!(spec.display_name, "Medium");
    assert_eq!(spec.filename, "ggml-medium.bin");
    assert_eq!(spec.disk_size_mb, 1500);
}

#[test]
fn test_model_spec_large() {
    let spec = WhisperModelSize::Large.spec();
    assert_eq!(spec.display_name, "Large");
    assert_eq!(spec.filename, "ggml-large-v3.bin");
    assert_eq!(spec.sha1, "ad82bf6a9043ceed055076d0fd39f5f186ff8062");
    assert_eq!(spec.disk_size_mb, 3100);
    assert_eq!(spec.ram_usage_mb, 4000);
}

#[test]
fn test_model_file_path_contains_model_name() {
    for size in WhisperModelSize::all() {
        let spec = size.spec();
        if let Some(path) = WhisperManager::model_file_path_for(*size) {
            assert!(path.to_string_lossy().contains(spec.filename));
        }
    }
}

#[test]
fn test_get_model_status_returns_correct_info() {
    let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
    let status = mgr.get_model_status();
    assert_eq!(status.size, "small");
    assert_eq!(status.display_name, "Small");
    assert_eq!(status.model_name, "ggml-small.bin");
    assert!(status.is_active);
}

#[test]
fn test_get_all_model_statuses() {
    let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
    let statuses = mgr.get_all_model_statuses();
    assert_eq!(statuses.len(), 5);
    assert_eq!(statuses[0].size, "tiny");
    assert_eq!(statuses[1].size, "base");
    assert_eq!(statuses[2].size, "small");
    assert_eq!(statuses[3].size, "medium");
    assert_eq!(statuses[4].size, "large");

    let active_count = statuses.iter().filter(|status| status.is_active).count();
    assert_eq!(active_count, 1);
    assert!(statuses[2].is_active);
}

#[test]
fn test_set_active_model() {
    let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
    assert_eq!(mgr.get_active_model(), WhisperModelSize::Small);

    mgr.set_active_model(WhisperModelSize::Tiny);
    assert_eq!(mgr.get_active_model(), WhisperModelSize::Tiny);

    let status = mgr.get_model_status();
    assert_eq!(status.size, "tiny");
    assert!(status.is_active);
}

#[test]
fn test_error_display_model_not_found() {
    let error = WhisperError::ModelNotFound;
    assert!(error.to_string().contains("not found"));
}

#[test]
fn test_error_display_hash_mismatch() {
    let error = WhisperError::HashMismatch {
        expected: "aaa".to_string(),
        actual: "bbb".to_string(),
    };
    assert!(error.to_string().contains("aaa"));
    assert!(error.to_string().contains("bbb"));
}

#[test]
fn test_error_display_download_failed() {
    let error = WhisperError::ModelDownloadFailed("timeout".to_string());
    assert!(error.to_string().contains("timeout"));
}

#[test]
fn test_error_display_inference_error() {
    let error = WhisperError::InferenceError("oom".to_string());
    assert!(error.to_string().contains("oom"));
}

#[test]
fn test_error_display_context_load_error() {
    let error = WhisperError::ContextLoadError("bad path".to_string());
    assert!(error.to_string().contains("bad path"));
}

#[test]
fn test_ensure_loaded_returns_not_found_when_missing() {
    let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
    if WhisperManager::model_file_path_for(WhisperModelSize::Small)
        .map(|path| !path.exists())
        .unwrap_or(true)
    {
        let result = mgr.ensure_loaded();
        assert!(matches!(result, Err(WhisperError::ModelNotFound)));
    }
}

#[test]
fn test_get_model_status_downloaded_when_file_exists() {
    if let Some(path) = WhisperManager::model_file_path_for(WhisperModelSize::Small) {
        let created = if !path.exists() {
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            std::fs::File::create(&path).is_ok()
        } else {
            false
        };
        let mgr = WhisperManager::with_active_model(WhisperModelSize::Small);
        let status = mgr.get_model_status();
        assert!(status.downloaded);
        assert!(status.model_size_bytes.is_some());
        if created {
            let _ = std::fs::remove_file(&path);
        }
    }
}

#[test]
fn test_transcription_result_serializes() {
    let result = TranscriptionResult {
        text: "hello".to_string(),
        duration_ms: 100,
    };
    let value = serde_json::to_value(&result).unwrap();
    assert_eq!(value["text"], "hello");
    assert_eq!(value["duration_ms"], 100);
}

#[test]
fn test_whisper_model_status_serializes() {
    let status = WhisperModelStatus {
        size: "small".to_string(),
        display_name: "Small".to_string(),
        downloaded: true,
        model_path: Some("/tmp/model.bin".to_string()),
        model_size_bytes: Some(1234),
        model_name: "ggml-small.bin".to_string(),
        disk_size_mb: 466,
        ram_usage_mb: 1000,
        is_active: true,
    };
    let value = serde_json::to_value(&status).unwrap();
    assert_eq!(value["downloaded"], true);
    assert_eq!(value["model_name"], "ggml-small.bin");
    assert_eq!(value["size"], "small");
    assert_eq!(value["display_name"], "Small");
    assert_eq!(value["is_active"], true);
    assert_eq!(value["disk_size_mb"], 466);
    assert_eq!(value["ram_usage_mb"], 1000);
}

#[test]
fn test_whisper_download_progress_serializes() {
    let progress = WhisperDownloadProgress {
        model_size: "tiny".to_string(),
        bytes_downloaded: 512,
        total_bytes: 1024,
        percentage: 50.0,
    };
    let value = serde_json::to_value(&progress).unwrap();
    assert_eq!(value["model_size"], "tiny");
    assert_eq!(value["bytes_downloaded"], 512);
    assert_eq!(value["total_bytes"], 1024);
    assert!((value["percentage"].as_f64().unwrap() - 50.0).abs() < 0.001);
}

#[test]
fn test_model_size_serde_roundtrip() {
    let size = WhisperModelSize::Small;
    let json = serde_json::to_string(&size).unwrap();
    assert_eq!(json, "\"small\"");
    let parsed: WhisperModelSize = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed, size);
}

#[test]
fn test_all_model_sizes_serde() {
    for size in WhisperModelSize::all() {
        let json = serde_json::to_string(size).unwrap();
        let parsed: WhisperModelSize = serde_json::from_str(&json).unwrap();
        assert_eq!(&parsed, size);
    }
}
