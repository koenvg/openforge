use super::*;

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
