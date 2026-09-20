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
    let task = {
        let db = state.db.lock().unwrap();
        let task = db
            .create_task("PDF", "doing", Some(&project.id), None, None)
            .unwrap();
        db.create_task_workspace_record(
            &task.id,
            &project.id,
            root.path().to_str().unwrap(),
            root.path().to_str().unwrap(),
            "git_worktree",
            None,
            "pi",
        )
        .unwrap();
        task
    };
    let task_document = invoke_ok(
        &state,
        "task_fs_read_document",
        json!({"taskId": task.id, "filePath": "max.PDF"}),
    )
    .await;
    assert_eq!(task_document["size"], 16_777_216);
    assert_eq!(task_document["data"].as_str().unwrap().len(), 22_369_624);
    assert_eq!(
        base64::engine::general_purpose::STANDARD
            .decode(task_document["data"].as_str().unwrap())
            .unwrap(),
        bytes
    );
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

#[cfg(unix)]
#[tokio::test]
async fn task_documents_use_only_the_live_workspace_and_preserve_metadata_reads() {
    use base64::Engine;
    let (state, _db_dir) = test_state("task_documents_workspace_routing");
    let project_root = tempfile::tempdir().unwrap();
    let first = tempfile::tempdir().unwrap();
    let second = tempfile::tempdir().unwrap();
    std::fs::write(project_root.path().join("guide.pdf"), b"%PDF-project").unwrap();
    let (project, tasks, missing) = {
        let db = state.db.lock().unwrap();
        let project = db
            .create_project("PDF", project_root.path().to_str().unwrap())
            .unwrap();
        let mut tasks = Vec::new();
        for (root, bytes) in [(&first, b"%PDF-task-one"), (&second, b"%PDF-task-two")] {
            std::fs::write(root.path().join("guide.pdf"), bytes).unwrap();
            let task = db
                .create_task("PDF", "doing", Some(&project.id), None, None)
                .unwrap();
            db.create_task_workspace_record(
                &task.id,
                &project.id,
                root.path().to_str().unwrap(),
                project_root.path().to_str().unwrap(),
                "git_worktree",
                None,
                "pi",
            )
            .unwrap();
            tasks.push(task.id);
        }
        let missing = db
            .create_task("No workspace", "doing", Some(&project.id), None, None)
            .unwrap();
        (project, tasks, missing)
    };
    for (task, expected) in tasks.iter().zip([b"%PDF-task-one", b"%PDF-task-two"]) {
        let result = invoke_ok(
            &state,
            "task_fs_read_document",
            json!({"taskId": task, "filePath": "guide.pdf"}),
        )
        .await;
        assert_eq!(
            base64::engine::general_purpose::STANDARD
                .decode(result["data"].as_str().unwrap())
                .unwrap(),
            expected
        );
        let metadata = invoke_ok(
            &state,
            "task_fs_read_file",
            json!({"taskId": task, "filePath": "guide.pdf"}),
        )
        .await;
        assert_eq!(metadata["type"], "document");
        assert_eq!(metadata["content"], "");
    }
    for (payload, prefix) in [
        (
            json!({"taskId": missing.id, "filePath": "guide.pdf"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"taskId": "missing", "filePath": "guide.pdf"}),
            "DOCUMENT_PREVIEW_NOT_FOUND:",
        ),
        (
            json!({"taskId": tasks[0], "filePath": "guide.pdf", "root": project.path}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
        (
            json!({"task_id": tasks[0], "filePath": "guide.pdf"}),
            "DOCUMENT_PREVIEW_BAD_REQUEST:",
        ),
    ] {
        let error = invoke(&state, "task_fs_read_document", payload)
            .await
            .unwrap_err();
        assert!(error.1.starts_with(prefix), "{}", error.1);
        assert!(!error.1.contains(project_root.path().to_str().unwrap()));
    }
    first.close().unwrap();
    let error = invoke(
        &state,
        "task_fs_read_document",
        json!({"taskId": tasks[0], "filePath": "guide.pdf"}),
    )
    .await
    .unwrap_err();
    assert!(error.1.starts_with("DOCUMENT_PREVIEW_NOT_FOUND:"));
}
