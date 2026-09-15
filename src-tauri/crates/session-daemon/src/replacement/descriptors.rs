//! In-process descriptor retention. These are not descriptors transferred to another owner.
use crate::process_native::duplicate;
use openforge_session_protocol::Error;
use serde::{Deserialize, Serialize};
use std::{collections::BTreeSet, fs::File, net::TcpListener, os::{fd::{AsRawFd, FromRawFd, IntoRawFd}, unix::{fs::MetadataExt, net::UnixListener}}, path::Path};

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct Descriptor { fd: i32, device: u64, inode: u64, mode: u32 }
impl Descriptor {
    fn capture(fd: i32) -> Result<Self, Error> {
        if fd < 3 { return Err(Error::InvalidRequest); }
        let metadata = duplicate(fd)?.metadata().map_err(|_| Error::RecoveryUnavailable)?;
        Ok(Self { fd, device: metadata.dev(), inode: metadata.ino(), mode: metadata.mode() & libc::S_IFMT as u32 })
    }
    fn validate(&self) -> Result<(), Error> {
        if Self::capture(self.fd)? != *self { eprintln!("replacement initialization: descriptor {} identity changed", self.fd); return Err(Error::RecoveryUnavailable); }
        Ok(())
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(super) struct Roots { ownership: Descriptor, control: Descriptor, agent: Descriptor }
pub(crate) struct Resources { pub ownership: File, pub control: UnixListener, pub agent: TcpListener }
impl Roots {
    pub fn capture(resources: &Resources) -> Result<Self, Error> {
        Ok(Self { ownership: Descriptor::capture(resources.ownership.as_raw_fd())?, control: Descriptor::capture(resources.control.as_raw_fd())?, agent: Descriptor::capture(resources.agent.as_raw_fd())? })
    }
    pub fn descriptors(&self) -> [i32; 3] { [self.ownership.fd, self.control.fd, self.agent.fd] }
    pub fn restore(&self, runtime: &Path, socket: &Path, port: u16) -> Result<Resources, Error> {
        for descriptor in [&self.ownership, &self.control, &self.agent] { descriptor.validate()?; }
        let metadata = std::fs::symlink_metadata(runtime.join("daemon.lock")).map_err(|_| Error::RecoveryUnavailable)?;
        if !metadata.is_file() || metadata.nlink() != 1 || metadata.dev() != self.ownership.device || metadata.ino() != self.ownership.inode { eprintln!("replacement initialization: ownership path changed"); return Err(Error::RecoveryUnavailable); }
        unconnected_stream(self.control.fd)?;
        unconnected_stream(self.agent.fd)?;
        // Duplicates own only their new descriptor numbers. Abandoned initialization
        // must leave every primary inherited descriptor open for the recovery image.
        let ownership = duplicate(self.ownership.fd)?;
        ownership.try_lock().map_err(|_| { eprintln!("replacement initialization: retained ownership lock unavailable"); Error::AlreadyRunning })?;
        let control = duplicate(self.control.fd)?;
        let agent = duplicate(self.agent.fd)?;
        // SAFETY: these are newly owned, validated listening socket duplicates.
        let control = unsafe { UnixListener::from_raw_fd(control.into_raw_fd()) };
        // SAFETY: agent is a distinct newly owned listening socket duplicate.
        let agent = unsafe { TcpListener::from_raw_fd(agent.into_raw_fd()) };
        if control.local_addr().map_err(|_| Error::RecoveryUnavailable)?.as_pathname() != Some(socket)
            || agent.local_addr().map_err(|_| Error::RecoveryUnavailable)? != std::net::SocketAddr::from((std::net::Ipv4Addr::LOCALHOST, port))
        { eprintln!("replacement initialization: retained discovery address changed"); return Err(Error::RecoveryUnavailable); }
        control.set_nonblocking(true).map_err(|_| Error::RecoveryUnavailable)?;
        agent.set_nonblocking(true).map_err(|_| Error::RecoveryUnavailable)?;
        Ok(Resources { ownership, control, agent })
    }
    /// # Safety
    /// Call once, only after successful activation, with no Rust wrapper owning any
    /// primary root descriptor. Resources now hold their replacement duplicates.
    pub unsafe fn release_primaries(&self) {
        for fd in self.descriptors() {
            // SAFETY: the caller transfers each distinct live primary to this destructor.
            drop(unsafe { File::from_raw_fd(fd) });
        }
    }
}
fn unconnected_stream(fd: i32) -> Result<(), Error> {
    // Darwin rejects SO_ACCEPTCONN with ENOPROTOOPT. Retain the original descriptor
    // identity and bound address, verify stream type, and reject accepted connections
    // without consuming anything from the listener's accept queue.
    let mut value: libc::c_int = 0;
    let mut size = std::mem::size_of_val(&value) as libc::socklen_t;
    // SAFETY: both output pointers are writable for the supplied sizes; fd is borrowed.
    if unsafe { libc::getsockopt(fd, libc::SOL_SOCKET, libc::SO_TYPE, (&mut value as *mut libc::c_int).cast(), &mut size) } < 0 || value != libc::SOCK_STREAM { return Err(Error::RecoveryUnavailable); }
    // SAFETY: zero is a valid initial representation for this plain socket address buffer.
    let mut address: libc::sockaddr_storage = unsafe { std::mem::zeroed() };
    let mut length = std::mem::size_of_val(&address) as libc::socklen_t;
    // SAFETY: address and length are writable, correctly sized output buffers.
    let result = unsafe { libc::getpeername(fd, (&mut address as *mut libc::sockaddr_storage).cast(), &mut length) };
    if result == 0 || std::io::Error::last_os_error().raw_os_error() != Some(libc::ENOTCONN) { return Err(Error::RecoveryUnavailable); }
    Ok(())
}
pub(super) fn validate_list(fds: &[i32]) -> Result<(), Error> {
    if fds.len() > 36 || fds.iter().any(|fd| !(3..1_048_576).contains(fd)) || fds.iter().copied().collect::<BTreeSet<_>>().len() != fds.len() { return Err(Error::InvalidRequest); }
    Ok(())
}
pub(super) fn protect(fds: &[i32]) -> Result<(), Error> {
    validate_list(fds)?;
    for &fd in fds {
        // SAFETY: fcntl validates the integer descriptor; no Rust ownership is assumed.
        let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
        // SAFETY: only this retained descriptor's inheritance flag changes.
        if flags < 0 || unsafe { libc::fcntl(fd, libc::F_SETFD, flags | libc::FD_CLOEXEC) } < 0 { return Err(Error::RecoveryUnavailable); }
    }
    Ok(())
}
pub(super) struct Inheritance { changed: Vec<(i32, i32)> }
impl Inheritance {
    pub fn prepare(retained: &[i32]) -> Result<Self, Error> {
        validate_list(retained)?;
        // SAFETY: getdtablesize only reads the process limit and takes no pointers.
        let limit = unsafe { libc::getdtablesize() };
        if !(3..=1_048_576).contains(&limit) { return Err(Error::UnsupportedReplacement); }
        let mut guard = Self { changed: Vec::new() };
        let mut seen = BTreeSet::new();
        for fd in 3..limit {
            // SAFETY: fcntl accepts arbitrary integer descriptors and rejects closed ones.
            let flags = unsafe { libc::fcntl(fd, libc::F_GETFD) };
            if flags < 0 {
                if std::io::Error::last_os_error().raw_os_error() == Some(libc::EBADF) { continue; }
                return Err(Error::RecoveryUnavailable);
            }
            let wanted = if retained.contains(&fd) {
                seen.insert(fd);
                flags & !libc::FD_CLOEXEC
            } else {
                // Do not mutate an unrelated descriptor that another runtime thread
                // might close/reuse before rollback. Refuse unknown inheritance.
                if flags & libc::FD_CLOEXEC == 0 { return Err(Error::UnsupportedReplacement); }
                flags
            };
            if flags == wanted { continue; }
            // SAFETY: fd was just validated; owning threads are quiesced throughout exec.
            if unsafe { libc::fcntl(fd, libc::F_SETFD, wanted) } < 0 { return Err(Error::RecoveryUnavailable); }
            guard.changed.push((fd, flags));
        }
        if seen.len() != retained.len() { return Err(Error::RecoveryUnavailable); }
        Ok(guard)
    }
}
impl Drop for Inheritance {
    fn drop(&mut self) {
        // Exec success never drops this guard. Failure restores the serving image's flags.
        for &(fd, flags) in &self.changed {
            // SAFETY: retained ownership and quiescence outlive this rollback guard.
            if unsafe { libc::fcntl(fd, libc::F_SETFD, flags) } < 0 { eprintln!("descriptor inheritance rollback failed"); }
        }
    }
}
