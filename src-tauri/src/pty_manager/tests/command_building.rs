use super::*;

#[test]
fn test_build_claude_args_new_session() {
    let settings = Path::new("/home/user/.openforge/claude-hooks-settings.json");
    let args = build_claude_args("implement the feature", None, false, settings, None);
    assert_eq!(
        args,
        vec![
            "implement the feature",
            "--settings",
            "/home/user/.openforge/claude-hooks-settings.json",
        ]
    );
}

#[test]
fn test_build_claude_args_resume_session_with_prompt() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("continue work", Some("sess-abc-123"), false, settings, None);
    assert_eq!(
        args,
        vec![
            "--resume",
            "sess-abc-123",
            "continue work",
            "--settings",
            "/path/to/settings.json",
        ]
    );
}

#[test]
fn test_build_claude_args_resume_session_without_prompt() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("", Some("sess-abc-123"), false, settings, None);
    assert_eq!(
        args,
        vec![
            "--resume",
            "sess-abc-123",
            "--settings",
            "/path/to/settings.json",
        ]
    );
}

#[test]
fn test_build_claude_args_continue_session() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("", None, true, settings, None);
    assert_eq!(
        args,
        vec!["--continue", "--settings", "/path/to/settings.json",]
    );
}

#[test]
fn test_build_claude_args_resume_takes_precedence_over_continue() {
    let settings = Path::new("/path/to/settings.json");
    // When both resume_session_id and continue_session are set, --resume wins
    let args = build_claude_args("", Some("sess-123"), true, settings, None);
    assert!(args.contains(&"--resume".to_string()));
    assert!(!args.contains(&"--continue".to_string()));
}

#[test]
fn test_build_claude_args_settings_always_present() {
    let settings = Path::new("/config/hooks.json");
    let args_new = build_claude_args("prompt", None, false, settings, None);
    let args_resume = build_claude_args("prompt", Some("sid"), false, settings, None);
    let args_continue = build_claude_args("", None, true, settings, None);

    assert!(args_new.contains(&"--settings".to_string()));
    assert!(args_resume.contains(&"--settings".to_string()));
    assert!(args_continue.contains(&"--settings".to_string()));
}

#[test]
fn test_build_claude_args_no_headless_flags() {
    let settings = Path::new("/config/hooks.json");
    let args = build_claude_args("prompt", None, false, settings, None);

    assert!(!args.contains(&"-p".to_string()));
    assert!(!args.contains(&"--output-format".to_string()));
    assert!(!args.contains(&"--input-format".to_string()));
}

#[test]
fn test_build_claude_args_resume_flag_before_prompt() {
    let settings = Path::new("/config/hooks.json");
    let args = build_claude_args("my prompt", Some("session-xyz"), false, settings, None);

    let resume_pos = args.iter().position(|a| a == "--resume").unwrap();
    let session_pos = args.iter().position(|a| a == "session-xyz").unwrap();
    let prompt_pos = args.iter().position(|a| a == "my prompt").unwrap();

    assert_eq!(session_pos, resume_pos + 1);
    assert!(prompt_pos > session_pos);
}

#[test]
fn test_claude_pty_args_with_real_hooks_path() {
    let temp_dir = std::env::temp_dir().join("test_pty_args_real_hooks_home");
    let _ = std::fs::remove_dir_all(&temp_dir);
    std::fs::create_dir_all(&temp_dir).unwrap();

    let temp_path = crate::claude_hooks::generate_hooks_settings_for_home(&temp_dir, 17422)
        .expect("generate_hooks_settings should succeed");

    let args_new = build_claude_args("fix the bug", None, false, &temp_path, None);
    assert_eq!(args_new[0], "fix the bug");
    let s_idx = args_new.iter().position(|a| a == "--settings").unwrap();
    assert_eq!(args_new[s_idx + 1], temp_path.to_string_lossy().to_string());
    assert!(!args_new.contains(&"-p".to_string()));

    let args_resume = build_claude_args(
        "continue impl",
        Some("resume-sess-999"),
        false,
        &temp_path,
        None,
    );
    assert_eq!(args_resume[0], "--resume");
    assert_eq!(args_resume[1], "resume-sess-999");
    assert_eq!(args_resume[2], "continue impl");
    let s_idx_r = args_resume.iter().position(|a| a == "--settings").unwrap();
    assert_eq!(
        args_resume[s_idx_r + 1],
        temp_path.to_string_lossy().to_string()
    );

    let content = std::fs::read_to_string(&temp_path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert!(parsed.get("hooks").is_some());

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_get_shell_path_uses_env_without_mutating_process_env() {
    let shell = resolve_shell_path(Some("/usr/bin/env"), ["/bin/zsh", "/bin/bash", "/bin/sh"]);
    assert_eq!(
        shell, "/usr/bin/env",
        "should prefer the supplied SHELL value when set"
    );
}

#[test]
fn test_get_shell_path_falls_back_to_existing_candidate() {
    let temp_dir = tempfile::tempdir().expect("tempdir should succeed");
    let missing_shell = temp_dir.path().join("missing-shell");
    let existing_shell = temp_dir.path().join("existing-shell");
    std::fs::write(&existing_shell, "#!/bin/sh\n").expect("shell fixture should write");

    let shell = resolve_shell_path(
        None,
        [
            missing_shell.to_string_lossy().as_ref(),
            existing_shell.to_string_lossy().as_ref(),
        ],
    );

    assert_eq!(shell, existing_shell.to_string_lossy());
}

#[test]
fn test_build_claude_args_with_permission_mode() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("my prompt", None, false, settings, Some("plan"));

    let pm_pos = args
        .iter()
        .position(|a| a == "--permission-mode")
        .expect("--permission-mode flag should be present");
    assert_eq!(args[pm_pos + 1], "plan");

    let settings_pos = args.iter().position(|a| a == "--settings").unwrap();
    assert!(
        pm_pos < settings_pos,
        "--permission-mode should appear before --settings"
    );
}

#[test]
fn test_build_claude_args_without_permission_mode() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("my prompt", None, false, settings, None);

    assert!(
        !args.contains(&"--permission-mode".to_string()),
        "--permission-mode should not be present when None"
    );
}

#[test]
fn test_build_claude_args_omits_default_permission_mode() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("my prompt", None, false, settings, Some("default"));

    assert!(
        !args.contains(&"--permission-mode".to_string()),
        "OpenForge default should defer to Claude's configured default"
    );
}

#[test]
fn test_build_claude_args_accepts_auto_permission_mode() {
    let settings = Path::new("/path/to/settings.json");
    let args = build_claude_args("my prompt", None, false, settings, Some("auto"));

    let pm_pos = args
        .iter()
        .position(|a| a == "--permission-mode")
        .expect("--permission-mode flag should be present");
    assert_eq!(args[pm_pos + 1], "auto");
}
