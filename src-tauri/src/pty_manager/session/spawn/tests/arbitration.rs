use super::*;

#[tokio::test]
async fn agent_spawn_arbitration_keeps_the_newest_generation_current() {
    let manager = PtyManager::new();
    let task_id = "stage-arbitration";
    let (older, older_lock) = manager.begin_agent_spawn(task_id, "Test").await;
    let (newer, newer_lock) = manager.begin_agent_spawn(task_id, "Test").await;

    assert!(manager.finish_agent_spawn(task_id, older).await.is_err());
    assert_eq!(
        manager.agent_spawn_generations.lock().await.get(task_id),
        Some(&newer.generation)
    );

    manager
        .finish_agent_spawn(task_id, newer)
        .await
        .expect("newest generation should complete arbitration");
    assert!(!manager
        .agent_spawn_generations
        .lock()
        .await
        .contains_key(task_id));

    drop(older_lock);
    drop(newer_lock);
}
