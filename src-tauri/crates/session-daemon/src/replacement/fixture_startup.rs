//! Only the explicitly built startup fixture holds image-probe readiness.
use openforge_session_protocol::Error;
use std::{
    io::{Read, Write},
    os::unix::net::UnixStream,
    time::Duration,
};

pub(super) fn before_readiness() -> Result<(), Error> {
    if env!("CARGO_BIN_NAME") != "openforge-session-daemon-fixture-startup" {
        return Ok(());
    }
    let executable = std::env::current_exe().map_err(|_| Error::UnsupportedReplacement)?;
    let images = executable.parent().ok_or(Error::UnsupportedReplacement)?;
    if images.file_name().is_none_or(|name| name != "images") {
        return Ok(());
    }
    let runtime = images.parent().ok_or(Error::UnsupportedReplacement)?;
    let mut stream = match UnixStream::connect(runtime.join("bootstrap-gate.sock")) {
        Ok(stream) => stream,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(Error::UnsupportedReplacement),
    };
    stream
        .set_read_timeout(Some(Duration::from_secs(30)))
        .map_err(|_| Error::UnsupportedReplacement)?;
    stream
        .write_all(b"entered")
        .map_err(|_| Error::UnsupportedReplacement)?;
    let mut allowed = [0];
    stream
        .read_exact(&mut allowed)
        .map_err(|_| Error::UnsupportedReplacement)?;
    if allowed == [1] {
        Ok(())
    } else {
        Err(Error::UnsupportedReplacement)
    }
}
