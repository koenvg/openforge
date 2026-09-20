use super::*;
use std::{
    sync::atomic::{AtomicI64, Ordering},
    time::Duration,
};
use tokio::sync::{mpsc, oneshot};

struct ManualClock {
    now: AtomicI64,
    sleeps: mpsc::UnboundedSender<(Duration, oneshot::Sender<()>)>,
}
impl super::super::clock::Clock for ManualClock {
    fn now(&self) -> i64 {
        self.now.load(Ordering::SeqCst)
    }
    fn sleep(
        &self,
        delay: Duration,
    ) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + '_>> {
        Box::pin(async move {
            let (tx, rx) = oneshot::channel();
            self.sleeps.send((delay, tx)).unwrap();
            let _ = rx.await;
        })
    }
}

#[tokio::test]
async fn successful_agent_exit_discovers_first_pr_after_debounce_without_polling() {
    let (tx, mut sleeps) = mpsc::unbounded_channel();
    let clock = Arc::new(ManualClock {
        now: AtomicI64::new(100),
        sleeps: tx,
    });
    let f = Fixture::with_clock(false, Some("test-token"), clock.clone()).await;
    agent(&f, "pi");
    let mut events = f.bus.sender().subscribe();
    f.local.agent_exited(&f.task_id, 2, true);
    let (delay, wake) = tokio::time::timeout(Duration::from_secs(5), sleeps.recv())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(delay, Duration::from_secs(2));
    assert!(f.api.calls.lock().unwrap().is_empty());
    clock.now.store(102, Ordering::SeqCst);
    wake.send(()).unwrap();
    f.discovery.settled().await;
    let prs = acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap();
    assert_eq!(prs.len(), 1);
    assert!(prs[0].draft);
    assert_eq!(
        events.try_recv().unwrap().event_name,
        "task-pull-request-updated"
    );
}

fn agent(f: &Fixture, provider: &str) {
    let db = acquire_db(&f.db);
    db.create_agent_session(
        "implementation",
        &f.task_id,
        None,
        "implementing",
        "running",
        provider,
    )
    .unwrap();
    db.set_agent_session_pty_instance_id("implementation", 2)
        .unwrap();
    f.local.register_agent(&f.task_id, f.dir.path().into(), 2);
}

fn lifecycle(
    f: &Fixture,
    provider: &str,
    kind: crate::agent_lifecycle::AgentLifecycleEventKind,
    instance: u64,
) {
    let change = crate::agent_lifecycle::apply_agent_lifecycle_notification(
        &acquire_db(&f.db),
        &crate::agent_lifecycle::AgentLifecycleNotification {
            provider: provider.into(),
            task_id: f.task_id.clone(),
            pty_instance_id: Some(instance),
            provider_session_id: None,
            kind,
            raw_event_type: None,
            raw_status_type: None,
        },
    )
    .unwrap();
    if let Some(change) = change {
        f.local.lifecycle(&change);
    }
}

#[tokio::test]
async fn accepted_normalized_completion_coalesces_hooks_and_exit_and_cancels_resumed_work() {
    use crate::agent_lifecycle::AgentLifecycleEventKind::*;
    for provider in ["opencode", "pi"] {
        for resumed in [false, true] {
            let (tx, mut sleeps) = mpsc::unbounded_channel();
            let clock = Arc::new(ManualClock {
                now: AtomicI64::new(100),
                sleeps: tx,
            });
            let f = Fixture::with_clock(false, Some("test-token"), clock).await;
            agent(&f, provider);
            lifecycle(&f, provider, BecameIdle, 999);
            lifecycle(&f, provider, RequestedPermission, 2);
            assert!(sleeps.try_recv().is_err());
            lifecycle(&f, provider, BecameBusy, 2);
            lifecycle(&f, provider, BecameIdle, 2);
            let (delay, wake) = tokio::time::timeout(Duration::from_secs(5), sleeps.recv())
                .await
                .unwrap()
                .unwrap();
            assert_eq!(delay, Duration::from_secs(2));
            lifecycle(&f, provider, BecameIdle, 2);
            f.local.agent_exited(&f.task_id, 2, true);
            if resumed {
                lifecycle(&f, provider, BecameBusy, 2);
            }
            wake.send(()).unwrap();
            f.discovery.settled().await;
            assert_eq!(f.api.calls.lock().unwrap().len(), usize::from(!resumed));
            assert!(sleeps.try_recv().is_err());
        }
    }
}

