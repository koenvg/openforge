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

fn format_task_metadata_refresh_diagnostic(message: std::fmt::Arguments<'_>) -> String {
    message.to_string()
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
