//! Kernel process birth identity. PIDs alone are not durable launch authority.
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct ProcessIdentity {
    pid: u32,
    started_seconds: u64,
    started_microseconds: u64,
}

impl ProcessIdentity {
    pub fn running(&self) -> Result<bool, String> {
        Ok(snapshot(self.pid)?.map(|(identity, _)| identity) == Some(*self))
    }

    pub fn child(child: &std::process::Child) -> Result<Self, String> {
        Self::child_of(child.id(), std::process::id())
    }

    pub fn child_of(pid: u32, expected_parent: u32) -> Result<Self, String> {
        let (identity, parent) = snapshot(pid)?.ok_or("child exited before launch was recorded")?;
        if parent != expected_parent {
            return Err("process is not the authenticated app's child".into());
        }
        Ok(identity)
    }

    pub fn verify(&self, caller: u32) -> Result<(), String> {
        if caller != self.pid || snapshot(caller)?.map(|(identity, _)| identity) != Some(*self) {
            return Err("startup caller is not the authenticated launched process".into());
        }
        Ok(())
    }
}

#[cfg(target_os = "macos")]
fn snapshot(pid: u32) -> Result<Option<(ProcessIdentity, u32)>, String> {
    let raw_pid = i32::try_from(pid).map_err(|_| "invalid process identity")?;
    if raw_pid <= 1 {
        return Err("invalid process identity".into());
    }
    let mut info = std::mem::MaybeUninit::<libc::proc_bsdinfo>::zeroed();
    let size = std::mem::size_of::<libc::proc_bsdinfo>()
        .try_into()
        .map_err(|_| "invalid process metadata size")?;
    // SAFETY: info is writable storage of exactly the advertised size. This
    // read-only kernel query targets one positive PID and does not signal it.
    let read = unsafe {
        libc::proc_pidinfo(
            raw_pid,
            libc::PROC_PIDTBSDINFO,
            0,
            info.as_mut_ptr().cast(),
            size,
        )
    };
    if read != size {
        let error = std::io::Error::last_os_error();
        return if error.raw_os_error() == Some(libc::ESRCH) {
            Ok(None)
        } else {
            Err(format!("cannot identify update process: {error}"))
        };
    }
    // SAFETY: proc_pidinfo returned the complete initialized structure.
    let info = unsafe { info.assume_init() };
    // SAFETY: getuid has no pointer arguments or side effects.
    let uid = unsafe { libc::getuid() };
    if info.pbi_pid != pid
        || info.pbi_uid != uid
        || info.pbi_ruid != uid
        || info.pbi_start_tvsec == 0
    {
        return Err("unsafe update process identity".into());
    }
    if info.pbi_status == libc::SZOMB {
        return Ok(None);
    }
    Ok(Some((
        ProcessIdentity {
            pid,
            started_seconds: info.pbi_start_tvsec,
            started_microseconds: info.pbi_start_tvusec,
        },
        info.pbi_ppid,
    )))
}

#[cfg(not(target_os = "macos"))]
fn snapshot(_pid: u32) -> Result<Option<(ProcessIdentity, u32)>, String> {
    Err("update process authority requires macOS".into())
}
