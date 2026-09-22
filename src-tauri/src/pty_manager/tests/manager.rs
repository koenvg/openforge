use super::*;

#[test]
fn test_pty_error_display() {
    let err = PtyError::InvalidWorkspaceCwd {
        path: "/missing/workspace".to_string(),
        reason: "No such file or directory".to_string(),
    };
    assert_eq!(
        err.to_string(),
        "workspace cwd '/missing/workspace' is not accessible: No such file or directory"
    );

    let err = PtyError::SpawnFailed("test error".to_string());
    assert_eq!(err.to_string(), "Failed to spawn PTY: test error");

    let err = PtyError::ProcessNotFound("task123".to_string());
    assert_eq!(err.to_string(), "No PTY process found for task: task123");

    let err = PtyError::WriteFailed("write error".to_string());
    assert_eq!(err.to_string(), "Failed to write to PTY: write error");
}

#[test]
fn test_pty_manager_new() {
    let manager = PtyManager::new();
    assert!(manager.sessions.try_lock().is_ok());
}

#[test]
fn test_user_environment_helper_has_fallbacks() {
    let env = user_environment();
    // Should at least have fallback values
    assert!(env.contains_key("PATH"));
    assert!(env.contains_key("LANG"));
}

#[test]
fn terminal_environment_keeps_image_capability_unset_by_default() {
    assert_eq!(
        terminal_environment(None),
        vec![
            ("TERM", "xterm-256color"),
            ("COLORTERM", "truecolor"),
            ("TERM_PROGRAM", "vscode"),
        ]
    );
}

#[test]
fn terminal_environment_advertises_iterm_only_when_requested() {
    assert_eq!(
        terminal_environment(Some(TerminalImageProtocol::Iterm2)),
        vec![
            ("TERM", "xterm-256color"),
            ("COLORTERM", "truecolor"),
            ("TERM_PROGRAM", "vscode"),
            ("ITERM_SESSION_ID", "openforge"),
        ]
    );
}

#[test]
fn terminal_environment_removes_no_color() {
    let mut environment = std::collections::BTreeMap::from([
        ("NO_COLOR".to_string(), "1".to_string()),
        ("OPENFORGE_TEST".to_string(), "preserved".to_string()),
    ]);

    configure_terminal_environment(&mut environment, None);

    assert!(!environment.contains_key("NO_COLOR"));
    assert_eq!(
        environment.get("OPENFORGE_TEST").map(String::as_str),
        Some("preserved")
    );
    assert_eq!(
        environment.get("COLORTERM").map(String::as_str),
        Some("truecolor")
    );
}
