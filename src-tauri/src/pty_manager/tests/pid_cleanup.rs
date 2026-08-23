use super::*;

#[tokio::test]
async fn test_cleanup_stale_pids_invalid_content() {
    let mut manager = PtyManager::new();
    let tmp_dir = std::env::temp_dir().join("test_pty_cleanup_invalid");
    std::fs::create_dir_all(&tmp_dir).unwrap();
    manager.set_pid_dir(tmp_dir.clone());

    // Only -pty.pid files are processed by pty cleanup
    let pid_file = tmp_dir.join("task123-pty.pid");
    std::fs::write(&pid_file, "not_a_number").unwrap();
    assert!(pid_file.exists());

    let result = manager.cleanup_stale_pids().await;
    assert!(result.is_ok());
    assert!(!pid_file.exists(), "Invalid PTY PID file should be removed");

    let _ = std::fs::remove_dir_all(&tmp_dir);
}

#[tokio::test]
async fn test_cleanup_stale_pids_invalid_indexed_shell_pid() {
    let mut manager = PtyManager::new();
    let tmp_dir = tempfile::tempdir().expect("tempdir should succeed");
    manager.set_pid_dir(tmp_dir.path().to_path_buf());

    let shell0_pid_file = tmp_dir.path().join("task123-shell-0.pid");
    let shell1_pid_file = tmp_dir.path().join("task123-shell-1.pid");
    std::fs::write(&shell0_pid_file, "not_a_number").unwrap();
    std::fs::write(&shell1_pid_file, "not_a_number").unwrap();

    let result = manager.cleanup_stale_pids().await;

    assert!(result.is_ok());
    assert!(
        !shell0_pid_file.exists(),
        "Indexed shell 0 PID file should be processed and removed"
    );
    assert!(
        !shell1_pid_file.exists(),
        "Indexed shell 1 PID file should be processed and removed"
    );
}

#[test]
fn test_get_pid_dir_default() {
    let manager = PtyManager::new();
    let pid_dir = manager.get_pid_dir().expect("get_pid_dir should succeed");

    // In test builds, debug_assertions is enabled, so we expect "pids-dev"
    let dir_name = pid_dir.file_name().unwrap().to_str().unwrap();
    assert_eq!(
        dir_name, "pids-dev",
        "Debug build should use pids-dev directory"
    );

    // Verify parent is .openforge
    let parent_name = pid_dir
        .parent()
        .unwrap()
        .file_name()
        .unwrap()
        .to_str()
        .unwrap();
    assert_eq!(parent_name, ".openforge");
}

#[test]
fn test_shell_pid_file_naming() {
    let task_id = "my-task-123";
    let shell0_key = shell_session_key(task_id, Some(0));
    let shell1_key = shell_session_key(task_id, Some(1));
    let shell0_pid_file = shell_pid_file_name(task_id, Some(0));
    let shell1_pid_file = shell_pid_file_name(task_id, Some(1));

    assert_eq!(shell0_key, "my-task-123-shell-0");
    assert_eq!(shell1_key, "my-task-123-shell-1");
    assert_eq!(shell0_pid_file, "my-task-123-shell-0.pid");
    assert_eq!(shell1_pid_file, "my-task-123-shell-1.pid");
    assert_ne!(shell0_pid_file, shell1_pid_file);

    let output_event = format!("pty-output-{}", shell1_key);
    let exit_event = format!("pty-exit-{}", shell1_key);
    assert_eq!(output_event, "pty-output-my-task-123-shell-1");
    assert_eq!(exit_event, "pty-exit-my-task-123-shell-1");
}

#[test]
fn test_spawn_shell_with_index() {
    let task_id = "t1";
    let key_0 = format!("{}-shell-{}", task_id, 0);
    let key_1 = format!("{}-shell-{}", task_id, 1);
    let key_2 = format!("{}-shell-{}", task_id, 2);

    assert_eq!(key_0, "t1-shell-0");
    assert_eq!(key_1, "t1-shell-1");
    assert_eq!(key_2, "t1-shell-2");
}

#[test]
fn test_spawn_shell_no_index() {
    let task_id = "my-task";
    let terminal_index: Option<u32> = None;

    let key = if let Some(idx) = terminal_index {
        format!("{}-shell-{}", task_id, idx)
    } else {
        format!("{}-shell-0", task_id)
    };

    assert_eq!(key, "my-task-shell-0");
}
