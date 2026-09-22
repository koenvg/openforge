use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};

#[derive(Serialize)]
struct Entry {
    path: String,
    kind: &'static str,
    mode: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    sha256: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    target: Option<String>,
}

#[derive(Serialize)]
struct Manifest {
    format: u32,
    entries: Vec<Entry>,
}

pub(crate) fn measure(root: &Path) -> Result<String, String> {
    if !fs::symlink_metadata(root)
        .map_err(|e| e.to_string())?
        .is_dir()
    {
        return Err("bundle must be a real directory".into());
    }
    let canonical = root.canonicalize().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    let mut pending = vec![PathBuf::new()];
    let mut total = 0_u64;
    while let Some(relative) = pending.pop() {
        let path = root.join(&relative);
        let metadata = fs::symlink_metadata(&path).map_err(|e| e.to_string())?;
        let name = relative
            .to_str()
            .ok_or("bundle path is not UTF-8")?
            .to_owned();
        let mut entry = Entry {
            path: name,
            kind: "directory",
            mode: metadata.mode() & 0o777,
            sha256: None,
            target: None,
        };
        if metadata.is_symlink() {
            let target = fs::read_link(&path).map_err(|e| e.to_string())?;
            if target.is_absolute()
                || !path
                    .canonicalize()
                    .map_err(|e| e.to_string())?
                    .starts_with(&canonical)
            {
                return Err("bundle symlink escapes bundle".into());
            }
            entry.kind = "symlink";
            entry.mode = 0;
            entry.target = Some(
                target
                    .to_str()
                    .ok_or("bundle symlink is not UTF-8")?
                    .to_owned(),
            );
        } else if metadata.mode() & 0o7022 != 0 {
            return Err("unsafe bundle permissions".into());
        } else if metadata.is_dir() {
            for child in fs::read_dir(&path).map_err(|e| e.to_string())? {
                pending.push(relative.join(child.map_err(|e| e.to_string())?.file_name()));
                if entries.len() + pending.len() > 100_000 {
                    return Err("bundle entry limit exceeded".into());
                }
            }
            crate::files::sync_directory(&path)?;
        } else if metadata.is_file() {
            let mut file = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK | libc::O_CLOEXEC)
                .open(&path)
                .map_err(|e| e.to_string())?;
            let current = file.metadata().map_err(|e| e.to_string())?;
            if !current.is_file() || current.nlink() != 1 || current.mode() & 0o7022 != 0 {
                return Err("unsafe bundle file".into());
            }
            let mut hash = Sha256::new();
            let mut buffer = [0_u8; 64 * 1024];
            loop {
                let count = file.read(&mut buffer).map_err(|e| e.to_string())?;
                if count == 0 {
                    break;
                }
                total += count as u64;
                if total > 4 * 1024_u64.pow(3) {
                    return Err("bundle size limit exceeded".into());
                }
                hash.update(&buffer[..count]);
            }
            // Replacement must not publish bytes that exist only in the page cache.
            file.sync_all().map_err(|e| e.to_string())?;
            entry.kind = "file";
            entry.mode = current.mode() & 0o777;
            entry.sha256 = Some(format!("{:x}", hash.finalize()));
        } else {
            return Err("unsupported bundle file type".into());
        }
        entries.push(entry);
    }
    for (path, executable) in [
        ("Contents/MacOS/Open Forge", true),
        ("Contents/MacOS/openforge-sidecar", true),
        ("Contents/MacOS/openforge-session-daemon", true),
        ("Contents/MacOS/openforge-update-helper", true),
        ("Contents/Resources/app/dist-electron/main.js", false),
        ("Contents/Resources/openforge-cli/cli.js", false),
    ] {
        if !entries
            .iter()
            .any(|e| e.path == path && e.kind == "file" && (!executable || e.mode & 0o111 != 0))
        {
            return Err(format!("bundle is missing usable {path}"));
        }
    }
    // JavaScript's canonical manifest orders UTF-16 code units, not UTF-8 bytes.
    entries.sort_by(|a, b| a.path.encode_utf16().cmp(b.path.encode_utf16()));
    let bytes = serde_json::to_vec(&Manifest { format: 1, entries }).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(bytes)))
}
