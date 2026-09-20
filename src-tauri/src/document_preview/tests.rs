use super::*;
use base64::Engine;

// Policy tests do not compete with parallel tests for the process-wide limit.
// The lifecycle tests exercise admission using a shared reader instance.
async fn read_document(root: PathBuf, path: String) -> Result<DocumentResponse, String> {
    DocumentReader::new(READ_DEADLINE).read(root, path).await
}

#[tokio::test]
async fn explicit_pdf_read_returns_bytes_without_changing_metadata_only_preview() {
    let root = tempfile::tempdir().unwrap();
    let bytes = b"%PDF-1.7\nfixture bytes\n%%EOF";
    std::fs::write(root.path().join("report.PDF"), bytes).unwrap();

    let response = read_document(root.path().to_path_buf(), "report.PDF".into())
        .await
        .unwrap();
    let value = serde_json::to_value(&response.document).unwrap();
    assert_eq!(value["status"], "ready");
    assert_eq!(value["mimeType"], "application/pdf");
    assert_eq!(value["encoding"], "base64");
    assert_eq!(value["size"], bytes.len());
    assert!(value["modifiedAt"].is_number());
    assert!(!value["revision"].as_str().unwrap().is_empty());
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(value["data"].as_str().unwrap())
            .unwrap(),
        bytes
    );

    let metadata = crate::project_fs::read_file_preview(root.path(), "report.PDF")
        .await
        .unwrap();
    assert_eq!(metadata.r#type, "document");
    assert_eq!(metadata.mime_type.as_deref(), Some("application/pdf"));
    assert!(metadata.content.is_empty());
}

#[tokio::test]
async fn document_size_and_format_policy_never_returns_unavailable_bytes() {
    let root = tempfile::tempdir().unwrap();
    for (name, bytes, reason) in [
        ("empty.pdf", Vec::new(), "invalid-document"),
        ("invalid.pdf", b"not a PDF".to_vec(), "invalid-document"),
        ("wrong.txt", b"%PDF-1.7".to_vec(), "unsupported-format"),
        (
            "late.pdf",
            [vec![b' '; 1024], b"%PDF-1.7".to_vec()].concat(),
            "invalid-document",
        ),
        (
            "huge.pdf",
            [b"%PDF-1.7".to_vec(), vec![0; 16_777_217 - 8]].concat(),
            "too-large",
        ),
    ] {
        std::fs::write(root.path().join(name), &bytes).unwrap();
        let response = read_document(root.path().to_path_buf(), name.into())
            .await
            .unwrap();
        let value = serde_json::to_value(&response.document).unwrap();
        assert_eq!(
            value,
            serde_json::json!({
                "status": "unavailable", "reason": reason,
                "size": bytes.len(), "maxBytes": 16_777_216,
            }),
            "{name}"
        );
    }
    let mut bytes = vec![0; 16_777_216];
    bytes[..8].copy_from_slice(b"%PDF-1.7");
    std::fs::write(root.path().join("exact.pdf"), &bytes).unwrap();
    let response = read_document(root.path().to_path_buf(), "exact.pdf".into())
        .await
        .unwrap();
    let value = serde_json::to_value(&response.document).unwrap();
    assert_eq!(value["status"], "ready");
    assert_eq!(value["size"], 16_777_216);
    assert_eq!(value["data"].as_str().unwrap().len(), 22_369_624);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(value["data"].as_str().unwrap())
            .unwrap(),
        bytes
    );
}

#[tokio::test]
async fn rejects_untrusted_paths_and_sanitizes_missing_files() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("safe.pdf"), b"%PDF-1.7").unwrap();
    for path in [
        "",
        "../safe.pdf",
        "nested/../safe.pdf",
        "/safe.pdf",
        "C:report.pdf",
        "C:/report.pdf",
        "\\\\host\\share.pdf",
        "https://host/report.pdf",
        "file:///safe.pdf",
        "bad\0.pdf",
        "nested\\..\\safe.pdf",
    ] {
        let result = read_document(root.path().to_path_buf(), path.into()).await;
        let error = result.expect_err("unsafe path must fail");
        assert!(
            error.starts_with("DOCUMENT_PREVIEW_BAD_REQUEST:"),
            "{path:?}: {error}"
        );
        assert!(!error.contains(root.path().to_str().unwrap()));
    }
    let error = read_document(root.path().to_path_buf(), "missing.pdf".into())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with("DOCUMENT_PREVIEW_NOT_FOUND:"), "{error}");
}

#[cfg(unix)]
#[tokio::test]
async fn rejects_descendant_links_even_when_the_target_is_inside_the_root() {
    use std::os::unix::fs::symlink;
    let root = tempfile::tempdir().unwrap();
    let outside = tempfile::tempdir().unwrap();
    std::fs::write(outside.path().join("outside.pdf"), b"%PDF-1.7 outside").unwrap();
    std::fs::write(root.path().join("inside.pdf"), b"%PDF-1.7 inside").unwrap();
    symlink(outside.path(), root.path().join("linked-dir")).unwrap();
    symlink(
        outside.path().join("outside.pdf"),
        root.path().join("outside-link.pdf"),
    )
    .unwrap();
    symlink("inside.pdf", root.path().join("inside-link.pdf")).unwrap();
    for path in [
        "linked-dir/outside.pdf",
        "outside-link.pdf",
        "inside-link.pdf",
        ".",
    ] {
        let error = read_document(root.path().to_path_buf(), path.into())
            .await
            .expect_err("must reject links and directories");
        assert!(
            error.starts_with("DOCUMENT_PREVIEW_FORBIDDEN:"),
            "{path}: {error}"
        );
    }
}
