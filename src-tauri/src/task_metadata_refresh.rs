use once_cell::sync::Lazy;
use regex::Regex;

macro_rules! info {
    ($($arg:tt)*) => {{
        $crate::task_metadata_refresh::emit_task_metadata_refresh_diagnostic_stdout(format_args!($($arg)*))
    }};
}

macro_rules! warn {
    ($($arg:tt)*) => {{
        $crate::task_metadata_refresh::emit_task_metadata_refresh_diagnostic_stderr(format_args!($($arg)*))
    }};
}

macro_rules! debug {
    ($($arg:tt)*) => {{
        if $crate::task_metadata_refresh::task_metadata_refresh_debug_enabled() {
            $crate::task_metadata_refresh::emit_task_metadata_refresh_diagnostic_stdout(format_args!($($arg)*))
        }
    }};
}

mod prompt;
mod providers;
mod refresh;

fn task_metadata_refresh_debug_enabled_from_env(value: Option<&str>) -> bool {
    value
        .map(str::trim)
        .map(|value| {
            matches!(
                value,
                "1" | "true" | "TRUE" | "debug" | "DEBUG" | "trace" | "TRACE"
            )
        })
        .unwrap_or(false)
}

fn task_metadata_refresh_debug_enabled() -> bool {
    task_metadata_refresh_debug_enabled_from_env(
        std::env::var("OPENFORGE_TASK_METADATA_REFRESH_LOG")
            .ok()
            .as_deref(),
    )
}

static SENSITIVE_KEY_VALUE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)\b(prompt|transcript|stdout|stderr|body|title|generated_title|repo|repository|owner|path|url|token|authorization)=(("[^"]*")|('[^']*')|([^\s,;)]*))"#,
    )
    .expect("sensitive key-value regex should compile")
});

static ABSOLUTE_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"/(?:[A-Za-z0-9._ -]+/)+[A-Za-z0-9._ -]+"#)
        .expect("absolute path regex should compile")
});

static GITHUB_API_URL_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"https://api\.github\.com/[^\s,;)'\"]+"#)
        .expect("GitHub API URL regex should compile")
});

static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)\b(?:gh[opsur]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]+)"#)
        .expect("token regex should compile")
});

fn redact_task_metadata_refresh_diagnostic(message: &str) -> String {
    let redacted = SENSITIVE_KEY_VALUE_RE.replace_all(message, "$1=<redacted>");
    let redacted = GITHUB_API_URL_RE.replace_all(&redacted, "<redacted>");
    let redacted = TOKEN_RE.replace_all(&redacted, "<redacted>");
    ABSOLUTE_PATH_RE
        .replace_all(&redacted, "<redacted>")
        .to_string()
}

fn format_task_metadata_refresh_diagnostic(message: std::fmt::Arguments<'_>) -> String {
    redact_task_metadata_refresh_diagnostic(&message.to_string())
}

fn emit_task_metadata_refresh_diagnostic_stdout(message: std::fmt::Arguments<'_>) {
    println!("{}", format_task_metadata_refresh_diagnostic(message));
}

fn emit_task_metadata_refresh_diagnostic_stderr(message: std::fmt::Arguments<'_>) {
    eprintln!("{}", format_task_metadata_refresh_diagnostic(message));
}

#[cfg(test)]
mod tests;

pub(crate) use refresh::refresh_task_display_title_with_ai_once;
