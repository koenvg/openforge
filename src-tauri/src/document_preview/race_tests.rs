use super::*;
use base64::Engine;
use std::sync::Arc;

#[cfg(unix)]
#[tokio::test]
async fn replaced_components_cannot_redirect_an_authorized_read() {
    use std::os::unix::fs::symlink;
    for swap_before_component in [0, 1] {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("docs")).unwrap();
        std::fs::write(root.path().join("docs/a.pdf"), b"%PDF-1.7 authorized").unwrap();
        std::fs::write(outside.path().join("a.pdf"), b"%PDF-1.7 outside secret").unwrap();
        let path = root.path().to_path_buf();
        let destination = outside.path().to_path_buf();
        let reader = DocumentReader::new(READ_DEADLINE).with_hook(Arc::new(move |stage| {
            if stage == ReadStage::BeforeComponent(swap_before_component) {
                std::fs::rename(path.join("docs"), path.join("pinned")).unwrap();
                symlink(&destination, path.join("docs")).unwrap();
            }
        }));
        let result = reader.read(root.path().into(), "docs/a.pdf".into()).await;
        match result {
            Err(error) => assert!(error.starts_with("DOCUMENT_PREVIEW_FORBIDDEN:"), "{error}"),
            Ok(response) => {
                assert_eq!(
                    swap_before_component, 1,
                    "unopened link must not be followed"
                );
                let DocumentPreviewRead::Ready { data, .. } = response.document else {
                    panic!("expected ready")
                };
                assert_eq!(
                    base64::engine::general_purpose::STANDARD
                        .decode(data)
                        .unwrap(),
                    b"%PDF-1.7 authorized"
                );
            }
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn final_component_swap_is_rejected_and_fifos_do_not_wait_for_a_writer() {
    let root = tempfile::tempdir().unwrap();
    std::fs::create_dir(root.path().join("docs")).unwrap();
    std::fs::write(root.path().join("docs/a.pdf"), b"%PDF-1.7").unwrap();
    let outside = tempfile::NamedTempFile::new().unwrap();
    let path = root.path().join("docs/a.pdf");
    let target = outside.path().to_path_buf();
    let reader = DocumentReader::new(READ_DEADLINE).with_hook(Arc::new(move |stage| {
        if stage == ReadStage::BeforeComponent(1) {
            std::fs::remove_file(&path).unwrap();
            std::os::unix::fs::symlink(&target, &path).unwrap();
        }
    }));
    let error = reader
        .read(root.path().into(), "docs/a.pdf".into())
        .await
        .err()
        .unwrap();
    assert!(error.starts_with("DOCUMENT_PREVIEW_FORBIDDEN:"));
    use std::os::unix::ffi::OsStrExt;
    let fifo = std::ffi::CString::new(root.path().join("pipe.pdf").as_os_str().as_bytes()).unwrap();
    // SAFETY: fifo is a live NUL-terminated path; mkfifo retains no pointer.
    assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
    let reader = DocumentReader::new(READ_DEADLINE);
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        reader.read(root.path().into(), "pipe.pdf".into()),
    )
    .await
    .unwrap();
    assert!(result
        .err()
        .unwrap()
        .starts_with("DOCUMENT_PREVIEW_FORBIDDEN:"));
}

#[tokio::test]
async fn observed_changes_reject_bytes_and_growth_over_limit_takes_precedence() {
    for mutation in ["grow", "shrink", "rewrite", "replace", "over-limit"] {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("a.pdf");
        std::fs::write(&path, b"%PDF-1.7 original").unwrap();
        let reader = DocumentReader::new(READ_DEADLINE).with_hook(Arc::new(move |stage| {
            if stage == ReadStage::BeforeRead {
                match mutation {
                    "grow" => std::fs::write(&path, b"%PDF-1.7 longer changed bytes").unwrap(),
                    "shrink" => std::fs::write(&path, b"%PDF-1.7").unwrap(),
                    "rewrite" => std::fs::write(&path, b"%PDF-1.7 modified").unwrap(),
                    "replace" => {
                        std::fs::remove_file(&path).unwrap();
                        std::fs::write(&path, b"%PDF-1.7 replaced").unwrap();
                    }
                    "over-limit" => std::fs::OpenOptions::new()
                        .write(true)
                        .open(&path)
                        .unwrap()
                        .set_len(16_777_217)
                        .unwrap(),
                    _ => unreachable!(),
                }
            }
        }));
        let result = reader.read(root.path().into(), "a.pdf".into()).await;
        if mutation == "over-limit" {
            let value = serde_json::to_value(result.unwrap().document).unwrap();
            assert_eq!(value["reason"], "too-large");
            assert_eq!(value["size"], 16_777_217);
            assert!(value.get("data").is_none());
        } else {
            assert!(
                result
                    .expect_err(mutation)
                    .starts_with("DOCUMENT_PREVIEW_CHANGED:"),
                "{mutation}"
            );
        }
    }
}

#[cfg(unix)]
#[tokio::test]
async fn replacing_the_workspace_root_at_the_same_path_rejects_old_bytes() {
    let parent = tempfile::tempdir().unwrap();
    let root = parent.path().join("workspace");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(root.join("a.pdf"), b"%PDF-old workspace").unwrap();
    let path = root.clone();
    let reader = DocumentReader::new(READ_DEADLINE).with_hook(Arc::new(move |stage| {
        if stage == ReadStage::BeforeRead {
            std::fs::rename(&path, path.with_file_name("old-workspace")).unwrap();
            std::fs::create_dir(&path).unwrap();
            std::fs::write(path.join("a.pdf"), b"%PDF-new workspace").unwrap();
        }
    }));
    let error = reader
        .read(root, "a.pdf".into())
        .await
        .expect_err("replaced root must not publish old bytes");
    assert!(error.starts_with("DOCUMENT_PREVIEW_CHANGED:"), "{error}");
}
