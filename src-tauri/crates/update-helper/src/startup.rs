//! Shared inherited-stream and permanent-installation checks for native startup gates.
use crate::files;
use std::{io::Read, path::Path, time::Duration};

pub(crate) fn binding_matches(
    root: &Path,
    installation: &str,
    destination: &Path,
) -> Result<bool, String> {
    let parent = destination.parent().ok_or("missing installation parent")?;
    let name = destination
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("invalid installation name")?;
    let binding = files::read_private(
        &parent.join(format!(".{name}.openforge-update.lock")),
        16 * 1024,
    )?;
    let expected = serde_json::to_vec(&(root.canonicalize().map_err(message)?, installation))
        .map_err(message)?;
    Ok(binding == expected)
}

pub(crate) fn read_admission(subject: &str) -> Result<Vec<u8>, String> {
    let mut metadata = std::mem::MaybeUninit::<libc::stat>::uninit();
    // SAFETY: metadata is writable stat storage; stdin is only inspected, not taken.
    if unsafe { libc::fstat(libc::STDIN_FILENO, metadata.as_mut_ptr()) } != 0 {
        return Err(format!("missing {subject} admission pipe"));
    }
    // SAFETY: successful fstat initialized the entire structure.
    let kind = unsafe { metadata.assume_init() }.st_mode & libc::S_IFMT;
    if kind == libc::S_IFSOCK {
        // Node may supply a Unix socketpair instead of a FIFO. Never accept TCP.
        let mut address = std::mem::MaybeUninit::<libc::sockaddr_storage>::zeroed();
        let mut size = std::mem::size_of::<libc::sockaddr_storage>()
            .try_into()
            .map_err(message)?;
        // SAFETY: address and size are writable, correctly sized storage.
        if unsafe { libc::getsockname(libc::STDIN_FILENO, address.as_mut_ptr().cast(), &mut size) }
            != 0
        {
            return Err(format!("invalid {subject} admission socket"));
        }
        // SAFETY: successful getsockname initialized the address family.
        if i32::from(unsafe { address.assume_init() }.ss_family) != libc::AF_UNIX {
            return Err(format!(
                "{subject} admission requires a local inherited stream"
            ));
        }
    } else if kind != libc::S_IFIFO {
        return Err(format!("{subject} admission requires an inherited pipe"));
    }
    let mut bytes = Vec::new();
    crate::handoff_input::HandoffInput::with_timeout(Duration::from_secs(30))
        .take(16 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(message)?;
    if bytes.is_empty() {
        return Err(format!("missing authenticated {subject} admission"));
    }
    if bytes.len() > 16 * 1024 {
        return Err(format!("{subject} admission exceeds size limit"));
    }
    Ok(bytes)
}

fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
