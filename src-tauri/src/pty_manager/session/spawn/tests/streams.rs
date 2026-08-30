use super::*;

#[tokio::test]
async fn stale_agent_stream_registration_removes_its_last_output_tracking() {
    let manager = PtyManager::new();
    let task_id = "stale-stream-registration";
    let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
    let _ = manager.begin_agent_spawn(task_id, "Newer").await;
    let stale_state = AgentStreamState::new(1, true);
    let stale_last_output = Arc::clone(
        stale_state
            .last_output_time
            .as_ref()
            .expect("tracked state should have last-output time"),
    );
    manager
        .last_output
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&stale_last_output));

    let result = manager
        .register_agent_stream_state(task_id, stale_token, 1, &stale_state)
        .await;

    assert!(result.is_err());
    assert!(
        !manager.last_output.lock().await.contains_key(task_id),
        "superseded stream registration should remove its last-output tracking"
    );
}

#[tokio::test]
async fn stale_agent_stream_registration_preserves_newer_last_output_tracking() {
    let manager = PtyManager::new();
    let task_id = "newer-stream-registration";
    let (stale_token, _) = manager.begin_agent_spawn(task_id, "Stale").await;
    let _ = manager.begin_agent_spawn(task_id, "Newer").await;
    let newer_last_output = Arc::new(AtomicU64::new(0));
    manager
        .last_output
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&newer_last_output));

    let stale_state = AgentStreamState::new(1, true);
    let result = manager
        .register_agent_stream_state(task_id, stale_token, 1, &stale_state)
        .await;

    assert!(result.is_err());
    assert!(
        manager
            .last_output
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &newer_last_output)),
        "superseded stream registration should preserve newer last-output tracking"
    );
}

#[tokio::test]
async fn output_buffer_cleanup_removes_own_registration_and_preserves_replacement() {
    let manager = PtyManager::new();
    let task_id = "output-buffer-cleanup";
    let registered = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    manager
        .output_buffers
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&registered));

    manager
        .remove_output_buffer_if_registered(task_id, &registered)
        .await;
    assert!(!manager.output_buffers.lock().await.contains_key(task_id));

    let replacement = Arc::new(std::sync::Mutex::new(RingBuffer::new(64)));
    manager
        .output_buffers
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&replacement));

    manager
        .remove_output_buffer_if_registered(task_id, &registered)
        .await;
    assert!(
        manager
            .output_buffers
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &replacement)),
        "stale cleanup must preserve the replacement output buffer"
    );
}

#[tokio::test]
async fn attachment_hub_cleanup_removes_own_registration_and_preserves_replacement() {
    let manager = PtyManager::new();
    let task_id = "attachment-hub-cleanup";
    let registered = Arc::new(PtyAttachmentHub::new(1, 64, 4));
    manager
        .attachment_hubs
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&registered));

    manager
        .remove_attachment_hub_if_registered(task_id, &registered)
        .await;
    assert!(!manager.attachment_hubs.lock().await.contains_key(task_id));

    let replacement = Arc::new(PtyAttachmentHub::new(2, 64, 4));
    manager
        .attachment_hubs
        .lock()
        .await
        .insert(task_id.to_string(), Arc::clone(&replacement));

    manager
        .remove_attachment_hub_if_registered(task_id, &registered)
        .await;
    assert!(
        manager
            .attachment_hubs
            .lock()
            .await
            .get(task_id)
            .is_some_and(|stored| Arc::ptr_eq(stored, &replacement)),
        "stale cleanup must preserve the replacement attachment hub"
    );
}
