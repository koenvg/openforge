use super::*;

#[test]
fn maintenance_capacity_preserves_original_failure_receipts_and_conflicts() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("images");
    let image = images::Image {
        path: directory.join("current"),
        version: "current".into(),
        sha256: "0".repeat(64),
    };
    let mut manager = Manager {
        current: Some(image),
        running_version: "current".into(),
        jobs: Vec::new(),
        pending: None,
        directory,
    };
    let request = root.path().join("missing-executable");
    for index in 0..MAX_JOBS {
        let operation = OperationId::parse(format!("job-{index}")).unwrap();
        manager.prepare(operation.clone(), request.clone()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        while manager.pending.is_some() {
            manager.poll();
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        let original = serde_json::to_value(manager.status(&operation).unwrap()).unwrap();
        assert_eq!(original["state"]["stage"], "preflight");
        manager.prepare(operation.clone(), request.clone()).unwrap();
        assert_eq!(
            serde_json::to_value(manager.status(&operation).unwrap()).unwrap(),
            original
        );
        assert_eq!(
            manager.prepare(operation, root.path().join("different")),
            Err(Error::OperationConflict)
        );
    }
    let first = OperationId::parse("job-0").unwrap();
    let original = serde_json::to_value(manager.status(&first).unwrap()).unwrap();
    assert_eq!(
        manager.prepare(OperationId::parse("overflow").unwrap(), request),
        Err(Error::Capacity)
    );
    assert_eq!(manager.jobs.len(), MAX_JOBS);
    assert_eq!(
        serde_json::to_value(manager.status(&first).unwrap()).unwrap(),
        original
    );
}

#[test]
fn checkpoint_rejects_ambiguous_or_rewritten_maintenance_history() {
    let root = tempfile::tempdir().unwrap();
    let directory = root.path().join("images");
    let image = images::Image {
        path: directory.join("current"),
        version: "current".into(),
        sha256: "0".repeat(64),
    };
    let operation = OperationId::parse("active").unwrap();
    let job = Job {
        operation: operation.clone(),
        requested: root.path().join("requested"),
        source_version: "current".into(),
        actual_version: "current".into(),
        target: Some(image.clone()),
        state: ReplacementState::Executing,
    };
    let mut snapshot = Snapshot {
        current: image,
        jobs: vec![job.clone()],
    };
    snapshot.validate(&operation, &directory).unwrap();
    snapshot.jobs.push(job);
    assert!(snapshot.validate(&operation, &directory).is_err());
    snapshot.jobs.pop();
    snapshot.jobs[0].actual_version = "rewritten".into();
    assert!(snapshot.validate(&operation, &directory).is_err());
    snapshot.jobs[0].actual_version = "current".into();
    snapshot.jobs[0].target = None;
    assert!(snapshot.validate(&operation, &directory).is_err());
}
