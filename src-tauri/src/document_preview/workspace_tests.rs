use super::*;
use crate::db::Database;
use std::sync::{Arc, Mutex};

fn fixture(root: &std::path::Path) -> (Arc<Mutex<Database>>, tempfile::TempDir, String, String) {
    let (db, directory) = crate::db::test_helpers::make_test_db("document_workspace_identity");
    let project = db.create_project("PDF", root.to_str().unwrap()).unwrap();
    let task = db
        .create_task("PDF", "doing", Some(&project.id), None, None)
        .unwrap();
    db.create_task_workspace_record(
        &task.id,
        &project.id,
        root.to_str().unwrap(),
        root.to_str().unwrap(),
        "git_worktree",
        None,
        "pi",
    )
    .unwrap();
    (Arc::new(Mutex::new(db)), directory, project.id, task.id)
}

#[cfg(unix)]
#[tokio::test]
async fn task_identity_is_rechecked_after_reading_before_publication() {
    for mutation in ["remove-task", "change-workspace", "replace-record"] {
        let root = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a.pdf"), b"%PDF-old workspace").unwrap();
        let (db, _database_dir, project_id, task_id) = fixture(root.path());
        let changed_db = Arc::clone(&db);
        let changed_task = task_id.clone();
        let changed_root = other.path().to_path_buf();
        let reader = DocumentReader::new(READ_DEADLINE).with_hook(Arc::new(move |stage| {
            if stage != ReadStage::BeforeRead {
                return;
            }
            let db = changed_db.lock().unwrap();
            match mutation {
                "remove-task" => {
                    db.delete_task_if_status(&changed_task, "doing").unwrap();
                }
                "change-workspace" => {
                    db.upsert_task_workspace_record(
                        &changed_task,
                        &project_id,
                        changed_root.to_str().unwrap(),
                        changed_root.to_str().unwrap(),
                        "git_worktree",
                        None,
                        "pi",
                        "active",
                    )
                    .unwrap();
                }
                // The resolver starts preferring a newly created legacy worktree.
                "replace-record" => {
                    db.create_worktree_record(
                        &changed_task,
                        &project_id,
                        changed_root.to_str().unwrap(),
                        changed_root.to_str().unwrap(),
                        "replacement",
                    )
                    .unwrap();
                }
                _ => unreachable!(),
            }
        }));
        let error = task::read_task_document_with(&db, &task_id, "a.pdf".into(), &reader)
            .await
            .unwrap_err();
        assert!(
            error.starts_with("DOCUMENT_PREVIEW_CHANGED:"),
            "{mutation}: {error}"
        );
        assert!(!error.contains(root.path().to_str().unwrap()));
    }
}

#[cfg(unix)]
#[tokio::test]
async fn project_and_task_reads_share_admission_and_keep_timed_out_slots_until_io_exits() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.pdf"), b"%PDF-1.7").unwrap();
    let (db, _database_dir, project_id, task_id) = fixture(root.path());
    let (started_tx, mut started_rx) = tokio::sync::mpsc::unbounded_channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    let reader = Arc::new(
        DocumentReader::new(Duration::from_millis(100)).with_hook(Arc::new(move |stage| {
            if stage == ReadStage::BeforeRead {
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }
        })),
    );
    let task_read = {
        let db = Arc::clone(&db);
        let reader = Arc::clone(&reader);
        let id = task_id.clone();
        tokio::spawn(async move {
            task::read_task_document_with(&db, &id, "a.pdf".into(), &reader).await
        })
    };
    let project_read = {
        let db = Arc::clone(&db);
        let reader = Arc::clone(&reader);
        let id = project_id.clone();
        tokio::spawn(async move {
            project::read_project_document_with(&db, &id, "a.pdf".into(), &reader).await
        })
    };
    started_rx.recv().await.unwrap();
    started_rx.recv().await.unwrap();
    for error in [
        task_read.await.unwrap().unwrap_err(),
        project_read.await.unwrap().unwrap_err(),
    ] {
        assert!(error.starts_with("DOCUMENT_PREVIEW_TIMEOUT:"));
    }
    for result in [
        task::read_task_document_with(&db, &task_id, "a.pdf".into(), &reader).await,
        project::read_project_document_with(&db, &project_id, "a.pdf".into(), &reader).await,
    ] {
        assert!(result.unwrap_err().starts_with("DOCUMENT_PREVIEW_BUSY:"));
    }
    release_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let error = task::read_task_document_with(&db, &task_id, "missing.pdf".into(), &reader)
                .await
                .unwrap_err();
            if error.starts_with("DOCUMENT_PREVIEW_NOT_FOUND:") {
                break;
            }
            assert!(error.starts_with("DOCUMENT_PREVIEW_BUSY:"));
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
}
