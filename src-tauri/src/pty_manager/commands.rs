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
    if let Some(mode) = permission_mode.filter(|mode| !mode.is_empty() && *mode != "default") {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    args.push("--settings".to_string());
    args.push(hooks_settings_path.to_string_lossy().to_string());
    args
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum PiSessionTarget {
    New(String),
    Existing(String),
    ContinueLatest,
}

pub(crate) fn build_pi_args(
    prompt: &str,
    session_target: &PiSessionTarget,
    extension_path: Option<&Path>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(path) = extension_path {
        args.push("-e".to_string());
        args.push(path.to_string_lossy().to_string());
    }
    args.push("--approve".to_string());
    match session_target {
        PiSessionTarget::New(session_id) => {
            args.push("--session-id".to_string());
            args.push(session_id.clone());
        }
        PiSessionTarget::Existing(session_id) => {
            args.push("--session".to_string());
            args.push(session_id.clone());
        }
        PiSessionTarget::ContinueLatest => args.push("--continue".to_string()),
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

pub(crate) fn build_grok_args(
    prompt: &str,
    resume_session_id: Option<&str>,
    continue_session: bool,
    permission_mode: Option<&str>,
    model: Option<&str>,
) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(id) = resume_session_id {
        args.push("--resume".to_string());
        args.push(id.to_string());
    } else if continue_session {
        args.push("--continue".to_string());
    }
    if let Some(mode) = permission_mode.filter(|m| !m.is_empty() && *m != "default") {
        args.push("--permission-mode".to_string());
        args.push(mode.to_string());
    }
    if let Some(model) = model.filter(|m| !m.is_empty()) {
        args.push("--model".to_string());
        args.push(model.to_string());
    }
    // The prompt is appended LAST as a bare positional (`grok [OPTIONS] [PROMPT]`).
    // This must never be emitted right after a bare `--resume` — clap treats
    // `-r/--resume`'s value as optional, so a bare `--resume` followed by a
    // positional would swallow the prompt as the session id. We only ever emit
    // `--resume <id>` (always with a value) or `--continue` (a flag with no
    // value), so a trailing prompt can never be misparsed as a resume value.
    //
    // We also guard the positional itself with a bare `--` immediately before
    // it, but ONLY when a prompt is actually appended (an empty prompt must
    // never leave a dangling `--`). Without this, a prompt that happens to
    // start with a dash (e.g. "-p summarize this") is parsed by grok's clap
    // as options instead of the positional prompt — `-p` in particular flips
    // grok into headless single-turn mode instead of the interactive session,
    // and other leading-dash prompts abort with "unexpected argument". `--`
    // is clap's standard end-of-options marker, so everything after it is
    // always treated as the positional prompt.
    if !prompt.is_empty() {
        args.push("--".to_string());
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
    fn build_pi_args_assigns_id_to_new_agent_session() {
        assert_eq!(
            build_pi_args(
                "implement the feature",
                &PiSessionTarget::New("openforge-pi-session-1".to_string()),
                Some(Path::new("/tmp/openforge-pi-extension.ts")),
            ),
            vec![
                "-e",
                "/tmp/openforge-pi-extension.ts",
                "--approve",
                "--session-id",
                "openforge-pi-session-1",
                "implement the feature",
            ]
        );
    }

    #[test]
    fn build_pi_args_trusts_project_for_resumed_session_and_preserves_ordering() {
        assert_eq!(
            build_pi_args(
                "continue work",
                &PiSessionTarget::Existing("pi-session-1".to_string()),
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
            build_pi_args("", &PiSessionTarget::ContinueLatest, None),
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

    #[test]
    fn grok_args_fresh_session_with_permission_mode() {
        assert_eq!(
            build_grok_args(
                "implement the feature",
                None,
                false,
                Some("acceptEdits"),
                None
            ),
            vec![
                "--permission-mode",
                "acceptEdits",
                "--",
                "implement the feature",
            ]
        );
    }

    #[test]
    fn grok_args_empty_prompt_is_omitted() {
        assert_eq!(
            build_grok_args("", None, false, None, None),
            Vec::<String>::new()
        );
    }

    #[test]
    fn grok_args_resume_by_id_ignores_default_mode() {
        assert_eq!(
            build_grok_args(
                "continue work",
                Some("grok-session-1"),
                false,
                Some("default"),
                None
            ),
            vec!["--resume", "grok-session-1", "--", "continue work"]
        );
    }

    #[test]
    fn grok_args_resume_prompt_ordering_is_resume_then_double_dash_then_prompt() {
        // Regression guard for the clap hazard: `-r/--resume` takes an OPTIONAL
        // value, so a bare `--resume` immediately followed by a positional would
        // swallow the prompt as the session id. Assert the exact ordering.
        assert_eq!(
            build_grok_args("fix the bug", Some("grok-session-9"), false, None, None),
            vec!["--resume", "grok-session-9", "--", "fix the bug"]
        );
    }

    #[test]
    fn grok_args_continue_without_prompt() {
        assert_eq!(
            build_grok_args("", None, true, None, None),
            vec!["--continue"]
        );
    }

    #[test]
    fn grok_args_continue_with_prompt() {
        assert_eq!(
            build_grok_args("keep going", None, true, None, None),
            vec!["--continue", "--", "keep going"]
        );
    }

    #[test]
    fn grok_args_include_model_when_present() {
        assert_eq!(
            build_grok_args("", None, false, None, Some("grok-build")),
            vec!["--model", "grok-build"]
        );
    }

    #[test]
    fn grok_args_permission_mode_and_model_emitted_before_double_dash_and_prompt() {
        assert_eq!(
            build_grok_args(
                "implement the feature",
                None,
                false,
                Some("acceptEdits"),
                Some("grok-build")
            ),
            vec![
                "--permission-mode",
                "acceptEdits",
                "--model",
                "grok-build",
                "--",
                "implement the feature",
            ]
        );
    }

    // ------------------------------------------------------------------
    // Fix 1 regression guards: a prompt beginning with a dash must never be
    // parsed by grok's clap as flags/options.
    // ------------------------------------------------------------------

    #[test]
    fn grok_args_prompt_starting_with_dash_is_guarded_by_double_dash() {
        assert_eq!(
            build_grok_args("-p summarize this", None, false, None, None),
            vec!["--", "-p summarize this"]
        );
    }

    #[test]
    fn grok_args_normal_prompt_is_guarded_by_double_dash() {
        assert_eq!(
            build_grok_args("fix the bug", None, false, None, None),
            vec!["--", "fix the bug"]
        );
    }

    #[test]
    fn grok_args_empty_prompt_emits_no_trailing_double_dash() {
        let args = build_grok_args("", None, false, None, None);
        assert!(
            !args.contains(&"--".to_string()),
            "empty prompt must not leave a dangling -- guard: {args:?}"
        );
    }

    #[test]
    fn grok_args_resume_with_prompt_is_resume_id_then_double_dash_then_prompt() {
        assert_eq!(
            build_grok_args("fix the bug", Some("grok-session-1"), false, None, None),
            vec!["--resume", "grok-session-1", "--", "fix the bug"]
        );
    }
}
