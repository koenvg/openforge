//! Kernel peer identity, not a caller-chosen proof/key pair, authenticates the source.
use crate::source_attestation::{Binding, Birth};
use ring::hmac;
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    time::Duration,
};
const CONTEXT: &[u8] = b"openforge-source-observation-v1\0";
const LIMIT: u64 = 16 * 1024;

#[cfg(target_os = "macos")]
fn socket_path(
    roots: &crate::authorization::LaunchContext,
    identity: crate::process_identity::ProcessIdentity,
) -> Result<PathBuf, String> {
    use sha2::{Digest, Sha256};
    // SAFETY: geteuid has no arguments or memory preconditions.
    let root = PathBuf::from(format!("/private/tmp/openforge-source-{}", unsafe {
        libc::geteuid()
    }));
    let value = serde_json::to_vec(&(roots, identity, crate::source_attestation::boot_session()?))
        .map_err(message)?;
    let hash = format!("{:x}", Sha256::digest(value));
    Ok(root.join(&hash[..32]))
}

#[cfg(target_os = "macos")]
fn peer(stream: &std::os::unix::net::UnixStream) -> Result<u32, String> {
    use std::os::fd::AsRawFd;
    let mut pid: libc::pid_t = 0;
    let mut size = std::mem::size_of_val(&pid) as libc::socklen_t;
    let mut uid = 0;
    let mut gid = 0;
    // SAFETY: stream owns a connected fd; the output scalars span the advertised sizes.
    if unsafe { libc::getpeereid(stream.as_raw_fd(), &mut uid, &mut gid) } != 0
        || unsafe {
            libc::getsockopt(
                stream.as_raw_fd(),
                libc::SOL_LOCAL,
                libc::LOCAL_PEERPID,
                std::ptr::from_mut(&mut pid).cast(),
                &mut size,
            )
        } != 0
        || size as usize != std::mem::size_of_val(&pid)
    {
        return Err("cannot authenticate native source socket peer".into());
    }
    // SAFETY: geteuid has no arguments or memory preconditions.
    if uid != unsafe { libc::geteuid() } || pid <= 1 {
        return Err("foreign native source socket peer".into());
    }
    u32::try_from(pid).map_err(message)
}

#[cfg(target_os = "macos")]
fn receive(
    stream: &mut std::os::unix::net::UnixStream,
) -> Result<crate::source_attestation::Envelope, String> {
    use std::io::Read;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(message)?;
    let mut bytes = Vec::new();
    BufReader::new(stream)
        .take(LIMIT + 1)
        .read_until(b'\n', &mut bytes)
        .map_err(message)?;
    if bytes.len() as u64 > LIMIT || bytes.last() != Some(&b'\n') {
        return Err("invalid native source frame".into());
    }
    serde_json::from_slice(&bytes).map_err(|_| "invalid native source envelope".into())
}

#[cfg(target_os = "macos")]
pub(crate) fn start(birth: Birth, token: String) -> Result<(), String> {
    use std::os::unix::{fs::PermissionsExt, net::UnixListener};
    let path = socket_path(&birth.roots, birth.sidecar)?;
    crate::files::private_directory(path.parent().ok_or("missing source socket root")?)?;
    let listener = UnixListener::bind(&path).map_err(message)?;
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).map_err(message)?;
    let key = hmac::Key::new(
        hmac::HMAC_SHA256,
        &crate::authorization::decode_mac(&token)?,
    );
    std::thread::Builder::new()
        .name("source-attestation".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else {
                    break;
                };
                let response = (|| -> Result<serde_json::Value, String> {
                    let caller = peer(&stream)?;
                    crate::process_identity::ProcessIdentity::child_of(caller, birth.app.pid())?;
                    let envelope = receive(&mut stream)?;
                    hmac::verify(
                        &key,
                        &[CONTEXT, envelope.payload.as_bytes()].concat(),
                        &crate::authorization::decode_mac(&envelope.mac)?,
                    )
                    .map_err(|_| "invalid source observation authentication")?;
                    let request: serde_json::Value =
                        serde_json::from_str(&envelope.payload).map_err(message)?;
                    crate::source_attestation::source_attestation(&request, &token)
                })();
                let _ = stream.set_write_timeout(Some(Duration::from_secs(5)));
                let _ = writeln!(
                    stream,
                    "{}",
                    response.unwrap_or_else(|_| serde_json::json!({"refused":true}))
                );
            }
        })
        .map_err(message)?;
    Ok(())
}

#[cfg(target_os = "macos")]
pub(crate) fn observe(
    roots: &crate::authorization::LaunchContext,
    sidecar: u32,
    token: &str,
    binding: &Binding,
) -> Result<crate::source_attestation::Envelope, String> {
    let identity = crate::process_identity::ProcessIdentity::observe(sidecar)?;
    let path = socket_path(roots, identity)?;
    crate::files::check_private_directory(path.parent().ok_or("missing source socket root")?)?;
    let mut stream = std::os::unix::net::UnixStream::connect(path).map_err(message)?;
    if peer(&stream)? != sidecar {
        return Err("native source server is not the owned Sidecar".into());
    }
    identity.verify(sidecar)?;
    let payload = serde_json::to_string(binding).map_err(message)?;
    let key = hmac::Key::new(hmac::HMAC_SHA256, &crate::authorization::decode_mac(token)?);
    let tag = hmac::sign(&key, &[CONTEXT, payload.as_bytes()].concat());
    stream
        .set_write_timeout(Some(Duration::from_secs(5)))
        .map_err(message)?;
    writeln!(stream,"{}",serde_json::json!({"payload":payload,"mac":tag.as_ref().iter().map(|b| format!("{b:02x}")).collect::<String>()})).map_err(message)?;
    let proof = receive(&mut stream)?;
    identity.verify(sidecar)?;
    Ok(proof)
}

#[cfg(not(target_os = "macos"))]
pub(crate) fn observe(
    _roots: &crate::authorization::LaunchContext,
    _sidecar: u32,
    _token: &str,
    _binding: &Binding,
) -> Result<crate::source_attestation::Envelope, String> {
    Err("original source observation requires macOS arm64".into())
}
fn message(error: impl std::fmt::Display) -> String {
    error.to_string()
}
