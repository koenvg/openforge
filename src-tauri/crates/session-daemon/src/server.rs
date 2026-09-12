use crate::host::Host;
use openforge_session_client::runtime::{check_peer, io_error, RuntimeDirectory};
use openforge_session_protocol::*;
use std::os::unix::{fs::PermissionsExt, net::UnixListener};
use std::time::Duration;
use subtle::ConstantTimeEq;

pub fn run() -> Result<(), Error> {
    let root = std::env::args_os().nth(1).ok_or(Error::InvalidRequest)?;
    let runtime = RuntimeDirectory::open(std::path::Path::new(&root))?;
    let _ownership = runtime.claim()?;
    let socket = runtime.socket_path();
    if socket.try_exists().map_err(io_error)? {
        runtime.check_socket()?;
        std::fs::remove_file(&socket).map_err(io_error)?;
    }
    let listener = UnixListener::bind(&socket).map_err(io_error)?;
    std::fs::set_permissions(&socket, std::fs::Permissions::from_mode(0o600)).map_err(io_error)?;
    listener.set_nonblocking(true).map_err(io_error)?;
    let agent_listener =
        std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).map_err(io_error)?;
    let agent_runtime = crate::agent_config::AgentRuntime {
        directory: runtime.path().to_path_buf(),
        port: agent_listener.local_addr().map_err(io_error)?.port(),
    };
    let mut host = Host::new(runtime.credentials().installation.clone(), agent_runtime)?;
    let notifications = crate::notification_journal::NotificationJournal::open(
        &runtime.path().join("notifications.sqlite"),
    )?;
    crate::agent_gateway::start(
        agent_listener,
        host.backend.clone(),
        host.sidecar.clone(),
        notifications,
    )?;
    eprintln!("session daemon ready");
    loop {
        host.poll()?;
        let mut stream = match listener.accept() {
            Ok((stream, _)) => stream,
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(5));
                continue;
            }
            Err(error) => return Err(io_error(error)),
        };
        if check_peer(&stream).is_err() {
            continue;
        }
        // A peer may disappear between accept and socket configuration. That closes
        // this connection, not the daemon or any of its live PTYs.
        if stream
            .set_nonblocking(false)
            .and_then(|()| stream.set_read_timeout(Some(Duration::from_secs(1))))
            .and_then(|()| stream.set_write_timeout(Some(Duration::from_secs(1))))
            .is_err()
        {
            continue;
        }
        let result = read_frame::<_, Request>(&mut stream).and_then(|request| {
            if !bool::from(
                request
                    .token
                    .as_bytes()
                    .ct_eq(runtime.credentials().token.as_bytes()),
            ) {
                return Err(Error::Unauthorized);
            }
            host.handle(request.command)
        });
        if host.shutdown {
            std::fs::remove_file(&socket).map_err(io_error)?;
        }
        // A lost reply does not roll back an accepted operation or controller generation.
        let _ = write_frame(
            &mut stream,
            &Envelope {
                version: VERSION,
                body: result,
            },
        );
        if host.shutdown {
            return Ok(());
        }
    }
}
