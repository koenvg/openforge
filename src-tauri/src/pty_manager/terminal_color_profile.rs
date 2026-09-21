use openforge_session_host::TerminalColorProfile;
use std::io::Write;
use std::path::{Path, PathBuf};

const PROFILE_FILE: &str = "terminal-color-profile.json";

pub(super) fn path(root: &Path) -> PathBuf {
    root.join(PROFILE_FILE)
}

pub(super) fn load(path: &Path) -> TerminalColorProfile {
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

pub(super) fn store(path: &Path, profile: TerminalColorProfile) -> Result<(), String> {
    profile.validate().map_err(|error| error.to_string())?;
    let parent = path
        .parent()
        .ok_or_else(|| "terminal colour profile path has no parent".to_string())?;
    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = parent.join(format!(".{PROFILE_FILE}.{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        serde_json::to_writer(&mut file, &profile).map_err(|error| error.to_string())?;
        file.write_all(b"\n").map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        std::fs::rename(&temporary, path).map_err(|error| error.to_string())?;
        std::fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use openforge_session_host::TerminalRgbColor;

    #[test]
    fn absent_and_corrupt_profiles_use_the_light_fallback() {
        let directory = tempfile::tempdir().unwrap();
        let profile_path = path(directory.path());
        assert_eq!(load(&profile_path), TerminalColorProfile::default());
        std::fs::write(&profile_path, b"not-json").unwrap();
        assert_eq!(load(&profile_path), TerminalColorProfile::default());
    }

    #[test]
    fn accepted_profile_is_stored_and_loaded_durably() {
        let directory = tempfile::tempdir().unwrap();
        let profile_path = path(directory.path());
        let profile = TerminalColorProfile {
            foreground: TerminalRgbColor::new(1, 2, 3),
            ..Default::default()
        };
        store(&profile_path, profile).unwrap();
        assert_eq!(load(&profile_path), profile);
    }
}
