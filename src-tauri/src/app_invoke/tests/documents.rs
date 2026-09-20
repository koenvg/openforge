use super::*;

#[tokio::test]
async fn project_document_command_is_additive_bounded_and_sanitized() {
    use base64::Engine;
    let (state, _db_dir) = test_state("project_document_command");
    let root = tempfile::tempdir().unwrap();
    let project = state
        .db
        .lock()
        .unwrap()
        .create_project("PDF", root.path().to_str().unwrap())
        .unwrap();
    let mut bytes = vec![0; 16_777_216];
    bytes[..8].copy_from_slice(b"%PDF-1.7");
    std::fs::write(root.path().join("max.PDF"), &bytes).unwrap();
    let metadata = invoke_ok(
        &state,
        "fs_read_file",
        json!({"projectId": project.id, "filePath": "max.PDF"}),
    )
    .await;
    assert_eq!(metadata["type"], "document");
    assert_eq!(metadata["content"], "");
    let document = invoke_ok(
        &state,
        "fs_read_document",
        json!({"projectId": project.id, "filePath": "max.PDF"}),
    )
    .await;
    assert_eq!(document["status"], "ready");
    assert_eq!(document["size"], 16_777_216);
    assert_eq!(document["data"].as_str().unwrap().len(), 22_369_624);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(document["data"].as_str().unwrap())
            .unwrap(),
        bytes
    );
    let unavailable = invoke_ok(
        &state,
        "fs_read_document",
        json!({"projectId": project.id, "filePath": "max.PDF"}),
    )
    .await;
    assert_eq!(unavailable["revision"], document["revision"]);
    for (payload, prefix) in [
        (
            json!({"projectId": project.id, "filePath": "../escape.pdf"}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
        (
            json!({"projectId": project.id, "filePath": "missing.pdf"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"projectId": "missing", "filePath": "max.PDF"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"project_id": project.id, "filePath": "max.PDF"}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
    ] {
        let error = invoke(&state, "fs_read_document", payload)
            .await
            .unwrap_err();
        assert!(error.1.starts_with(prefix), "{}", error.1);
        assert!(!error.1.contains(root.path().to_str().unwrap()));
    }
}