#[tokio::test]
async fn only_recent_success_for_same_head_suppresses_completion_not_old_links() {
    use crate::agent_lifecycle::AgentLifecycleEventKind::*;
    let (tx, mut sleeps) = mpsc::unbounded_channel();
    let clock = Arc::new(ManualClock {
        now: AtomicI64::new(100),
        sleeps: tx,
    });
    let f = Fixture::with_clock(false, Some("test-token"), clock.clone()).await;
    agent(&f, "pi");
    f.output(42);
    f.discovery.settled().await;
    for (now, expected) in [(102, 1), (131, 2)] {
        if now == 131 {
            let mut pr = f.api.body.lock().unwrap();
            pr["number"] = 43.into();
            pr["id"] = 543.into();
        }
        lifecycle(&f, "pi", BecameBusy, 2);
        lifecycle(&f, "pi", BecameIdle, 2);
        let (_, wake) = sleeps.recv().await.unwrap();
        clock.now.store(now, Ordering::SeqCst);
        wake.send(()).unwrap();
        f.discovery.settled().await;
        assert_eq!(f.api.calls.lock().unwrap().len(), expected, "at {now}");
    }
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn completed_session_can_commit_but_newer_database_session_supersedes_lookup() {
    for replaced in [false, true] {
        let (tx, mut sleeps) = mpsc::unbounded_channel();
        let clock = Arc::new(ManualClock {
            now: AtomicI64::new(100),
            sleeps: tx,
        });
        let f = Fixture::with_clock(true, Some("test-token"), clock).await;
        agent(&f, "pi");
        f.local.agent_exited(&f.task_id, 2, true);
        let (_, wake) = sleeps.recv().await.unwrap();
        wake.send(()).unwrap();
        f.calls(1).await;
        f.local.finish(&f.task_id, 2);
        if replaced {
            let db = acquire_db(&f.db);
            db.create_agent_session("newer", &f.task_id, None, "implementing", "running", "pi")
                .unwrap();
            db.set_agent_session_pty_instance_id("newer", 3).unwrap();
        }
        f.api.gate.add_permits(1);
        f.discovery.settled().await;
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            usize::from(!replaced)
        );
    }
}

#[tokio::test]
async fn branch_lookup_verifies_forks_encoded_tracking_and_all_pages_before_linking() {
    for ambiguous in [false, true] {
        let (tx, mut sleeps) = mpsc::unbounded_channel();
        let f = Fixture::with_clock(
            false,
            Some("test-token"),
            Arc::new(ManualClock {
                now: AtomicI64::new(100),
                sleeps: tx,
            }),
        )
        .await;
        agent(&f, "opencode");
        let repo = git2::Repository::open(f.dir.path()).unwrap();
        repo.remote_set_url("origin", "git@github.com:fork/widgets.git")
            .unwrap();
        repo.remote("upstream", "https://github.com/acme/widgets.git")
            .unwrap();
        repo.config()
            .unwrap()
            .set_str("branch.task-branch.remote", "origin")
            .unwrap();
        repo.config()
            .unwrap()
            .set_str("branch.task-branch.merge", "refs/heads/feature/a+b")
            .unwrap();
        let mut pr = f.api.body.lock().unwrap().clone();
        pr["head"]["ref"] = "feature/a+b".into();
        pr["head"]["repo"]["full_name"] = "fork/widgets".into();
        let mut candidates = vec![pr.clone(); 100];
        if ambiguous {
            pr["number"] = 43.into();
            pr["id"] = 543.into();
            candidates.push(pr);
        }
        *f.api.branch_prs.lock().unwrap() = Some(candidates);
        f.local.agent_exited(&f.task_id, 2, true);
        let (_, wake) = sleeps.recv().await.unwrap();
        wake.send(()).unwrap();
        f.discovery.settled().await;
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            usize::from(!ambiguous)
        );
        assert!(f.api.branches.lock().unwrap().contains(&(
            "acme".into(),
            "widgets".into(),
            "fork:feature/a+b".into(),
            2
        )));
    }
}

