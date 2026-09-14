//! Agent identity for headless generations, which have no PTY to borrow one from.
use serde::Serialize;
use std::{
    collections::HashSet,
    fs::{self, DirBuilder, OpenOptions, Permissions},
    os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard, PoisonError},
};
use subtle::ConstantTimeEq;

/// `openforge-cli/agent-config.js` refuses a credential whose directory is not
/// exactly this mode, or whose file is not exactly `FILE_MODE`.
const DIRECTORY_MODE: u32 = 0o700;
const FILE_MODE: u32 = 0o600;

pub(crate) const CREDENTIAL_DIRECTORY_NAME: &str = "agent-generations";

#[derive(Serialize)]
struct CredentialFile<'a> {
    version: u32,
    port: u16,
    token: &'a str,
}

struct Endpoint {
    directory: PathBuf,
    port: u16,
}

#[derive(Default)]
struct Inner {
    endpoint: Option<Endpoint>,
    live: HashSet<String>,
}

#[derive(Clone, Default)]
pub(crate) struct GenerationIdentities(Arc<Mutex<Inner>>);

impl GenerationIdentities {
    pub(crate) fn activate(&self, directory: PathBuf, port: u16) -> Result<(), String> {
        if let Some(parent) = directory.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("agent credential root unavailable: {error}"))?;
        }
        match DirBuilder::new().mode(DIRECTORY_MODE).create(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => {
                return Err(format!(
                    "agent credential directory could not be created: {error}"
                ))
            }
        }
        // A symlink here would redirect both the tightening below and the sweep
        // that follows it onto somebody else's directory.
        if !fs::symlink_metadata(&directory)
            .map_err(|error| format!("agent credential directory is unreadable: {error}"))?
            .is_dir()
        {
            return Err("agent credential directory is not a directory".to_string());
        }
        // `DirBuilder::mode` is masked by the umask, which the CLI would then refuse.
        fs::set_permissions(&directory, Permissions::from_mode(DIRECTORY_MODE))
            .map_err(|error| format!("agent credential directory could not be secured: {error}"))?;
        // No credential survives a restart, so anything already here is a leftover.
        if let Ok(entries) = fs::read_dir(&directory) {
            for entry in entries.flatten() {
                let _ = fs::remove_file(entry.path());
            }
        }
        lock(&self.0).endpoint = Some(Endpoint { directory, port });
        Ok(())
    }

    pub(crate) fn issue(&self) -> Result<GenerationCredential, String> {
        let (directory, port) = {
            let inner = lock(&self.0);
            let endpoint = inner
                .endpoint
                .as_ref()
                .ok_or_else(|| "agent credentials are not available".to_string())?;
            (endpoint.directory.clone(), endpoint.port)
        };
        let token = format!(
            "{}{}",
            uuid::Uuid::new_v4().simple(),
            uuid::Uuid::new_v4().simple()
        );
        let path = directory.join(format!("generation-{}.json", uuid::Uuid::new_v4()));
        write_private_file(
            &path,
            &CredentialFile {
                version: 1,
                port,
                token: &token,
            },
        )?;
        lock(&self.0).live.insert(token.clone());
        Ok(GenerationCredential {
            path,
            token,
            identities: Arc::clone(&self.0),
        })
    }

    pub(crate) fn authorizes(&self, token: &str) -> bool {
        lock(&self.0)
            .live
            .iter()
            .any(|live| bool::from(live.as_bytes().ct_eq(token.as_bytes())))
    }
}

pub(crate) struct GenerationCredential {
    path: PathBuf,
    token: String,
    identities: Arc<Mutex<Inner>>,
}

impl GenerationCredential {
    pub(crate) fn config_path(&self) -> &Path {
        &self.path
    }

    #[cfg(test)]
    pub(crate) fn token(&self) -> &str {
        &self.token
    }
}

impl Drop for GenerationCredential {
    fn drop(&mut self) {
        lock(&self.identities).live.remove(&self.token);
        let _ = fs::remove_file(&self.path);
    }
}

/// A panic elsewhere must never leave a token authorized, so poisoning is
/// recovered from rather than propagated.
fn lock(inner: &Mutex<Inner>) -> MutexGuard<'_, Inner> {
    inner.lock().unwrap_or_else(PoisonError::into_inner)
}

