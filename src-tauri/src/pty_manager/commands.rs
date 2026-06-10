use std::path::Path;

// ============================================================================
// Claude Command Builder
// ============================================================================

pub(crate) fn build_claude_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
    hooks_settings_path: &Path,
    permission_mode: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(session_id) = resume_session_id {
        args.push("--resume".to_string());
        args.push(session_id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    }
    if !prompt.is_empty() {
        args.push(prompt.to_string());
    }
    if let Some(mode) = permission_mode {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    args.push("--settings".to_string());
    args.push(hooks_settings_path.to_string_lossy().to_string());
    args
}

pub(crate) fn build_pi_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
    extension_path: Option<&Path>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(path) = extension_path {
        args.push("-e".to_string());
        args.push(path.to_string_lossy().to_string());
    }
    args.push("--approve".to_string());
    if let Some(session_id) = resume_session_id {
        args.push("--session".to_string());
        args.push(session_id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    }
    if !prompt.is_empty() {
        args.push(prompt.to_string());
    }
    args
}

pub(crate) fn build_opencode_tui_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
    agent: Option<&str>,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(session_id) = resume_session_id {
        args.push("--session".to_string());
        args.push(session_id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    }
    if let Some(agent) = agent.filter(|value| !value.is_empty()) {
        args.push("--agent".to_string());
        args.push(agent.to_string());
    }
    if let Some(model) = model.filter(|value| !value.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    if !prompt.is_empty() {
        args.push("--prompt".to_string());
        args.push(prompt.to_string());
    }
    args
}

pub(crate) fn build_codex_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(session_id) = resume_session_id {
        args.push("resume".to_string());
        args.push(session_id.to_string());
    } else if continue_session {
        args.push("resume".to_string());
        args.push("--last".to_string());
    }
    if !prompt.is_empty() {
        args.push(prompt.to_string());
    }
    args
}

pub(super) fn resolve_shell_path<'a>(
    shell: Option<&str>,
    candidates: impl IntoIterator<Item = &'a str>,
) -> String {
    if let Some(shell) = shell.filter(|value| !value.is_empty()) {
        return shell.to_string();
    }

    for candidate in candidates {
        if std::path::Path::new(candidate).exists() {
            return candidate.to_string();
        }
    }

    "/bin/sh".to_string()
}

pub(crate) fn get_shell_path() -> String {
    let shell = std::env::var("SHELL").ok();
    resolve_shell_path(shell.as_deref(), ["/bin/zsh", "/bin/bash", "/bin/sh"])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_pi_args_trusts_project_for_new_session_without_persisting_decision() {
        assert_eq!(
            build_pi_args(
                "implement the feature",
                None,
                false,
                Some(Path::new("/tmp/openforge-pi-extension.ts")),
            ),
            vec![
                "-e",
                "/tmp/openforge-pi-extension.ts",
                "--approve",
                "implement the feature",
            ]
        );
    }

    #[test]
    fn build_pi_args_trusts_project_for_resumed_session_and_preserves_ordering() {
        assert_eq!(
            build_pi_args(
                "continue work",
                Some("pi-session-1"),
                false,
                Some(Path::new("/tmp/openforge-pi-extension.ts")),
            ),
            vec![
                "-e",
                "/tmp/openforge-pi-extension.ts",
                "--approve",
                "--session",
                "pi-session-1",
                "continue work",
            ]
        );
    }

    #[test]
    fn build_pi_args_trusts_project_for_continue_session_without_prompt() {
        assert_eq!(
            build_pi_args("", None, true, None),
            vec!["--approve", "--continue"]
        );
    }

    #[test]
    fn opencode_tui_args_use_prompt_without_attaching_to_openforge_server() {
        assert_eq!(
            build_opencode_tui_args(
                "fix the bug",
                Some("oc-session-1"),
                false,
                Some("build"),
                Some("anthropic/claude-sonnet-4"),
            ),
            vec![
                "--session",
                "oc-session-1",
                "--agent",
                "build",
                "--model",
                "anthropic/claude-sonnet-4",
                "--prompt",
                "fix the bug",
            ]
        );
    }

    #[test]
    fn opencode_tui_args_continue_without_prompt_for_explicit_continue() {
        assert_eq!(
            build_opencode_tui_args("", None, true, None, None),
            vec!["--continue"]
        );
    }

    #[test]
    fn codex_args_start_interactive_session_with_prompt() {
        assert_eq!(
            build_codex_args("implement the feature", None, false),
            vec!["implement the feature"]
        );
    }

    #[test]
    fn codex_args_resume_session_with_prompt() {
        assert_eq!(
            build_codex_args("continue work", Some("codex-session-1"), false),
            vec!["resume", "codex-session-1", "continue work"]
        );
    }

    #[test]
    fn codex_args_continue_last_session_without_prompt() {
        assert_eq!(build_codex_args("", None, true), vec!["resume", "--last"]);
    }
}
