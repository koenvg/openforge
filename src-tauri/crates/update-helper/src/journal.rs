use crate::{authorization::decode_mac, files};
use ring::{
    hmac,
    rand::{SecureRandom, SystemRandom},
};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Phase {
    Prepared,
    Replacing,
    Installed,
    LaunchStarted,
    Committed,
    /// A committed install has started a new, uncommitted recovery launch.
    RelaunchStarted,
    RolledBack,
}

impl Phase {
    pub(crate) fn awaiting_commit(self) -> bool {
        matches!(self, Self::LaunchStarted | Self::RelaunchStarted)
    }

    pub(crate) fn may_own_domain(self) -> bool {
        self.awaiting_commit() || self == Self::Committed
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Record {
    pub version: u32,
    pub installation: String,
    pub destination: PathBuf,
    pub operation: String,
    pub authorization: PathBuf,
    pub staging: PathBuf,
    pub target_hash: String,
    pub previous_hash: String,
    pub phase: Phase,
    pub runtime: Option<crate::runtime_update::RuntimePlan>,
    pub cold_installation: Option<openforge_session_protocol::InstallationId>,
    #[serde(default)]
    pub launch_attempt: u32,
    #[serde(default)]
    pub launch_gate: Option<crate::launch_gate::Gate>,
    #[serde(default)]
    pub exchange_path: Option<PathBuf>,
    pub launched: Option<crate::process_identity::ProcessIdentity>,
    pub sidecar: Option<crate::process_identity::ProcessIdentity>,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    mac: String,
}

const CONTEXT: &[u8] = b"openforge-update-journal-v1\0";

pub(crate) fn initialize(root: &Path) -> Result<(), String> {
    let path = root.join("journal.key");
    if !path.try_exists().map_err(|e| e.to_string())? {
        // A missing key must not make an existing journal trusted again.
        if root
            .join("current.json")
            .try_exists()
            .map_err(|e| e.to_string())?
        {
            return Err("missing recovery key".into());
        }
        let mut key = [0_u8; 32];
        SystemRandom::new()
            .fill(&mut key)
            .map_err(|_| "cannot generate recovery key")?;
        files::write_new(&path, &key)?;
    }
    key(root).map(|_| ())
}

fn key(root: &Path) -> Result<hmac::Key, String> {
    let bytes = files::read_private(&root.join("journal.key"), 32)?;
    if bytes.len() != 32 {
        return Err("invalid recovery key".into());
    }
    Ok(hmac::Key::new(hmac::HMAC_SHA256, &bytes))
}

pub(crate) fn read(root: &Path) -> Result<Option<Record>, String> {
    let path = root.join("current.json");
    match std::fs::symlink_metadata(&path) {
        Ok(metadata) if metadata.is_file() => {}
        Ok(_) => return Err("unsafe recovery record".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    }
    let envelope: Envelope = serde_json::from_slice(&files::read_private(&path, 32 * 1024)?)
        .map_err(|_| "invalid recovery record")?;
    hmac::verify(
        &key(root)?,
        &[CONTEXT, envelope.payload.as_bytes()].concat(),
        &decode_mac(&envelope.mac)?,
    )
    .map_err(|_| "invalid recovery authentication")?;
    serde_json::from_str(&envelope.payload)
        .map(Some)
        .map_err(|_| "invalid recovery payload".into())
}

pub(crate) fn write(root: &Path, record: &Record) -> Result<(), String> {
    let payload = serde_json::to_string(record).map_err(|e| e.to_string())?;
    let tag = hmac::sign(&key(root)?, &[CONTEXT, payload.as_bytes()].concat());
    let mac = tag.as_ref().iter().map(|b| format!("{b:02x}")).collect();
    files::write_atomic(
        &root.join("current.json"),
        &serde_json::to_vec(&Envelope { payload, mac }).map_err(|e| e.to_string())?,
    )
}
