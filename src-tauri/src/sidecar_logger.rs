use log::{Level, LevelFilter, Log, Metadata, Record};
use once_cell::sync::{Lazy, OnceCell};
use regex::Regex;
use std::io::Write;

const DEFAULT_LOG_LEVEL: LevelFilter = LevelFilter::Info;
const LOG_LEVEL_ENV_KEYS: [&str; 3] =
    ["OPENFORGE_RUST_LOG", "OPENFORGE_RUST_LOG_LEVEL", "RUST_LOG"];

static LOGGER: SafeSidecarLogger = SafeSidecarLogger;
static LOGGER_INSTALL_RESULT: OnceCell<Result<(), String>> = OnceCell::new();

static SENSITIVE_KEY_VALUE_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(
        r#"(?i)\b([A-Za-z0-9_-]*(?:prompt|transcript|stdout|stderr|body|title|repo|repository|owner|path|url|token|authorization|secret|password|api[_-]?key)[A-Za-z0-9_-]*)\s*[:=]\s*((bearer\s+[^\s,;)]+)|(\"[^\"]*\")|('[^']*')|([^\s,;)]*))"#,
    )
    .expect("sensitive key-value regex should compile")
});

static HTTP_URL_RE: Lazy<Regex> =
    Lazy::new(|| Regex::new(r#"https?://[^\s,;)'"]+"#).expect("HTTP URL regex should compile"));

static TOKEN_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"(?i)\b(?:gh[opsur]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|bearer\s+[A-Za-z0-9._~+/=-]+|sk-[A-Za-z0-9_-]+)"#)
        .expect("token regex should compile")
});

static GITHUB_REPO_REF_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"\b[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\s+#\d+)?\b"#)
        .expect("GitHub repository reference regex should compile")
});

static UNIX_ABSOLUTE_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"/(?:[A-Za-z0-9._~+@%=-]+|[A-Za-z0-9._~+@%=-][A-Za-z0-9._ ~+@%=-]*[A-Za-z0-9._~+@%=-])(?:/(?:[A-Za-z0-9._~+@%=-]+|[A-Za-z0-9._~+@%=-][A-Za-z0-9._ ~+@%=-]*[A-Za-z0-9._~+@%=-]))+"#)
        .expect("absolute Unix path regex should compile")
});

static WINDOWS_ABSOLUTE_PATH_RE: Lazy<Regex> = Lazy::new(|| {
    Regex::new(r#"[A-Za-z]:\\(?:[^\s,;)'"]+\\)*[^\s,;)'"]+"#)
        .expect("absolute Windows path regex should compile")
});

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LogStream {
    Stdout,
    Stderr,
}

struct SafeSidecarLogger;

impl Log for SafeSidecarLogger {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.level() <= log::max_level()
    }

    fn log(&self, record: &Record<'_>) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let module = record.module_path().unwrap_or_else(|| record.target());
        let line = format_log_line(record.level(), module, &record.args().to_string());
        match log_stream_for_level(record.level()) {
            LogStream::Stdout => {
                let mut stdout = std::io::stdout().lock();
                let _ = writeln!(stdout, "{line}");
            }
            LogStream::Stderr => {
                let mut stderr = std::io::stderr().lock();
                let _ = writeln!(stderr, "{line}");
            }
        }
    }

    fn flush(&self) {}
}

pub(crate) fn initialize_electron_sidecar_logger() -> Result<(), String> {
    let level = configured_level_filter();
    let install_result = LOGGER_INSTALL_RESULT
        .get_or_init(|| log::set_logger(&LOGGER).map_err(|error| error.to_string()))
        .clone();
    log::set_max_level(level);
    install_result
}

fn configured_level_filter() -> LevelFilter {
    for key in LOG_LEVEL_ENV_KEYS {
        if let Ok(value) = std::env::var(key) {
            if let Some(level) = parse_level_filter_directive(&value) {
                return level;
            }
        }
    }
    DEFAULT_LOG_LEVEL
}

#[cfg(test)]
pub(crate) fn level_filter_from_env_value(value: Option<&str>) -> LevelFilter {
    value
        .and_then(parse_level_filter_directive)
        .unwrap_or(DEFAULT_LOG_LEVEL)
}

