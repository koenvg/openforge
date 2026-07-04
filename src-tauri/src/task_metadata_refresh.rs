mod prompt;
mod providers;
mod refresh;

#[cfg(test)]
fn format_task_metadata_refresh_diagnostic(message: std::fmt::Arguments<'_>) -> String {
    crate::sidecar_logger::sanitize_log_message(&message.to_string())
}

#[cfg(test)]
mod tests;

pub(crate) use refresh::refresh_task_display_title_with_ai_once;
