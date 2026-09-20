use super::*;

#[tokio::test]
async fn saturated_signal_queue_is_nonblocking_and_keeps_at_most_256_candidates() {
    let f = Fixture::new(true, Some("test-token")).await;
    f.output(42);
    f.calls(1).await;
    for number in 1000..1400 {
        f.output(number);
    }
    assert_eq!(
        f.api.calls.lock().unwrap().len(),
        1,
        "output does not await slow GitHub"
    );
    f.api.gate.add_permits(500);
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 256);
}

#[tokio::test]
async fn queued_task_identities_are_bounded_to_128_and_share_request_capacity() {
    let f = Fixture::new(true, Some("test-token")).await;
    f.output(42);
    f.calls(1).await;
    for i in 0..150 {
        let task = acquire_db(&f.db)
            .create_task("queued", "doing", Some(&f.project_id), None, None)
            .unwrap();
        let path = f.dir.path().to_str().unwrap();
        acquire_db(&f.db)
            .create_task_workspace_record(
                &task.id,
                &f.project_id,
                path,
                path,
                "worktree",
                Some("task-branch"),
                "pi",
            )
            .unwrap();
        let key = format!("shell-{i}");
        f.local.register(&key, &task.id, f.dir.path().into(), i + 2);
        f.local
            .observer(&key, i + 2)
            .unwrap()
            .output("https://github.com/acme/widgets/pull/42\n");
    }
    assert_eq!(
        f.api.calls.lock().unwrap().len(),
        1,
        "shared client capacity serializes requests"
    );
    f.api.gate.add_permits(200);
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 128);
}