fn parse_level_filter_directive(value: &str) -> Option<LevelFilter> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut targetless_level = None;
    for directive in trimmed.split(',') {
        let directive = directive.trim();
        if directive.is_empty() {
            continue;
        }

        let (target, level) = match directive.split_once('=') {
            Some((target, level)) => (Some(target.trim()), level.trim()),
            None => (None, directive),
        };
        let Some(parsed) = parse_level_filter(level) else {
            continue;
        };

        match target {
            Some("openforge") => return Some(parsed),
            Some(target) if target.starts_with("openforge::") => return Some(parsed),
            Some(_) => {}
            None if targetless_level.is_none() => targetless_level = Some(parsed),
            None => {}
        }
    }

    targetless_level
}

fn parse_level_filter(value: &str) -> Option<LevelFilter> {
    match value.trim().to_ascii_lowercase().as_str() {
        "off" => Some(LevelFilter::Off),
        "error" => Some(LevelFilter::Error),
        "warn" | "warning" => Some(LevelFilter::Warn),
        "info" => Some(LevelFilter::Info),
        "debug" => Some(LevelFilter::Debug),
        "trace" => Some(LevelFilter::Trace),
        _ => None,
    }
}

pub(crate) fn log_stream_for_level(level: Level) -> LogStream {
    match level {
        Level::Error | Level::Warn => LogStream::Stderr,
        Level::Info | Level::Debug | Level::Trace => LogStream::Stdout,
    }
}

pub(crate) fn sanitize_log_message(message: &str) -> String {
    let redacted = SENSITIVE_KEY_VALUE_RE.replace_all(message, "$1=<redacted>");
    let redacted = HTTP_URL_RE.replace_all(&redacted, "<redacted>");
    let redacted = TOKEN_RE.replace_all(&redacted, "<redacted>");
    let redacted = GITHUB_REPO_REF_RE.replace_all(&redacted, "<redacted>");
    let redacted = WINDOWS_ABSOLUTE_PATH_RE.replace_all(&redacted, "<redacted>");
    UNIX_ABSOLUTE_PATH_RE
        .replace_all(&redacted, "<redacted>")
        .to_string()
}

pub(crate) fn format_log_line(level: Level, module: &str, message: &str) -> String {
    let sanitized = sanitize_log_message(message);
    let normalized = sanitized.replace('\r', "\\r").replace('\n', "\\n");
    format!(
        "level={} module={} message={}",
        level.as_str(),
        if module.is_empty() {
            "<unknown>"
        } else {
            module
        },
        normalized
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_info_and_allows_env_level_override() {
        assert_eq!(level_filter_from_env_value(None), LevelFilter::Info);
        assert_eq!(level_filter_from_env_value(Some("")), LevelFilter::Info);
        assert_eq!(
            level_filter_from_env_value(Some("debug")),
            LevelFilter::Debug
        );
        assert_eq!(
            level_filter_from_env_value(Some("openforge=trace,hyper=warn")),
            LevelFilter::Trace
        );
        assert_eq!(
            level_filter_from_env_value(Some("hyper=warn,info")),
            LevelFilter::Info
        );
        assert_eq!(level_filter_from_env_value(Some("off")), LevelFilter::Off);
    }

    #[test]
    fn routes_info_and_debug_to_stdout_warn_and_error_to_stderr() {
        assert_eq!(log_stream_for_level(Level::Info), LogStream::Stdout);
        assert_eq!(log_stream_for_level(Level::Debug), LogStream::Stdout);
        assert_eq!(log_stream_for_level(Level::Warn), LogStream::Stderr);
        assert_eq!(log_stream_for_level(Level::Error), LogStream::Stderr);
    }

    #[test]
    fn formats_level_module_metadata_and_redacts_private_content() {
        let line = format_log_line(
            Level::Info,
            "openforge::main",
            "using database path=/Users/koen/private/openforge.db prompt=\"secret prompt\" token=ghp_secret repo=acme/private freeform=acme/private #42 https://api.github.com/repos/acme/private/issues",
        );

        assert_eq!(
            line,
            "level=INFO module=openforge::main message=using database path=<redacted> prompt=<redacted> token=<redacted> repo=<redacted> freeform=<redacted> <redacted>"
        );
        assert!(!line.contains("secret prompt"));
        assert!(!line.contains("ghp_secret"));
        assert!(!line.contains("api.github.com"));
    }
}
