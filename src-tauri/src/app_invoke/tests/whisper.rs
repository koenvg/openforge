use super::*;

const CONCURRENCY_TEST_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[tokio::test]
async fn reports_active_and_all_model_statuses() {
    let (state, _temp_dir) = test_state("app_invoke_whisper_statuses");

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

    let active_status =
        invoke_ok(&state, "get_whisper_model_status", serde_json::Value::Null).await;
    assert_eq!(active_status["size"], "small");
}

#[tokio::test]
async fn selects_and_persists_whisper_model() {
    let (state, _temp_dir) = test_state("app_invoke_whisper_selection");

    let response = invoke_ok(&state, "set_whisper_model", json!({ "modelSize": "tiny" })).await;

    assert_eq!(response, serde_json::Value::Null);
    let active_status =
        invoke_ok(&state, "get_whisper_model_status", serde_json::Value::Null).await;
    assert_eq!(active_status["size"], "tiny");
    let persisted_size = state
        .db
        .lock()
        .expect("db lock")
        .get_config("whisper_model_size")
        .expect("read persisted Whisper model size");
    assert_eq!(persisted_size.as_deref(), Some("tiny"));
}

#[tokio::test]
async fn reports_transcription_failures() {
    let (state, _temp_dir) = test_state("app_invoke_whisper_transcription_error");

    let err = invoke(
        &state,
        "transcribe_audio",
        json!({ "audioPcmBase64": "AAAAAM3MzD3Nzcy9" }),
    )
    .await
    .expect_err("missing local model should fail transcription");

    assert_eq!(err.0, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(err.1.contains("Transcription failed"));
}

#[tokio::test]
async fn accepts_compact_voice_transcription_payloads() {
    let (state, _temp_dir) = test_state("app_invoke_compact_voice_transcription_payload");
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
}

#[tokio::test]
async fn rejects_bad_transcription_payloads_as_bad_request() {
    let (state, _temp_dir) = test_state("app_invoke_rejects_bad_whisper_payload");

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
            let (mut state, _temp_dir) = test_state("app_invoke_whisper_blocking_responsiveness");
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
    let (mut state, _temp_dir) = test_state("app_invoke_whisper_worker_thread");
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
}

#[test]
fn queued_transcriptions_do_not_consume_tokio_blocking_threads() {
    const REQUEST_COUNT: usize = 8;

    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let release_rx = std::sync::Arc::new(std::sync::Mutex::new(release_rx));
    let (result_tx, result_rx) = std::sync::mpsc::channel();
    let active_transcriptions = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let active_transcriptions_for_inference = std::sync::Arc::clone(&active_transcriptions);
    let max_active_transcriptions = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
    let max_active_transcriptions_for_inference = std::sync::Arc::clone(&max_active_transcriptions);
    let transcription_started = std::sync::Arc::new(tokio::sync::Notify::new());
    let transcription_started_for_inference = std::sync::Arc::clone(&transcription_started);

    let worker = std::thread::spawn(move || {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .max_blocking_threads(2)
            .build()
            .expect("test runtime should build");
        runtime.block_on(async move {
            let (mut state, _temp_dir) = test_state("app_invoke_whisper_bounded_admission");
            state.whisper = Some(std::sync::Arc::new(
                crate::whisper_manager::WhisperManager::with_transcription_override_for_test(
                    crate::whisper_manager::WhisperModelSize::Small,
                    move |_| {
                        let active = active_transcriptions_for_inference
                            .fetch_add(1, std::sync::atomic::Ordering::SeqCst)
                            + 1;
                        max_active_transcriptions_for_inference
                            .fetch_max(active, std::sync::atomic::Ordering::SeqCst);
                        transcription_started_for_inference.notify_one();
                        release_rx
                            .lock()
                            .expect("lock Whisper release receiver")
                            .recv()
                            .expect("release blocking Whisper work");
                        active_transcriptions_for_inference
                            .fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
                        Ok(crate::whisper_manager::TranscriptionResult {
                            text: "test transcript".to_string(),
                            duration_ms: 0,
                        })
                    },
                ),
            ));
            let state = std::sync::Arc::new(state);

            let mut transcriptions = Vec::with_capacity(REQUEST_COUNT);
            for _ in 0..REQUEST_COUNT {
                let state = std::sync::Arc::clone(&state);
                let mut transcription = Box::pin(async move {
                    invoke(
                        &state,
                        "transcribe_audio",
                        json!({ "audioPcmBase64": "AAAAAA==" }),
                    )
                    .await
                });
                assert!(matches!(
                    futures::poll!(&mut transcription),
                    std::task::Poll::Pending
                ));
                transcriptions.push(transcription);
            }

            transcription_started.notified().await;
            let unrelated =
                tokio::time::timeout(CONCURRENCY_TEST_TIMEOUT, tokio::task::spawn_blocking(|| 42))
                    .await;
            result_tx
                .send(matches!(unrelated, Ok(Ok(42))))
                .expect("report unrelated blocking result");

            for transcription in transcriptions {
                transcription.await.expect("transcription should succeed");
            }
        });
    });

    let unrelated_completed = result_rx
        .recv_timeout(CONCURRENCY_TEST_TIMEOUT)
        .expect("unrelated blocking result should arrive");
    for _ in 0..REQUEST_COUNT {
        release_tx
            .send(())
            .expect("release blocking Whisper operation");
    }
    worker.join().expect("test runtime thread should join");

    assert!(
        unrelated_completed,
        "queued transcriptions must not occupy Tokio blocking threads"
    );
    assert_eq!(
        max_active_transcriptions.load(std::sync::atomic::Ordering::SeqCst),
        1,
        "only one Whisper inference may run at a time"
    );
}

#[test]
fn cancelling_queued_transcription_does_not_start_inference() {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .max_blocking_threads(1)
        .build()
        .expect("test runtime should build");
    runtime.block_on(async {
        let call_count = std::sync::Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let call_count_for_inference = std::sync::Arc::clone(&call_count);
        let first_started = std::sync::Arc::new(tokio::sync::Notify::new());
        let first_started_for_inference = std::sync::Arc::clone(&first_started);
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let release_rx = std::sync::Arc::new(std::sync::Mutex::new(release_rx));

        let (mut state, _temp_dir) = test_state("app_invoke_whisper_cancelled_admission");
        state.whisper = Some(std::sync::Arc::new(
            crate::whisper_manager::WhisperManager::with_transcription_override_for_test(
                crate::whisper_manager::WhisperModelSize::Small,
                move |_| {
                    call_count_for_inference.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    first_started_for_inference.notify_one();
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

        let first_state = std::sync::Arc::clone(&state);
        let first = tokio::spawn(async move {
            invoke(
                &first_state,
                "transcribe_audio",
                json!({ "audioPcmBase64": "AAAAAA==" }),
            )
            .await
        });
        first_started.notified().await;

        let queued_state = std::sync::Arc::clone(&state);
        let mut queued = Box::pin(async move {
            invoke(
                &queued_state,
                "transcribe_audio",
                json!({ "audioPcmBase64": "AAAAAA==" }),
            )
            .await
        });
        assert!(matches!(
            futures::poll!(&mut queued),
            std::task::Poll::Pending
        ));
        drop(queued);

        release_tx
            .send(())
            .expect("release active Whisper operation");
        first
            .await
            .expect("active transcription task should join")
            .expect("active transcription should succeed");
        release_tx
            .send(())
            .expect("allow incorrectly admitted work to finish");
        tokio::task::spawn_blocking(|| {})
            .await
            .expect("blocking work queued after cancellation should finish");

        assert_eq!(
            call_count.load(std::sync::atomic::Ordering::SeqCst),
            1,
            "cancelled queued request must not start Whisper inference"
        );
    });
}

#[tokio::test]
async fn downloads_model_publishes_progress_and_persists_path() {
    let (mut state, _temp_dir) = test_state("app_invoke_whisper_download");
    state.whisper = Some(std::sync::Arc::new(
        crate::whisper_manager::WhisperManager::with_download_override_for_test(
            crate::whisper_manager::WhisperModelSize::Small,
            |size, on_progress| {
                assert_eq!(size, crate::whisper_manager::WhisperModelSize::Tiny);
                on_progress(crate::whisper_manager::WhisperDownloadProgress {
                    model_size: "tiny".to_string(),
                    bytes_downloaded: 50,
                    total_bytes: 100,
                    percentage: 50.0,
                });
                Ok("/tmp/test-whisper-tiny.bin".to_string())
            },
        ),
    ));
    let mut events = state
        .app_event_tx
        .as_ref()
        .expect("app event sender")
        .subscribe();

    let response = invoke_ok(
        &state,
        "download_whisper_model",
        json!({ "modelSize": "tiny" }),
    )
    .await;

    assert_eq!(response, serde_json::Value::Null);
    let event = tokio::time::timeout(CONCURRENCY_TEST_TIMEOUT, events.recv())
        .await
        .expect("download progress event should arrive")
        .expect("download progress event should be published");
    assert_eq!(event.event_name, "whisper-download-progress");
    assert_eq!(event.payload["model_size"], "tiny");
    assert_eq!(event.payload["bytes_downloaded"], 50);
    assert_eq!(event.payload["total_bytes"], 100);
    assert_eq!(event.payload["percentage"], 50.0);
    let persisted_path = state
        .db
        .lock()
        .expect("db lock")
        .get_config("whisper_model_path")
        .expect("read persisted Whisper model path");
    assert_eq!(
        persisted_path.as_deref(),
        Some("/tmp/test-whisper-tiny.bin")
    );
}