#[tokio::test]
async fn completion_visibility_retries_are_bounded_and_authentication_does_not_spin() {
    for failure in ["invisible", "network", "auth", "missing"] {
        let (tx, mut sleeps) = mpsc::unbounded_channel();
        let token = if failure == "missing" {
            None
        } else {
            Some("test-token")
        };
        let f = Fixture::with_clock(
            false,
            token,
            Arc::new(ManualClock {
                now: AtomicI64::new(100),
                sleeps: tx,
            }),
        )
        .await;
        agent(&f, "pi");
        match failure {
            "invisible" => *f.api.branch_prs.lock().unwrap() = Some(vec![]),
            "network" => f.api.statuses.lock().unwrap().extend([503, 503]),
            "auth" => f.api.statuses.lock().unwrap().push_back(401),
            _ => {}
        }
        f.local.agent_exited(&f.task_id, 2, true);
        let (_, wake) = sleeps.recv().await.unwrap();
        wake.send(()).unwrap();
        if matches!(failure, "invisible" | "network") {
            for expected in [2, 10] {
                let (delay, wake) = tokio::time::timeout(Duration::from_secs(5), sleeps.recv())
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(delay, Duration::from_secs(expected));
                if expected == 10 {
                    *f.api.branch_prs.lock().unwrap() = None;
                }
                wake.send(()).unwrap();
            }
        }
        f.discovery.settled().await;
        assert_eq!(
            f.api.calls.lock().unwrap().len(),
            match failure {
                "missing" => 0,
                "auth" => 1,
                _ => 3,
            }
        );
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            usize::from(matches!(failure, "invisible" | "network"))
        );
        assert!(sleeps.try_recv().is_err());
    }
}

#[tokio::test]
async fn distinct_url_during_branch_lookup_remains_eligible_and_failed_exits_do_not_trigger() {
    let (tx, mut sleeps) = mpsc::unbounded_channel();
    let f = Fixture::with_clock(
        true,
        Some("test-token"),
        Arc::new(ManualClock {
            now: AtomicI64::new(100),
            sleeps: tx,
        }),
    )
    .await;
    agent(&f, "pi");
    f.local.agent_exited(&f.task_id, 999, true);
    f.local.agent_exited("registered-shell", 1, true);
    f.local.agent_exited(&f.task_id, 2, false);
    f.discovery.settled().await;
    assert!(sleeps.try_recv().is_err());
    f.local.agent_exited(&f.task_id, 2, true);
    let (_, wake) = sleeps.recv().await.unwrap();
    wake.send(()).unwrap();
    f.calls(1).await;
    f.output(43);
    f.api.gate.add_permits(2);
    f.discovery.settled().await;
    assert_eq!(*f.api.calls.lock().unwrap(), vec![0, 43]);
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        2
    );
}

#[tokio::test]
async fn replay_and_review_sessions_never_trigger_completion_discovery() {
    let (tx, mut sleeps) = mpsc::unbounded_channel();
    let f = Fixture::with_clock(
        false,
        Some("test-token"),
        Arc::new(ManualClock {
            now: AtomicI64::new(100),
            sleeps: tx,
        }),
    )
    .await;
    agent(&f, "pi");
    let delivery = serde_json::from_value(serde_json::json!({
        "journalId": "completion-test", "position": 1,
        "pty": {"installation":"installation-test", "lifetime":"lifetime-test", "instance":2},
        "sessionKey": f.task_id,
        "envelope": {"id":"event-1", "payload":{"provider":"pi", "task_id":f.task_id,"pty_instance_id":2,"kind":"became_idle"}}
    })).unwrap();
    let accepted = acquire_db(&f.db)
        .apply_notification_delivery(&delivery)
        .unwrap()
        .unwrap();
    f.local.lifecycle(&accepted);
    let (_, wake) = sleeps.recv().await.unwrap();
    wake.send(()).unwrap();
    f.discovery.settled().await;
    assert!(acquire_db(&f.db)
        .apply_notification_delivery(&delivery)
        .unwrap()
        .is_none());
    acquire_db(&f.db)
        .update_agent_session("implementation", "reviewing", "running", None, None)
        .unwrap();
    lifecycle(
        &f,
        "pi",
        crate::agent_lifecycle::AgentLifecycleEventKind::BecameIdle,
        2,
    );
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 1);
    assert!(sleeps.try_recv().is_err());
}

