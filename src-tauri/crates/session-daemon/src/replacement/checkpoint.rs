use super::{
    descriptors::{self, Resources, Roots},
    images::Image,
    Snapshot, STATE_FORMAT,
};
use crate::{
    agent_config::AgentRuntime, host::HostCheckpoint,
    notification_checkpoint::NotificationCheckpoint,
};
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_protocol::{Credentials, Error, OperationId};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{File, OpenOptions},
    io::{Read, Write},
    os::{
        fd::{AsRawFd, FromRawFd},
        unix::fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};

const MAX_HEADER: usize = 8192;
const MAX_BODY: usize = 64 * 1024 * 1024;
pub(super) const MAX_FILE: usize = MAX_BODY + MAX_HEADER + 8;
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Header {
    format: u32,
    owner_pid: u32,
    body_length: usize,
    body_digest: String,
    pub root: PathBuf,
    pub credentials: Credentials,
    pub agent_runtime: AgentRuntime,
    pub roots: Roots,
    pub masters: Vec<i32>,
    pub operation: OperationId,
    pub recovery: Image,
    pub target: Image,
    pub notifications: NotificationCheckpoint,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Body {
    pub host: HostCheckpoint,
    pub manager: Snapshot,
}
impl Header {
    pub fn capture(
        runtime: &RuntimeDirectory,
        resources: &Resources,
        host: &HostCheckpoint,
        manager: &Snapshot,
        operation: OperationId,
    ) -> Result<Self, Error> {
        let root = runtime
            .path()
            .parent()
            .ok_or(Error::InvalidRequest)?
            .to_path_buf();
        RuntimeDirectory::reopen(&root, runtime.credentials())?;
        let agent_runtime = AgentRuntime {
            directory: runtime.path().into(),
            port: resources
                .agent
                .local_addr()
                .map_err(|_| Error::RecoveryUnavailable)?
                .port(),
        };
        let target = manager.target(&operation)?.clone();
        let header = Self {
            format: STATE_FORMAT,
            owner_pid: std::process::id(),
            body_length: 0,
            body_digest: String::new(),
            root,
            credentials: runtime.credentials().clone(),
            agent_runtime,
            roots: Roots::capture(resources)?,
            masters: host.descriptors(),
            operation,
            recovery: manager.current.clone(),
            target,
            notifications: NotificationCheckpoint::capture(
                &runtime.path().join("notifications.sqlite"),
            )?,
        };
        descriptors::validate_list(&header.descriptors())?;
        // Exercise the retained image's root-wrapper checks before crossing exec.
        // These own duplicates only; dropping them cannot release the primaries.
        drop(header.roots.restore(
            runtime.path(),
            &runtime.socket_path(),
            header.agent_runtime.port,
        )?);
        Ok(header)
    }
    pub fn descriptors(&self) -> Vec<i32> {
        self.roots
            .descriptors()
            .into_iter()
            .chain(self.masters.iter().copied())
            .collect()
    }
    pub fn validate_state(&self, body: &Body) -> Result<(), Error> {
        if self.format != STATE_FORMAT
            || self.root.as_os_str().len() > 4096
            || self.agent_runtime.directory != self.root.join("session-v1")
            || self.masters != body.host.descriptors()
            || self.recovery != body.manager.current
            || self.target != *body.manager.target(&self.operation)?
        {
            return Err(Error::InvalidRequest);
        }
        descriptors::validate_list(&self.descriptors())?;
        body.manager.validate(
            &self.operation,
            &self.agent_runtime.directory.join("images"),
        )?;
        RuntimeDirectory::reopen(&self.root, &self.credentials)?;
        self.notifications.validate()?;
        body.host
            .validate_for_image(&self.credentials.installation, &self.agent_runtime)
    }
    pub fn validate_owner(&self) -> Result<(), Error> {
        if self.owner_pid != std::process::id() {
            return Err(Error::Unauthorized);
        }
        Ok(())
    }
}
struct Bounded(Vec<u8>, usize);
impl Write for Bounded {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > self.1 {
            return Err(std::io::Error::other("checkpoint budget exceeded"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
pub(super) fn encode(mut header: Header, body: &Body) -> Result<Vec<u8>, Error> {
    let mut bytes = Bounded(Vec::new(), MAX_BODY);
    serde_json::to_writer(&mut bytes, body).map_err(|_| Error::Capacity)?;
    header.body_length = bytes.0.len();
    header.body_digest = format!("{:x}", Sha256::digest(&bytes.0));
    let mut prefix = Bounded(Vec::new(), MAX_HEADER);
    serde_json::to_writer(&mut prefix, &header).map_err(|_| Error::Capacity)?;
    let mut file = Vec::with_capacity(8 + prefix.0.len() + bytes.0.len());
    file.extend_from_slice(b"OFRX");
    file.extend_from_slice(&(prefix.0.len() as u32).to_le_bytes());
    file.extend_from_slice(&prefix.0);
    file.extend_from_slice(&bytes.0);
    Ok(file)
}
pub(super) fn header(bytes: &[u8]) -> Result<(Header, usize), Error> {
    if bytes.len() < 8 || bytes.len() > MAX_FILE || &bytes[..4] != b"OFRX" {
        return Err(Error::InvalidRequest);
    }
    let length =
        u32::from_le_bytes(bytes[4..8].try_into().map_err(|_| Error::InvalidRequest)?) as usize;
    if length > MAX_HEADER || 8 + length > bytes.len() {
        return Err(Error::Capacity);
    }
    let header: Header =
        serde_json::from_slice(&bytes[8..8 + length]).map_err(|_| Error::Version)?;
    if header.format != STATE_FORMAT {
        return Err(Error::Version);
    }
    Ok((header, 8 + length))
}
pub(super) fn body(header: &Header, bytes: &[u8], start: usize) -> Result<Body, Error> {
    let body = bytes.get(start..).ok_or(Error::InvalidRequest)?;
    if body.len() > MAX_BODY
        || body.len() != header.body_length
        || format!("{:x}", Sha256::digest(body)) != header.body_digest
    {
        return Err(Error::InvalidRequest);
    }
    serde_json::from_slice(body).map_err(|_| Error::Version)
}
pub(super) fn create(directory: &Path, bytes: &[u8]) -> Result<File, Error> {
    let path = directory.join(format!("replacement-{}.tmp", uuid::Uuid::new_v4()));
    let mut writer = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&path)
        .map_err(|_| Error::RecoveryUnavailable)?;
    let result = (|| {
        writer
            .write_all(bytes)
            .map_err(|_| Error::RecoveryUnavailable)?;
        writer.sync_all().map_err(|_| Error::RecoveryUnavailable)?;
        let file = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&path)
            .map_err(|_| Error::RecoveryUnavailable)?;
        let original = writer.metadata().map_err(|_| Error::RecoveryUnavailable)?;
        let retained = file.metadata().map_err(|_| Error::RecoveryUnavailable)?;
        if original.dev() != retained.dev() || original.ino() != retained.ino() {
            return Err(Error::Unauthorized);
        }
        Ok(file)
    })();
    let removed = std::fs::remove_file(path).map_err(|_| Error::RecoveryUnavailable);
    drop(writer); // No writable descriptor is retained or lent to another image.
    removed?;
    result
}
/// # Safety
/// The post-exec entrypoint transfers ownership of its one inherited checkpoint fd.
pub(super) unsafe fn read(fd: i32) -> Result<(File, Vec<u8>), Error> {
    descriptors::validate_list(&[fd])?;
    let metadata = crate::process_native::duplicate(fd)?
        .metadata()
        .map_err(|_| Error::RecoveryUnavailable)?;
    // SAFETY: fcntl reads flags without assuming Rust ownership of the supplied integer.
    let flags = unsafe { libc::fcntl(fd, libc::F_GETFL) };
    // SAFETY: geteuid reads this process's identity without pointers.
    if !metadata.is_file()
        || metadata.uid() != unsafe { libc::geteuid() }
        || metadata.mode() & 0o777 != 0o600
        || metadata.nlink() != 0
        || metadata.len() > MAX_FILE as u64
        || flags < 0
        || flags & libc::O_ACCMODE != libc::O_RDONLY
    {
        return Err(Error::Unauthorized);
    }
    // SAFETY: validation established a live descriptor and the caller transfers ownership.
    let mut file = unsafe { File::from_raw_fd(fd) };
    descriptors::protect(&[file.as_raw_fd()])?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(MAX_FILE as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| Error::RecoveryUnavailable)?;
    if bytes.len() > MAX_FILE {
        return Err(Error::Capacity);
    }
    Ok((file, bytes))
}
