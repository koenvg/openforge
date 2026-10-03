#![cfg(all(
    target_os = "macos",
    target_arch = "aarch64",
    feature = "replacement-fixtures"
))]

// One integration-test binary keeps every real-process scenario on the shared fixture lock.
#[allow(dead_code)]
#[path = "../../../src/pty_manager/managed_process.rs"]
mod managed_process;
#[path = "replacement/support.rs"]
mod support;

#[path = "replacement/capacity.rs"]
mod capacity;
#[path = "replacement/checkpoint.rs"]
mod checkpoint;
#[path = "replacement/continuity.rs"]
mod continuity;
#[path = "replacement/http.rs"]
mod http;
#[path = "replacement/input.rs"]
mod input;
#[path = "replacement/model_provider.rs"]
mod model_provider;
#[path = "replacement/notifications.rs"]
mod notifications;
#[path = "replacement/operation_retention.rs"]
mod operation_retention;
#[path = "replacement/pause_deadline.rs"]
mod pause_deadline;
#[path = "replacement/pi.rs"]
mod pi;
#[path = "replacement/preflight.rs"]
mod preflight;
#[path = "replacement/recovery.rs"]
mod recovery;
#[path = "replacement/scale.rs"]
mod scale;
#[path = "replacement/turnover.rs"]
mod turnover;
