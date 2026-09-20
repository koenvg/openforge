use super::*;

#[tokio::test]
async fn hyperlink_target_links_without_completion_and_rejects_repository_or_branch_mismatch() {
    for mismatch in [None, Some("branch"), Some("head"), Some("base")] {
        let f = Fixture::new(false, Some("test-token")).await;
        match mismatch {
            Some("branch") => f.api.body.lock().unwrap()["head"]["ref"] = "other".into(),
            Some("head") => {
                f.api.body.lock().unwrap()["head"]["repo"]["full_name"] = "other/widgets".into()
            }
            Some("base") => {
                f.api.body.lock().unwrap()["base"]["repo"]["full_name"] = "other/widgets".into()
            }
            _ => {}
        }
        let mut events = f.bus.sender().subscribe();
        let mut observer = f.local.observer("registered-shell", 1).unwrap();
        observer.output("Created \x1b]8;id=pr;https://github.com/acme/widgets/pull/4");
        observer.output("2\x1b");
        f.discovery.settled().await;
        assert!(f.api.calls.lock().unwrap().is_empty());
        observer.output("\\PR #42\x1b]8;;\x1b\\.");
        f.discovery.settled().await;
        let prs = acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap();
        if mismatch.is_none() {
            assert_eq!(prs.len(), 1);
            assert_eq!(prs[0].pr_number, 42);
            assert_eq!(
                events.try_recv().unwrap().event_name,
                "task-pull-request-updated"
            );
        } else {
            assert!(prs.is_empty(), "{mismatch:?}");
            assert!(events.try_recv().is_err());
        }
        assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
    }
}

#[tokio::test]
async fn hyperlink_observer_drops_partial_frames_on_gap_and_rejects_replaced_origins() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut observer = f.local.observer("registered-shell", 1).unwrap();
    observer.output("\x1b]8;;https://github.com/acme/widgets/pull/4");
    observer.gap();
    observer.output("2\x07PR #42\x1b]8;;\x07");
    f.discovery.settled().await;
    assert!(f.api.calls.lock().unwrap().is_empty());
    f.local
        .register("registered-shell", &f.task_id, f.dir.path().into(), 2);
    observer.output("\x1b]8;;https://github.com/acme/widgets/pull/42\x07");
    f.discovery.settled().await;
    assert!(f.api.calls.lock().unwrap().is_empty());
    f.local
        .observer("registered-shell", 2)
        .unwrap()
        .output("\x1b]8;;https://github.com/acme/widgets/pull/42\x07");
    f.discovery.settled().await;
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
}
