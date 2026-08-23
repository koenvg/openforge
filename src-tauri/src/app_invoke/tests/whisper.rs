use super::*;

const CONCURRENCY_TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[tokio::test]
async fn handles_model_status_selection_and_transcription_errors() {
    let (state, path) = test_state("app_invoke_whisper_status_selection");

    let statuses = invoke_ok(
        &state,
        "get_all_whisper_model_statuses",
        serde_json::Value::Null,
    )
    .await;
    let statuses = statuses.as_array().expect("whisper statuses");
    assert_eq!(statuses.len(), 5);
    assert!(statuses
        .iter()
        .any(|status| status["size"] == "small" && status["is_active"] == true));

    invoke_ok(&state, "set_whisper_model", json!({ "modelSize": "tiny" })).await;
    let active_status =
        invoke_ok(&state, "get_whisper_model_status", serde_json::Value::Null).await;
    assert_eq!(active_status["size"], "tiny");

    let err = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAAAAM3MzD3Nzcy9" }),
    )
    .await
    .expect_err("missing local model should fail transcription");
    assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(err.1.contains("Transcription failed"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn accepts_compact_voice_transcription_payloads() {
    let (state, path) = test_state("app_invoke_compact_voice_transcription_payload");
    let samples = 120_000;
    let raw_pcm_bytes = vec![0_u8; samples * 4];
    let audio_pcm_base64 =
        base64::Engine::encode(&base64::engine::general_purpose::STANDARD, raw_pcm_bytes);
    let json_number_array_len = r#"{"command":"transcribe_audio","payload":{"audioData":[]}}"#
        .len()
        + samples * "-0.12345678901234568,".len();
    assert!(
        audio_pcm_base64.len() * 2 < json_number_array_len,
        "base64 PCM payload should be materially smaller than decimal JSON samples"
    );

    let err = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": audio_pcm_base64 }),
    )
    .await
    .expect_err("missing local model should fail transcription");
    assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(err.1.contains("Transcription failed"));

    let _ = std::fs::remove_file(path);
}

#[tokio::test]
async fn rejects_bad_transcription_payloads_as_bad_request() {
    let (state, path) = test_state("app_invoke_rejects_bad_whisper_payload");

    let malformed = invoke(&state, "transcribe_audio", serde_json::Value::Null)
        .await
        .expect_err("null transcription payload should be rejected");
    assert_eq!(malformed.0, StatusCode::BAD_REQUEST);

    let unaligned = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAA=" }),
    )
    .await
    .expect_err("unaligned pcm payload should be rejected");
    assert_eq!(unaligned.0, StatusCode::BAD_REQUEST);
    assert!(unaligned
        .1
        .contains("payload.audioPcmBase64 decoded byte length must be divisible by 4"));

    let _ = std::fs::remove_file(path);
}

#[test]
fn unrelated_requests_remain_responsive_during_transcription() {
    let (blocking_started_tx, blocking_started_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let release_rx = std::sync::Arc::new(std::sync::Mutex::new(release_rx));
    let (run_unrelated_tx, run_unrelated_rx) = tokio::sync::oneshot::channel();
    let (response_tx, response_rx) = std::sync::mpsc::channel();

    let worker = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime should build");
        runtime.block_on(async move {
            let (mut state, path) = test_state("app_invoke_whisper_blocking_responsiveness");
            state.whisper = Some(std::sync::Arc::new(
                crate::whisper_manager::WhisperManager::with_transcription_override_for_test(
                    crate::whisper_manager::WhisperModelSize::Small,
                    move |_| {
                        blocking_started_tx
                            .send(())
                            .expect("report blocking Whisper work start");
                        release_rx
                            .lock()
                            .expect("lock Whisper release receiver")
                            .recv()
                            .expect("release blocking Whisper work");
                        Ok(crate::whisper_manager::TranscriptionResult {
                            text: "test transcript".to_string(),
                            duration_ms: 0,
                        })
                    },
                ),
            ));
            let state = std::sync::Arc::new(state);
            let transcription_state = std::sync::Arc::clone(&state);
            let transcription = tokio::spawn(async move {
                invoke(
                    &transcription_state,
                    "transcribe_audio",
                    json!({ "audioPcmBase64": "AAAAAA==" }),
                )
                .await
            });

            run_unrelated_rx
                .await
                .expect("start unrelated app-invoke request");
            let response = invoke(
                &state,
                "get_all_whisper_model_statuses",
                serde_json::Value::Null,
            )
            .await;
            response_tx
                .send(response)
                .expect("report unrelated app-invoke response");

            let transcription = transcription
                .await
                .expect("transcription task should join")
                .expect("transcription request should succeed");
            assert_eq!(transcription["text"], "test transcript");
            let _ = std::fs::remove_file(path);
        });
    });

    blocking_started_rx
        .recv_timeout(CONCURRENCY_TEST_TIMEOUT)
        .expect("blocking Whisper work should start");
    run_unrelated_tx
        .send(())
        .expect("start unrelated app-invoke request");
    let unrelated_response = response_rx.recv_timeout(CONCURRENCY_TEST_TIMEOUT);
    release_tx
        .send(())
        .expect("release blocking Whisper operation");
    worker.join().expect("test runtime thread should join");

    let unrelated_response = unrelated_response
        .expect("unrelated app-invoke request should finish while Whisper work is blocked");
    assert!(
        unrelated_response.is_ok(),
        "unrelated app-invoke request should succeed: {unrelated_response:?}"
    );
}

#[tokio::test(flavor = "current_thread")]
async fn transcription_inference_runs_off_the_tokio_request_executor() {
    let request_thread = std::thread::current().id();
    let (inference_thread_tx, inference_thread_rx) = std::sync::mpsc::channel();
    let (mut state, path) = test_state("app_invoke_whisper_worker_thread");
    state.whisper = Some(std::sync::Arc::new(
        crate::whisper_manager::WhisperManager::with_transcription_override_for_test(
            crate::whisper_manager::WhisperModelSize::Small,
            move |_| {
                inference_thread_tx
                    .send(std::thread::current().id())
                    .expect("report Whisper inference thread");
                Ok(crate::whisper_manager::TranscriptionResult {
                    text: "worker transcript".to_string(),
                    duration_ms: 0,
                })
            },
        ),
    ));

    let transcription = invoke_ok(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAAAAA==" }),
    )
    .await;
    let inference_thread = inference_thread_rx
        .recv_timeout(CONCURRENCY_TEST_TIMEOUT)
        .expect("Whisper inference should report its thread");

    assert_eq!(transcription["text"], "worker transcript");
    assert_ne!(inference_thread, request_thread);
    let _ = std::fs::remove_file(path);
}
