#[cfg(feature = "replacement-fixtures")]
use super::IMAGE_VERSION;
use super::{checkpoint, descriptors, images, version, Manager, Resources};
use crate::host::Host;
use openforge_session_client::runtime::RuntimeDirectory;
use openforge_session_protocol::Error;
use std::{
    io::{Seek, SeekFrom},
    os::{fd::AsRawFd, unix::process::CommandExt},
};

struct Ready {
    runtime: RuntimeDirectory,
    resources: Resources,
    host: Host,
    manager: Manager,
}
pub(super) fn run(fd: i32, recovery: bool) -> Result<(), Error> {
    // SAFETY: this entrypoint runs only in the post-exec image. The checkpoint reader
    // validates a private, unlinked, read-only file before adopting its descriptor.
    let (mut file, bytes) = unsafe { checkpoint::read(fd)? };
    let (header, start) = checkpoint::header(&bytes)?;
    header.validate_owner()?;
    let mut retained = header.descriptors();
    retained.push(file.as_raw_fd());
    descriptors::protect(&retained)?;
    match initialize(&header, &bytes, start, recovery) {
        Ok(ready) => {
            // No fallible initialization remains. Originals have no owning Rust wrappers;
            // Ready holds distinct duplicates of the same listener/lock descriptions.
            // SAFETY: the one restored host has activated; each original is released once.
            unsafe {
                header.roots.release_primaries();
            }
            drop(file);
            drop(bytes);
            ready.manager.clean();
            crate::server::serve(ready.runtime, ready.resources, ready.host, ready.manager)
        }
        Err(_) if !recovery => {
            eprintln!("target initialization failed; activation was unsuccessful; attempting retained compatible image");
            file.seek(SeekFrom::Start(0)).map_err(|_| fatal())?;
            let _inheritance = descriptors::Inheritance::prepare(&retained).map_err(|_| fatal())?;
            let _error = std::process::Command::new(&header.recovery.path)
                .arg("--resume")
                .arg(file.as_raw_fd().to_string())
                .arg("recovery")
                .env_clear()
                .exec();
            Err(fatal())
        }
        Err(_) => Err(fatal()),
    }
}
fn initialize(
    header: &checkpoint::Header,
    bytes: &[u8],
    start: usize,
    recovery: bool,
) -> Result<Ready, Error> {
    let expected = if recovery {
        &header.recovery
    } else {
        &header.target
    };
    if version::current()? != expected.version
        || images::digest(&std::env::current_exe().map_err(|_| Error::Version)?)? != expected.sha256
    {
        eprintln!("replacement initialization image identity mismatch");
        return Err(Error::Version);
    }
    let body = stage("checkpoint decode", checkpoint::body(header, bytes, start))?;
    stage("checkpoint validation", header.validate_state(&body))?;
    let runtime = stage(
        "runtime metadata",
        RuntimeDirectory::reopen(&header.root, &header.credentials),
    )?;
    let resources = stage(
        "retained listeners and lock",
        header.roots.restore(
            runtime.path(),
            &runtime.socket_path(),
            header.agent_runtime.port,
        ),
    )?;
    let mut host = stage(
        "host resources",
        Host::restore(
            body.host,
            header.credentials.installation.clone(),
            header.agent_runtime.clone(),
        ),
    )?;
    #[cfg(feature = "replacement-fixtures")]
    if !recovery && IMAGE_VERSION.ends_with("/openforge-session-daemon-fixture-init-fails") {
        return Err(Error::RecoveryUnavailable);
    }
    let manager = stage(
        "replacement ledger",
        Manager::restored(
            body.manager,
            &header.operation,
            recovery,
            runtime.path().join("images"),
        ),
    )?;
    let notifications = stage(
        "notification journal reopen",
        crate::notification_journal::NotificationJournal::open(
            &runtime.path().join("notifications.sqlite"),
        ),
    )?;
    stage(
        "notification journal identity",
        header.notifications.validate(),
    )?;
    stage(
        "gateway readiness",
        crate::server::start_gateway(&resources, &host, notifications),
    )?;
    // SAFETY: all models, input queues, descriptor identities, discovery, credentials,
    // journal and gateway readiness have passed. Ingress/readers are still paused and
    // no previous image's Rust wrappers exist. Activation's only lock precedes ownership.
    unsafe {
        host.activate_restored()?;
    }
    Ok(Ready {
        runtime,
        resources,
        host,
        manager,
    })
}
fn stage<T>(label: &'static str, result: Result<T, Error>) -> Result<T, Error> {
    result.inspect_err(|_| eprintln!("replacement initialization failed at {label}"))
}

fn fatal() -> Error {
    Error::Host("in-place recovery could not initialize; fatal loss of this sole PTY owner cannot be recovered".into())
}
