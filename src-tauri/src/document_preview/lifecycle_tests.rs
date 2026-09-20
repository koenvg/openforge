use super::*;
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;

#[tokio::test]
async fn timed_out_reads_hold_capacity_until_blocked_io_exits() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.pdf"), b"%PDF-1.7").unwrap();
    let (started_tx, mut started_rx) = tokio::sync::mpsc::unbounded_channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Arc::new(Mutex::new(release_rx));
    let reader = DocumentReader::new(Duration::from_millis(50)).with_hook(Arc::new(move |stage| {
        if stage == ReadStage::BeforeRead {
            started_tx.send(()).unwrap();
            release_rx.lock().unwrap().recv().unwrap();
        }
    }));
    let reader = Arc::new(reader);
    let start = || {
        let reader = Arc::clone(&reader);
        let root = root.path().to_path_buf();
        tokio::spawn(async move { reader.read(root, "a.pdf".into()).await })
    };
    let first = start();
    let second = start();
    started_rx.recv().await.unwrap();
    started_rx.recv().await.unwrap();
    for response in [first.await.unwrap(), second.await.unwrap()] {
        assert!(response
            .err()
            .unwrap()
            .starts_with("DOCUMENT_PREVIEW_TIMEOUT:"));
    }
    assert!(reader
        .read(root.path().into(), "a.pdf".into())
        .await
        .err()
        .unwrap()
        .starts_with("DOCUMENT_PREVIEW_BUSY:"));
    release_tx.send(()).unwrap();
    release_tx.send(()).unwrap();
    // A missing file never reaches the blocked read hook. Once both actual I/O
    // operations exit, failures must no longer be BUSY.
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let error = reader
                .read(root.path().into(), "missing.pdf".into())
                .await
                .err()
                .unwrap();
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

#[tokio::test]
async fn cancelling_a_request_does_not_release_its_blocked_io_slot_early() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("a.pdf"), b"%PDF-1.7").unwrap();
    let (started_tx, mut started_rx) = tokio::sync::mpsc::unbounded_channel();
    let (release_tx, release_rx) = mpsc::channel();
    let release_rx = Mutex::new(release_rx);
    let reader = Arc::new(
        DocumentReader::new(Duration::from_secs(15)).with_hook(Arc::new(move |stage| {
            if stage == ReadStage::BeforeRead {
                started_tx.send(()).unwrap();
                release_rx.lock().unwrap().recv().unwrap();
            }
        })),
    );
    let worker_reader = Arc::clone(&reader);
    let worker_root = root.path().to_path_buf();
    let request =
        tokio::spawn(async move { worker_reader.read(worker_root, "a.pdf".into()).await });
    started_rx.recv().await.unwrap();
    request.abort();
    assert!(request.await.unwrap_err().is_cancelled());
    // The second slot can finish a real read and remains reserved by its response.
    let other_root = tempfile::tempdir().unwrap();
    std::fs::write(other_root.path().join("other.txt"), b"not a PDF").unwrap();
    let held = reader
        .read(other_root.path().into(), "other.txt".into())
        .await
        .unwrap();
    assert!(reader
        .read(root.path().into(), "missing.pdf".into())
        .await
        .err()
        .unwrap()
        .starts_with("DOCUMENT_PREVIEW_BUSY:"));
    release_tx.send(()).unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            let error = reader
                .read(root.path().into(), "missing.pdf".into())
                .await
                .err()
                .unwrap();
            if error.starts_with("DOCUMENT_PREVIEW_NOT_FOUND:") {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    drop(held);
}
