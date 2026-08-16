//! Protocol for invoking the current executable as a restricted macOS Keychain helper.

use super::super::{
    get_secret_native_unlocked, set_secret_unlocked, COMPANION_HOST_IDENTITY_SECRET,
};
use std::{
    io::{self, Read, Write},
    path::Path,
    process::Command,
};

pub(super) const MAX_KEYCHAIN_HELPER_INPUT_BYTES: u64 = 1024 * 1024;
const KEYCHAIN_READ_HELPER_ARG: &str = "--openforge-keychain-read-helper";
const KEYCHAIN_WRITE_HELPER_ARG: &str = "--openforge-keychain-write-helper";
const KEYCHAIN_ENTRY_NOT_FOUND_EXIT_CODE: i32 = 44;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum KeychainHelper {
    Read,
    Write,
}

pub(super) fn read_helper_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command.arg(KEYCHAIN_READ_HELPER_ARG);
    command
}

pub(super) fn write_helper_command(executable: &Path) -> Command {
    let mut command = Command::new(executable);
    command.arg(KEYCHAIN_WRITE_HELPER_ARG);
    command
}

pub(super) fn decode_read_result(
    key: &str,
    success: bool,
    status_code: Option<i32>,
    stdout: &[u8],
) -> Result<Option<String>, String> {
    if success {
        let value = std::str::from_utf8(stdout)
            .map_err(|error| format!("Secret '{key}' is not valid UTF-8: {error}"))?;
        return Ok(Some(value.to_string()));
    }
    if status_code == Some(KEYCHAIN_ENTRY_NOT_FOUND_EXIT_CODE) {
        return Ok(None);
    }

    Err(format!(
        "Failed to get secret '{key}' from macOS Keychain (status {})",
        status_code
            .map(|code| code.to_string())
            .unwrap_or_else(|| "unknown".to_string()),
    ))
}

fn helper_requested(args: impl IntoIterator<Item = String>) -> Result<Option<KeychainHelper>, ()> {
    let mut args = args.into_iter();
    let _executable = args.next();
    let helper = match args.next().as_deref() {
        Some(KEYCHAIN_READ_HELPER_ARG) => KeychainHelper::Read,
        Some(KEYCHAIN_WRITE_HELPER_ARG) => KeychainHelper::Write,
        _ => return Ok(None),
    };
    if args.next().is_some() {
        return Err(());
    }
    Ok(Some(helper))
}

fn write_secret_output(writer: &mut impl Write, value: &str) -> io::Result<()> {
    writer.write_all(value.as_bytes())?;
    writer.flush()
}

fn run_read_helper() -> i32 {
    match get_secret_native_unlocked(COMPANION_HOST_IDENTITY_SECRET) {
        Ok(Some(value)) => {
            let stdout = std::io::stdout();
            let mut writer = stdout.lock();
            if write_secret_output(&mut writer, &value).is_ok() {
                0
            } else {
                1
            }
        }
        Ok(None) => KEYCHAIN_ENTRY_NOT_FOUND_EXIT_CODE,
        Err(_) => 1,
    }
}

fn run_write_helper() -> i32 {
    let mut value = Vec::new();
    let read_result = std::io::stdin()
        .take(MAX_KEYCHAIN_HELPER_INPUT_BYTES + 1)
        .read_to_end(&mut value);
    let result = read_result
        .map_err(|_| ())
        .and_then(|_| {
            if value.len() as u64 > MAX_KEYCHAIN_HELPER_INPUT_BYTES {
                return Err(());
            }
            String::from_utf8(value).map_err(|_| ())
        })
        .and_then(|value| {
            set_secret_unlocked(COMPANION_HOST_IDENTITY_SECRET, &value).map_err(|_| ())
        });
    if result.is_ok() {
        0
    } else {
        1
    }
}

pub(super) fn run_if_requested() -> Option<i32> {
    match helper_requested(std::env::args()) {
        Ok(None) => None,
        Err(()) => Some(2),
        Ok(Some(KeychainHelper::Read)) => Some(run_read_helper()),
        Ok(Some(KeychainHelper::Write)) => Some(run_write_helper()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keychain_helper_result_preserves_secret_bytes_and_handles_missing_items() {
        let found = decode_read_result(
            "companion_host_identity",
            true,
            Some(0),
            b"identity-json\r\n",
        )
        .expect("successful helper output");
        assert_eq!(found, Some("identity-json\r\n".to_string()));

        let missing = decode_read_result(
            "missing",
            false,
            Some(KEYCHAIN_ENTRY_NOT_FOUND_EXIT_CODE),
            b"",
        )
        .expect("missing Keychain item");
        assert_eq!(missing, None);
    }

    #[test]
    fn keychain_read_helper_flushes_exact_secret_output() {
        #[derive(Default)]
        struct RecordingWriter {
            bytes: Vec<u8>,
            flushed: bool,
        }

        impl Write for RecordingWriter {
            fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
                self.bytes.extend_from_slice(buffer);
                Ok(buffer.len())
            }

            fn flush(&mut self) -> io::Result<()> {
                self.flushed = true;
                Ok(())
            }
        }

        let mut writer = RecordingWriter::default();
        write_secret_output(&mut writer, "identity-json\n")
            .expect("helper output should be written");

        assert_eq!(writer.bytes, b"identity-json\n");
        assert!(writer.flushed);
    }

    #[test]
    fn keychain_read_helper_uses_the_openforge_executable() {
        let executable = std::path::Path::new("/Applications/OpenForge/openforge-sidecar");
        let command = read_helper_command(executable);

        assert_eq!(command.get_program(), executable);
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![std::ffi::OsStr::new(KEYCHAIN_READ_HELPER_ARG)]
        );
    }

    #[test]
    fn keychain_helpers_reject_account_overrides() {
        for (helper_arg, helper) in [
            (KEYCHAIN_READ_HELPER_ARG, KeychainHelper::Read),
            (KEYCHAIN_WRITE_HELPER_ARG, KeychainHelper::Write),
        ] {
            let requested = helper_requested(["openforge", helper_arg].map(str::to_string));
            assert_eq!(requested, Ok(Some(helper)));

            let overridden =
                helper_requested(["openforge", helper_arg, "github_token"].map(str::to_string));
            assert_eq!(overridden, Err(()));
        }
    }
}
