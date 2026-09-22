use crate::files;
use ring::hmac;
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Authorization {
    pub version: u32,
    pub installation_id: String,
    pub operation_id: String,
    pub installed_bundle_path: PathBuf,
    pub source: String,
    pub manifest_sha256: String,
    pub bundle_path: PathBuf,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    payload: String,
    mac: String,
}

pub(crate) fn identity(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-')
    {
        return Err("invalid update identity".into());
    }
    Ok(())
}

pub(crate) fn read(
    root: &Path,
    operation: &str,
    installation: &str,
    destination: &Path,
    staging: &Path,
) -> Result<Authorization, String> {
    identity(operation)?;
    files::check_private_directory(root)?;
    let key = files::read_private(&root.join("authorization.key"), 32)?;
    if key.len() != 32 {
        return Err("invalid update authorization key".into());
    }
    let bytes = files::read_private(&root.join(format!("{operation}.json")), 16 * 1024)?;
    let envelope: Envelope =
        serde_json::from_slice(&bytes).map_err(|_| "invalid authorization envelope")?;
    let tag = decode_mac(&envelope.mac)?;
    let message = [
        b"openforge-update-authorization-v1\0".as_slice(),
        envelope.payload.as_bytes(),
    ]
    .concat();
    hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, &key), &message, &tag)
        .map_err(|_| "invalid update authorization authentication")?;
    let record: Authorization =
        serde_json::from_str(&envelope.payload).map_err(|_| "invalid update authorization")?;
    let name = record
        .bundle_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or_default();
    let staged_name = name
        .strip_prefix("bundle-")
        .and_then(|n| n.strip_suffix(".app"));
    if record.version != 1
        || record.operation_id != operation
        || record.installation_id != installation
        || !record.installed_bundle_path.is_absolute()
        || canonical_destination(&record.installed_bundle_path)? != destination
        || !matches!(record.source.as_str(), "local-build" | "published")
        || record.bundle_path.parent() != Some(staging)
        || !staged_name.is_some_and(|s| {
            !s.is_empty()
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b) || b == b'-')
        })
        || decode_mac(&record.manifest_sha256).is_err()
    {
        return Err("invalid update authorization identity".into());
    }
    files::check_private_directory(staging)?;
    Ok(record)
}

fn canonical_destination(path: &Path) -> Result<PathBuf, String> {
    let parent = path.parent().ok_or("invalid authorized destination")?;
    let name = path.file_name().ok_or("invalid authorized destination")?;
    Ok(parent.canonicalize().map_err(|e| e.to_string())?.join(name))
}

pub(crate) fn decode_mac(value: &str) -> Result<Vec<u8>, String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("invalid update digest".into());
    }
    (0..64)
        .step_by(2)
        .map(|i| {
            u8::from_str_radix(&value[i..i + 2], 16).map_err(|_| "invalid update digest".into())
        })
        .collect()
}