fn write_private_file(path: &Path, contents: &CredentialFile<'_>) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(FILE_MODE)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(|error| format!("agent credential could not be written: {error}"))?;
    serde_json::to_writer(&mut file, contents)
        .map_err(|error| format!("agent credential could not be serialized: {error}"))
        .and_then(|()| {
            file.sync_all()
                .map_err(|error| format!("agent credential could not be flushed: {error}"))
        })
        .inspect_err(|_| {
            let _ = fs::remove_file(path);
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn activated(port: u16) -> (GenerationIdentities, tempfile::TempDir) {
        let root = tempfile::tempdir().expect("credential root");
        let identities = GenerationIdentities::default();
        identities
            .activate(root.path().join(CREDENTIAL_DIRECTORY_NAME), port)
            .expect("activate");
        (identities, root)
    }

    fn parsed(credential: &GenerationCredential) -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(credential.config_path()).expect("credential"))
            .expect("credential JSON")
    }

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).expect("metadata").permissions().mode() & 0o777
    }

    #[test]
    fn an_issued_credential_is_readable_by_the_cli_agent_transport() {
        let (identities, _root) = activated(41234);
        let credential = identities.issue().expect("issue");

        let config = parsed(&credential);
        assert_eq!(config["version"], 1);
        assert_eq!(config["port"], 41234);
        let token = config["token"].as_str().expect("token");
        assert_eq!(token.len(), 64);
        assert!(token
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_uppercase()));

        assert_eq!(
            mode_of(credential.config_path().parent().expect("directory")),
            DIRECTORY_MODE
        );
        assert_eq!(mode_of(credential.config_path()), FILE_MODE);
        assert!(fs::metadata(credential.config_path()).expect("file").len() <= 4096);
        assert!(credential.config_path().is_absolute());
    }

    #[test]
    fn a_live_credential_authorizes_only_its_own_token() {
        let (identities, _root) = activated(1);
        let credential = identities.issue().expect("issue");
        let other = identities.issue().expect("second issue");

        assert!(identities.authorizes(credential.token()));
        assert!(identities.authorizes(other.token()));
        assert_ne!(credential.token(), other.token());
        assert_ne!(credential.config_path(), other.config_path());
        assert!(!identities.authorizes("f".repeat(64).as_str()));
    }

    #[test]
    fn dropping_a_credential_revokes_the_token_and_deletes_the_file() {
        let (identities, _root) = activated(1);
        let credential = identities.issue().expect("issue");
        let token = credential.token().to_string();
        let path = credential.config_path().to_path_buf();

        drop(credential);

        assert!(!identities.authorizes(&token));
        assert!(!path.exists());
    }

    #[test]
    fn an_inactive_registry_issues_nothing_and_authorizes_nothing() {
        let identities = GenerationIdentities::default();
        assert!(identities.issue().is_err());
        assert!(!identities.authorizes(""));
        assert!(!identities.authorizes(&"a".repeat(64)));
    }

    #[test]
    fn activating_clears_credentials_a_previous_run_left_behind() {
        let root = tempfile::tempdir().expect("credential root");
        let directory = root.path().join(CREDENTIAL_DIRECTORY_NAME);
        fs::create_dir_all(&directory).expect("directory");
        let leftover = directory.join("generation-crashed.json");
        fs::write(&leftover, "{}").expect("leftover credential");

        GenerationIdentities::default()
            .activate(directory, 1)
            .expect("activate");

        assert!(!leftover.exists());
    }

    #[test]
    fn activating_tightens_a_loose_directory() {
        let root = tempfile::tempdir().expect("credential root");
        let directory = root.path().join(CREDENTIAL_DIRECTORY_NAME);
        fs::create_dir_all(&directory).expect("pre-existing directory");
        fs::set_permissions(&directory, Permissions::from_mode(0o755)).expect("loosen");

        GenerationIdentities::default()
            .activate(directory.clone(), 7)
            .expect("activate");

        assert_eq!(mode_of(&directory), DIRECTORY_MODE);
    }

    #[test]
    fn activating_over_a_symlink_is_refused_and_leaves_the_target_alone() {
        let root = tempfile::tempdir().expect("credential root");
        let target = root.path().join("somebody-elses");
        fs::create_dir_all(&target).expect("target");
        let victim = target.join("keep-me");
        fs::write(&victim, "private").expect("victim");
        fs::set_permissions(&target, Permissions::from_mode(0o755)).expect("target mode");
        let directory = root.path().join(CREDENTIAL_DIRECTORY_NAME);
        std::os::unix::fs::symlink(&target, &directory).expect("symlink");

        let identities = GenerationIdentities::default();
        assert!(identities.activate(directory, 1).is_err());

        assert!(victim.exists());
        assert_eq!(mode_of(&target), 0o755);
        assert!(identities.issue().is_err());
    }
}
