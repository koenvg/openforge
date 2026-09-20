use super::{secure_open, DocumentPreviewRead, Operation, MAX_DOCUMENT_PREVIEW_BYTES};
use base64::Engine;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

pub(super) fn read(
    root: &Path,
    path: &str,
    operation: &Operation,
) -> Result<DocumentPreviewRead, String> {
    operation.checkpoint()?;
    let mut file = secure_open::open(root, path, operation)?;
    operation.checkpoint()?;
    let metadata = file.metadata().map_err(secure_open::io_error)?;
    if metadata.len() > MAX_DOCUMENT_PREVIEW_BYTES {
        return Ok(unavailable("too-large", metadata.len()));
    }
    if !Path::new(path)
        .extension()
        .is_some_and(|ext| ext.eq_ignore_ascii_case("pdf"))
    {
        return Ok(unavailable("unsupported-format", metadata.len()));
    }
    #[cfg(test)]
    operation.observe(super::ReadStage::BeforeRead);
    let mut bytes = Vec::new();
    let mut chunk = [0; 64 * 1024];
    loop {
        operation.checkpoint()?;
        let remaining = usize::try_from(MAX_DOCUMENT_PREVIEW_BYTES + 1).map_err(|_| {
            "DOCUMENT_PREVIEW_UNAVAILABLE_HOST: document limit unsupported".to_string()
        })? - bytes.len();
        if remaining == 0 {
            break;
        }
        let length = chunk.len().min(remaining);
        let count = match file.read(&mut chunk[..length]) {
            Ok(count) => count,
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(error) => return Err(secure_open::io_error(error)),
        };
        if count == 0 {
            break;
        }
        bytes.extend_from_slice(&chunk[..count]);
    }
    operation.checkpoint()?;
    if bytes.len() as u64 > MAX_DOCUMENT_PREVIEW_BYTES {
        return Ok(unavailable("too-large", bytes.len() as u64));
    }
    let after = file.metadata().map_err(secure_open::io_error)?;
    if after.len() > MAX_DOCUMENT_PREVIEW_BYTES {
        return Ok(unavailable("too-large", after.len()));
    }
    if metadata_changed(&metadata, &after) || bytes.len() as u64 != metadata.len() {
        return Err("DOCUMENT_PREVIEW_CHANGED: document changed during reading".into());
    }
    if !bytes[..bytes.len().min(1024)]
        .windows(5)
        .any(|part| part == b"%PDF-")
    {
        return Ok(unavailable("invalid-document", bytes.len() as u64));
    }
    Ok(DocumentPreviewRead::Ready {
        mime_type: "application/pdf",
        encoding: "base64",
        size: bytes.len() as u64,
        revision: format!("{:x}", Sha256::digest(&bytes)),
        modified_at: metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .and_then(|time| u64::try_from(time.as_millis()).ok()),
        data: base64::engine::general_purpose::STANDARD.encode(&bytes),
    })
}

fn unavailable(reason: &'static str, size: u64) -> DocumentPreviewRead {
    DocumentPreviewRead::Unavailable {
        reason,
        size,
        max_bytes: MAX_DOCUMENT_PREVIEW_BYTES,
    }
}

fn metadata_changed(before: &std::fs::Metadata, after: &std::fs::Metadata) -> bool {
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return true;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if (before.ctime(), before.ctime_nsec(), before.nlink())
            != (after.ctime(), after.ctime_nsec(), after.nlink())
        {
            return true;
        }
    }
    false
}
