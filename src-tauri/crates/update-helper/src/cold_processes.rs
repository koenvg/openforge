//! Identify running source code through kernel paths and loaded code-signature hashes.
use std::path::Path;

/// Refuse a cold replacement while actual source code is still running.
/// # Errors
/// Refuses live source images, unknown kernel observations, and non-macOS hosts.
pub fn assert_cold_source_stopped(bundle: &Path) -> Result<(), String> {
    platform::assert_stopped(bundle, None)
}
/// Only this process may be excluded, after its bytes and loaded identity match
/// the approved helper. Other copies of that code remain source actors.
pub(crate) struct VerifiedInstaller {
    pid: i32,
}

impl VerifiedInstaller {
    pub(crate) fn matching_current(
        target: &Path,
        helper_sha256: &str,
    ) -> Result<Option<Self>, String> {
        use sha2::{Digest, Sha256};
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let bytes = std::fs::read(executable).map_err(|error| error.to_string())?;
        if format!("{:x}", Sha256::digest(bytes)) != helper_sha256 {
            return Ok(None);
        }
        crate::native_image::verify(
            std::process::id(),
            &target.join("Contents/MacOS/openforge-update-helper"),
        )?;
        Ok(Some(Self {
            pid: i32::try_from(std::process::id()).map_err(|error| error.to_string())?,
        }))
    }

    pub(crate) fn assert_stopped(&self, root: &Path) -> Result<(), String> {
        platform::assert_stopped(root, Some(self))
    }
}

pub(crate) fn assert_stopped(
    root: &Path,
    installer: Option<&VerifiedInstaller>,
) -> Result<(), String> {
    platform::assert_stopped(root, installer)
}

#[cfg(target_os = "macos")]
mod platform {
    use std::{
        ffi::CStr,
        fs,
        io::{self, Read},
        os::unix::{ffi::OsStrExt, fs::OpenOptionsExt},
        path::Path,
    };

    fn native_file(path: &Path) -> Result<bool, String> {
        let mut file = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(path)
            .map_err(|error| error.to_string())?;
        if !file
            .metadata()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            return Err("source file changed during native inspection".into());
        }
        let mut magic = [0_u8; 4];
        match file.read_exact(&mut magic) {
            Ok(()) => Ok(matches!(
                magic,
                [0xfe, 0xed, 0xfa, 0xce]
                    | [0xce, 0xfa, 0xed, 0xfe]
                    | [0xfe, 0xed, 0xfa, 0xcf]
                    | [0xcf, 0xfa, 0xed, 0xfe]
                    | [0xca, 0xfe, 0xba, 0xbe]
                    | [0xbe, 0xba, 0xfe, 0xca]
                    | [0xca, 0xfe, 0xba, 0xbf]
                    | [0xbf, 0xba, 0xfe, 0xca]
            )),
            Err(error) if error.kind() == io::ErrorKind::UnexpectedEof => Ok(false),
            Err(error) => Err(error.to_string()),
        }
    }
    fn signed_images(root: &Path) -> Result<Vec<Vec<u8>>, String> {
        let mut pending = vec![root.to_path_buf()];
        let mut hashes = Vec::new();
        let mut entries = 0;
        while let Some(path) = pending.pop() {
            entries += 1;
            if entries > 100_000 {
                return Err("source entry limit exceeded".into());
            }
            let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
            if metadata.is_dir() {
                for entry in fs::read_dir(path).map_err(|error| error.to_string())? {
                    pending.push(entry.map_err(|error| error.to_string())?.path());
                }
            } else if metadata.is_file() && native_file(&path)? {
                // Scripts cannot identify native processes. An unverifiable Mach-O
                // cannot safely exclude a running image whose pathname disappeared.
                hashes.push(crate::native_image::source_code_hash(&path)?);
            }
        }
        Ok(hashes)
    }

    pub fn assert_stopped(
        bundle: &Path,
        installer: Option<&super::VerifiedInstaller>,
    ) -> Result<(), String> {
        let bundle = bundle.canonicalize().map_err(|error| error.to_string())?;
        // PROC_UID_ONLY (4) is the kernel selector for this user's processes.
        // SAFETY: geteuid and the sizing query have no writable pointer requirements.
        let uid = unsafe { libc::geteuid() };
        let needed = unsafe { libc::proc_listpids(4, uid, std::ptr::null_mut(), 0) };
        if needed <= 0 {
            return Err("cannot enumerate source processes".into());
        }
        let mut pids =
            vec![0_i32; usize::try_from(needed).map_err(|error| error.to_string())? / 4 + 1024];
        let bytes = i32::try_from(pids.len() * std::mem::size_of::<i32>())
            .map_err(|error| error.to_string())?;
        // SAFETY: pids is writable aligned storage of the advertised byte capacity.
        let read = unsafe { libc::proc_listpids(4, uid, pids.as_mut_ptr().cast(), bytes) };
        if read <= 0 || read >= bytes || read % 4 != 0 {
            return Err("incomplete source process enumeration".into());
        }
        let mut source_hashes = None;
        for pid in pids
            .into_iter()
            .take(usize::try_from(read).map_err(|error| error.to_string())? / 4)
            .filter(|pid| *pid > 1)
        {
            if installer.is_some_and(|verified| verified.pid == pid) {
                continue;
            }
            let mut path = [0_u8; 4096];
            // SAFETY: path is writable storage of libproc's required 4096-byte capacity.
            let length = unsafe { libc::proc_pidpath(pid, path.as_mut_ptr().cast(), 4096) };
            if length <= 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ESRCH) {
                    continue;
                }
                if error.raw_os_error() != Some(libc::ENOENT) {
                    return Err(format!("cannot inspect process {pid}: {error}"));
                }
            }
            if length > 0 {
                let value = CStr::from_bytes_until_nul(&path).map_err(|error| error.to_string())?;
                let executable = Path::new(std::ffi::OsStr::from_bytes(value.to_bytes()));
                if executable.starts_with(&bundle) {
                    return Err(format!("OpenForge source process {pid} is still running"));
                }
            }
            // A readable outside path can belong to a renamed source bundle.
            // Every surviving actor needs independent loaded-image exclusion.
            if source_hashes.is_none() {
                source_hashes = Some(signed_images(&bundle)?);
            }
            if let Some(running) = crate::native_image::running_hash(pid)? {
                if source_hashes
                    .as_ref()
                    .is_some_and(|hashes| hashes.contains(&running))
                {
                    return Err(format!("OpenForge source image {pid} is still running"));
                }
            }
        }
        Ok(())
    }
}

#[cfg(not(target_os = "macos"))]
mod platform {
    use std::path::Path;
    pub fn assert_stopped(
        _bundle: &Path,
        _installer: Option<&super::VerifiedInstaller>,
    ) -> Result<(), String> {
        Err("cold installation requires macOS".into())
    }
}
