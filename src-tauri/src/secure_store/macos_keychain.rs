//! macOS Keychain helper protocol and child-process supervision façade.

mod helper_protocol;
mod process_supervision;

use super::{
    SecretStoreCancellation, SecretStoreWriteError, COMPANION_HOST_IDENTITY_SECRET,
    INTERACTIVE_KEYCHAIN_READ_TIMEOUT,
};
use std::time::Duration;

pub(super) fn get_secret(
    key: &str,
    cancellation: &SecretStoreCancellation,
    timeout: Duration,
) -> Result<Option<String>, String> {
    if key != COMPANION_HOST_IDENTITY_SECRET {
        return Err(format!(
            "Cancellable macOS Keychain reads are restricted to '{COMPANION_HOST_IDENTITY_SECRET}'"
        ));
    }
    let executable = std::env::current_exe()
        .map_err(|error| format!("Failed to locate macOS Keychain reader: {error}"))?;
    let mut command = helper_protocol::read_helper_command(&executable);
    let output = process_supervision::run_read_command(&mut command, timeout, cancellation)?;
    helper_protocol::decode_read_result(
        key,
        output.status.success(),
        output.status.code(),
        &output.stdout,
    )
}

pub(super) fn set_companion_host_identity_with_cancellation(
    value: &str,
    cancellation: &SecretStoreCancellation,
) -> Result<(), SecretStoreWriteError> {
    if value.len() as u64 > helper_protocol::MAX_KEYCHAIN_HELPER_INPUT_BYTES {
        return Err(SecretStoreWriteError::NotCommitted(
            "Secret exceeded the safe Keychain helper input limit".to_string(),
        ));
    }
    let executable = std::env::current_exe().map_err(|error| {
        SecretStoreWriteError::NotCommitted(format!(
            "Failed to locate macOS Keychain helper: {error}"
        ))
    })?;
    let mut command = helper_protocol::write_helper_command(&executable);
    let status = process_supervision::run_write_command(
        &mut command,
        value.as_bytes(),
        INTERACTIVE_KEYCHAIN_READ_TIMEOUT,
        cancellation,
    )
    .map_err(|error| match error {
        process_supervision::WriteCommandError::NotCommitted(error) => {
            SecretStoreWriteError::NotCommitted(error)
        }
        process_supervision::WriteCommandError::CommitUnknown(error) => {
            SecretStoreWriteError::CommitUnknown(error)
        }
    })?;

    if status.success() {
        Ok(())
    } else {
        Err(SecretStoreWriteError::CommitUnknown(format!(
            "Failed to store secret in macOS Keychain (status {})",
            status
                .code()
                .map(|code| code.to_string())
                .unwrap_or_else(|| "unknown".to_string())
        )))
    }
}

pub(super) fn run_helper_if_requested() -> Option<i32> {
    helper_protocol::run_if_requested()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_helper_failure_diagnostics_do_not_include_command_output() {
        let output = process_supervision::run_command_with_timeout(
            "/bin/sh",
            &[
                "-c",
                "printf 'secret from stdout'; printf 'secret from stderr' >&2; exit 7",
            ],
            Duration::from_secs(1),
        )
        .expect("failed command should still return its status");
        assert_eq!(output.stdout, b"secret from stdout");
        assert!(output.stderr.is_empty());

        let error = helper_protocol::decode_read_result(
            "companion_host_identity",
            output.status.success(),
            output.status.code(),
            &output.stdout,
        )
        .expect_err("failed helper command");

        assert_eq!(
            error,
            "Failed to get secret 'companion_host_identity' from macOS Keychain (status 7)"
        );
        assert!(!error.contains("secret from stdout"));
        assert!(!error.contains("secret from stderr"));
    }

    #[test]
    fn keychain_read_helper_rejects_github_credentials() {
        let error = get_secret(
            "github_token",
            &SecretStoreCancellation::default(),
            Duration::from_secs(1),
        )
        .expect_err("ordinary credentials must use in-process Keychain access");

        assert_eq!(
            error,
            "Cancellable macOS Keychain reads are restricted to 'companion_host_identity'"
        );
    }

    #[test]
    fn keychain_read_budget_allows_interactive_authorization() {
        assert!(
            INTERACTIVE_KEYCHAIN_READ_TIMEOUT >= Duration::from_secs(60),
            "interactive Keychain approval must allow time for a user decision"
        );
    }
}
