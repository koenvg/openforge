//! Versioned local Session Daemon protocol. Contains no Task or plugin behavior.
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::io::{Read, Write};

mod agent;
mod agent_routes;
pub use agent::*;
pub use agent_routes::agent_route_allowed;
mod host_error;
mod notification;
pub use notification::*;
mod messages;
pub use messages::*;

pub const VERSION: u32 = 1;
pub const MAX_FRAME_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(rename_all = "camelCase")]
pub enum Error {
    #[error("unsupported session protocol version")]
    Version,
    #[error("session capacity exhausted; request not executed")]
    Capacity,
    #[error("foreign installation")]
    ForeignInstallation,
    #[error("stale controller")]
    StaleController,
    #[error("authentication failed")]
    Unauthorized,
    #[error("daemon already running")]
    AlreadyRunning,
    #[error("stale PTY identity")]
    StalePty,
    #[error("stale output position")]
    StaleOutput,
    #[error("live executable replacement is unsupported")]
    UnsupportedReplacement,
    #[error("operation identity reused with a different request")]
    OperationConflict,
    #[error("input sequence is out of order")]
    OutOfOrder,
    #[error("operation outcome unknown; reconcile before another operation")]
    OutcomeUnknown,
    #[error("terminal recovery unavailable")]
    RecoveryUnavailable,
    #[error("session host: {0}")]
    Host(String),
    #[error("invalid session request")]
    InvalidRequest,
    #[error("session transport: {0}")]
    Transport(String),
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Envelope<T> {
    pub version: u32,
    pub body: T,
}

/// Reads one length-prefixed JSON frame. The length is checked before allocation.
///
/// # Errors
/// Rejects oversized frames, unsupported versions, invalid JSON and truncated I/O.
pub fn read_frame<R: Read, T: DeserializeOwned>(reader: &mut R) -> Result<T, Error> {
    let mut size = [0; 4];
    reader.read_exact(&mut size).map_err(transport)?;
    let size = u32::from_be_bytes(size) as usize;
    if size > MAX_FRAME_BYTES {
        return Err(Error::Capacity);
    }
    let mut bytes = vec![0; size];
    reader.read_exact(&mut bytes).map_err(transport)?;
    let envelope: Envelope<serde_json::Value> =
        serde_json::from_slice(&bytes).map_err(|_| Error::InvalidRequest)?;
    if envelope.version != VERSION {
        return Err(Error::Version);
    }
    serde_json::from_value(envelope.body).map_err(|_| Error::InvalidRequest)
}

/// Writes one bounded length-prefixed frame.
///
/// # Errors
/// Rejects values exceeding the frame budget and reports transport errors.
pub fn write_frame<W: Write, T: Serialize>(
    writer: &mut W,
    envelope: &Envelope<T>,
) -> Result<(), Error> {
    let mut bytes = LimitedBytes(Vec::new());
    serde_json::to_writer(&mut bytes, envelope).map_err(|_| Error::Capacity)?;
    let size = u32::try_from(bytes.0.len()).map_err(|_| Error::Capacity)?;
    writer.write_all(&size.to_be_bytes()).map_err(transport)?;
    writer.write_all(&bytes.0).map_err(transport)?;
    writer.flush().map_err(transport)
}

struct LimitedBytes(Vec<u8>);
impl Write for LimitedBytes {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) > MAX_FRAME_BYTES {
            return Err(std::io::Error::other("frame capacity"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

fn transport(error: std::io::Error) -> Error {
    Error::Transport(error.to_string())
}
