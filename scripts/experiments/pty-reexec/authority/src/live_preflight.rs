//! Private fixture preflight. This is compatibility checking, not image authentication.
use super::Result;
use serde::{Deserialize, Serialize};
use std::{
    io::{self, Read},
    os::{
        fd::AsRawFd,
        unix::{fs::OpenOptionsExt, process::CommandExt},
    },
    path::{Path, PathBuf},
    process::{Child, ChildStdout, Command, Stdio},
    time::{Duration, Instant},
};

pub(super) const STATE_FORMAT: u32 = 2;
const PROTOCOL: u32 = 1;
// Bump this private contract when changing the imported authority's binary codec.
const AUTHORITY_CODEC: &str = "ghostty-de9fd9b0-v1";
const RESPONSE_LIMIT: usize = 4096;
const TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImageContract {
    protocol: u32,
    state_format: u32,
    authority_codec: String,
    architecture: String,
    image_version: u8,
}

pub(super) fn describe(version: u8) -> Result<()> {
    super::publish(serde_json::to_value(ImageContract {
        protocol: PROTOCOL,
        state_format: STATE_FORMAT,
        authority_codec: AUTHORITY_CODEC.into(),
        architecture: std::env::consts::ARCH.into(),
        image_version: version,
    })?)
}

pub(super) fn validate(target: &str, current_version: u8) -> Result<(u8, PathBuf)> {
    let recovery_image = std::env::current_exe()?;
    let target_version = probe(Path::new(target))?;
    if probe(&recovery_image)? != current_version {
        return Err("retained recovery image version changed".into());
    }
    Ok((target_version, recovery_image))
}

fn probe(target: &Path) -> Result<u8> {
    {
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NONBLOCK)
            .open(target)?;
        if !file.metadata()?.is_file() {
            return Err("target is not a regular file".into());
        }
        let mut header = [0; 32];
        file.read_exact(&mut header)?;
        // This arm64 experiment accepts only thin 64-bit Mach-O executables:
        // MH_MAGIC_64, CPU_TYPE_ARM64, MH_EXECUTE. The kernel validates the rest.
        if header[..4] != [0xcf, 0xfa, 0xed, 0xfe]
            || header[4..8] != [0x0c, 0, 0, 1]
            || header[12..16] != [2, 0, 0, 0]
        {
            return Err("target is not a supported arm64 Mach-O executable".into());
        }
    }
    let mut command = Command::new(target);
    command
        .arg("--check-image")
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // SAFETY: the child closure only uses async-signal-safe libc calls. Setting
    // CLOEXEC in the child preserves Command's error pipe until exec, but lends
    // no live session/checkpoint descriptors to the target. Parent flags do not change.
    unsafe {
        command.pre_exec(|| {
            for fd in 3..libc::getdtablesize() {
                let flags = libc::fcntl(fd, libc::F_GETFD);
                if flags < 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() == Some(libc::EBADF) {
                        continue;
                    }
                    return Err(error);
                }
                if libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) < 0 {
                    return Err(io::Error::last_os_error());
                }
            }
            Ok(())
        });
    }
    let mut child = command.spawn()?;
    let result = match child.stdout.take() {
        Some(stdout) => read_contract(&mut child, stdout),
        None => Err("missing image probe output pipe".into()),
    };
    // Never leave an unresponsive probe or zombie behind. Child retains kernel
    // parenthood until wait/try_wait; kill cannot target a reused, already reaped PID.
    if result.is_err() {
        let _ = child.kill();
    }
    child.wait()?;
    result
}

fn read_contract(child: &mut Child, mut stdout: ChildStdout) -> Result<u8> {
    let fd = stdout.as_raw_fd();
    // SAFETY: stdout owns this descriptor; fcntl only changes integer flags.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    // SAFETY: stdout remains live and O_NONBLOCK is valid for its pipe.
    if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFL, flags | libc::O_NONBLOCK) } < 0 {
        return Err(io::Error::last_os_error().into());
    }
    let deadline = Instant::now() + TIMEOUT;
    let mut response = Vec::new();
    let mut eof = false;
    loop {
        let mut buffer = [0; 512];
        loop {
            match stdout.read(&mut buffer) {
                Ok(0) => {
                    eof = true;
                    break;
                }
                Ok(length) => {
                    if response.len() + length > RESPONSE_LIMIT {
                        return Err("image probe response budget exceeded".into());
                    }
                    response.extend_from_slice(&buffer[..length]);
                }
                Err(error) if error.kind() == io::ErrorKind::WouldBlock => break,
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(error) => return Err(error.into()),
            }
        }
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                return Err("image probe failed".into());
            }
            if eof {
                let contract: ImageContract = serde_json::from_slice(&response)?;
                if contract.protocol != PROTOCOL
                    || contract.state_format != STATE_FORMAT
                    || contract.authority_codec != AUTHORITY_CODEC
                    || contract.architecture != std::env::consts::ARCH
                    || contract.image_version == 0
                {
                    return Err("incompatible image contract".into());
                }
                return Ok(contract.image_version);
            }
        }
        if Instant::now() >= deadline {
            return Err("image probe timed out".into());
        }
        std::thread::sleep(Duration::from_millis(5));
    }
}