#[tokio::test]
async fn branch_completion_honors_shared_and_response_rate_limit_deadlines() {
    for from_response in [false, true] {
        let (tx, mut sleeps) = mpsc::unbounded_channel();
        let now = crate::unix_timestamp::seconds(std::time::SystemTime::now()).unwrap();
        let clock = Arc::new(ManualClock {
            now: AtomicI64::new(now),
            sleeps: tx,
        });
        let f = Fixture::with_clock(false, Some("test-token"), clock.clone()).await;
        agent(&f, "pi");
        if from_response {
            f.api.statuses.lock().unwrap().push_back(429);
            *f.api.retry_after.lock().unwrap() = Some("20".into());
        } else {
            f.client.set_last_rate_limit_reset(Some(now + 30));
        }
        f.local.agent_exited(&f.task_id, 2, true);
        let (_, wake) = sleeps.recv().await.unwrap();
        clock.now.store(now + 2, Ordering::SeqCst);
        wake.send(()).unwrap();
        let (delay, wake) = tokio::time::timeout(Duration::from_secs(5), sleeps.recv())
            .await
            .unwrap()
            .unwrap();
        let deadline = f.client.get_last_rate_limit_reset().unwrap();
        assert_eq!(delay.as_secs(), (deadline - now - 2) as u64);
        assert_eq!(
            f.api.calls.lock().unwrap().len(),
            usize::from(from_response)
        );
        clock.now.store(deadline, Ordering::SeqCst);
        wake.send(()).unwrap();
        f.discovery.settled().await;
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            1
        );
    }
}

#[tokio::test]
async fn branch_lookup_discards_stale_worktree_branch_task_and_generation_results() {
    for race in [
        "branch",
        "worktree",
        "deleted",
        "completed",
        "resumed",
        "replaced",
    ] {
        let (tx, mut sleeps) = mpsc::unbounded_channel();
        let f = Fixture::with_clock(
            true,
            Some("test-token"),
            Arc::new(ManualClock {
                now: AtomicI64::new(100),
                sleeps: tx,
            }),
        )
        .await;
        agent(&f, "pi");
        f.local.agent_exited(&f.task_id, 2, true);
        let (_, wake) = sleeps.recv().await.unwrap();
        wake.send(()).unwrap();
        f.calls(1).await;
        match race {
            "branch" => {
                let repo = git2::Repository::open(f.dir.path()).unwrap();
                repo.branch(
                    "changed",
                    &repo.head().unwrap().peel_to_commit().unwrap(),
                    false,
                )
                .unwrap();
                repo.set_head("refs/heads/changed").unwrap();
            }
            "worktree" => {
                acquire_db(&f.db)
                    .upsert_task_workspace_record(
                        &f.task_id,
                        &f.project_id,
                        "/missing",
                        "/missing",
                        "worktree",
                        None,
                        "pi",
                        "active",
                    )
                    .unwrap();
            }
            "deleted" => {
                acquire_db(&f.db).hard_delete_task(&f.task_id).unwrap();
            }
            "completed" => {
                acquire_db(&f.db)
                    .update_task_status(&f.task_id, "done")
                    .unwrap();
            }
            "resumed" => lifecycle(
                &f,
                "pi",
                crate::agent_lifecycle::AgentLifecycleEventKind::BecameBusy,
                2,
            ),
            "replaced" => f.local.register_agent(&f.task_id, f.dir.path().into(), 3),
            _ => unreachable!(),
        }
        f.api.gate.add_permits(1);
        f.discovery.settled().await;
        assert!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .is_empty(),
            "{race}"
        );
    }
}
