use ring::hmac;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
};

pub struct Fixture {
    pub _temp: tempfile::TempDir,
    pub destination: PathBuf,
    pub staging: PathBuf,
    pub bundle: PathBuf,
    pub authorization: PathBuf,
    pub state: PathBuf,
}

pub fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn bundle(root: &Path, version: &[u8]) -> String {
    let mut entries = vec![];
    for directory in [
        "",
        "Contents",
        "Contents/MacOS",
        "Contents/Resources",
        "Contents/Resources/app",
        "Contents/Resources/app/dist-electron",
        "Contents/Resources/openforge-cli",
    ] {
        fs::create_dir_all(root.join(directory)).unwrap();
        fs::set_permissions(root.join(directory), fs::Permissions::from_mode(0o755)).unwrap();
        entries.push(format!(
            "{{\"path\":{},\"kind\":\"directory\",\"mode\":493}}",
            serde_json::to_string(directory).unwrap()
        ));
    }
    for name in [
        "Contents/MacOS/Open Forge",
        "Contents/MacOS/openforge-sidecar",
        "Contents/MacOS/openforge-session-daemon",
        "Contents/MacOS/openforge-update-helper",
        "Contents/Resources/app/dist-electron/main.js",
        "Contents/Resources/openforge-cli/cli.js",
    ] {
        fs::write(root.join(name), version).unwrap();
        let mode = if name.contains("/MacOS/") {
            0o755
        } else {
            0o644
        };
        fs::set_permissions(root.join(name), fs::Permissions::from_mode(mode)).unwrap();
        entries.push(format!(
            "{{\"path\":{},\"kind\":\"file\",\"mode\":{},\"sha256\":\"{}\"}}",
            serde_json::to_string(name).unwrap(),
            mode,
            digest(version)
        ));
    }
    entries.sort_by_key(|s| {
        serde_json::from_str::<serde_json::Value>(s).unwrap()["path"]
            .as_str()
            .unwrap()
            .to_owned()
    });
    digest(format!("{{\"format\":1,\"entries\":[{}]}}", entries.join(",")).as_bytes())
}

impl Fixture {
    pub fn new() -> Self {
        Self::with_target_body("new")
    }

    pub fn with_target_body(body: &str) -> Self {
        Self::with_target_bytes(body.as_bytes())
    }

    pub fn with_target_bytes(body: &[u8]) -> Self {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().canonicalize().unwrap();
        let destination = root.join("Installed.app");
        bundle(&destination, b"old");
        let staging = root.join("staged");
        fs::create_dir(&staging).unwrap();
        fs::set_permissions(&staging, fs::Permissions::from_mode(0o700)).unwrap();
        let target = staging.join("bundle-11111111.app");
        let hash = bundle(&target, body);
        let authorization = root.join("authorization");
        fs::create_dir(&authorization).unwrap();
        fs::set_permissions(&authorization, fs::Permissions::from_mode(0o700)).unwrap();
        let key = [42_u8; 32];
        fs::write(authorization.join("authorization.key"), key).unwrap();
        fs::set_permissions(
            authorization.join("authorization.key"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        let payload = json!({"version":1,"installationId":"installation-one","operationId":"operation-one","installedBundlePath":destination,"source":"local-build","manifestSha256":hash,"bundlePath":target,
            "launch":{"electronUserData":root,"appData":root,"daemonRoot":root}}).to_string();
        let tag = hmac::sign(
            &hmac::Key::new(hmac::HMAC_SHA256, &key),
            &[
                b"openforge-update-authorization-v1\0".as_slice(),
                payload.as_bytes(),
            ]
            .concat(),
        );
        let mac = tag
            .as_ref()
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        fs::write(
            authorization.join("operation-one.json"),
            json!({"payload":payload,"mac":mac}).to_string(),
        )
        .unwrap();
        fs::set_permissions(
            authorization.join("operation-one.json"),
            fs::Permissions::from_mode(0o600),
        )
        .unwrap();
        Self {
            state: root.join("transaction"),
            _temp: temp,
            destination,
            staging,
            bundle: target,
            authorization,
        }
    }
}
