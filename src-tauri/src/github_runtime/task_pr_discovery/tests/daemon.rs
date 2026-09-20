use super::*;
use crate::github_runtime::task_pr_discovery::daemon::DaemonOutput;
use openforge_session_protocol::{Event, EventBatch, Session};

fn session(f: &Fixture, instance: u64) -> Session {
    serde_json::from_value(serde_json::json!({
        "pty":{"installation":"test", "lifetime":"daemon", "instance":instance},
        "sessionKey":format!("{}-shell-0", f.task_id),
        "owner":{"Shell":{"task_id":f.task_id, "index":0}},
        "cwd":f.dir.path(), "pid":123, "exitCode":null, "nextIoSequence":1
    }))
    .unwrap()
}
fn output(session: &Session, sequence: u64, text: &str) -> Event {
    Event::Output {
        pty: session.pty.clone(),
        sequence,
        data: text.as_bytes().to_vec(),
    }
}
fn batch(cursor: u64, events: Vec<Event>) -> EventBatch {
    EventBatch {
        cursor,
        gap: false,
        retained_bytes: 0,
        events,
    }
}

#[tokio::test]
async fn daemon_split_url_links_without_views_or_periodic_discovery() {
    let f = Fixture::new(false, Some("test-token")).await;
    let session = session(&f, 1);
    let mut adapter = DaemonOutput::new(f.local.clone());
    let mut events = f.bus.sender().subscribe();
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(1, vec![output(&session, 10, "https://git")]),
    );
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(2, vec![output(&session, 11, "hub.com/acme/widgets/pull/4")]),
    );
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(3, vec![output(&session, 12, "2\n")]),
    );
    f.discovery.settled().await;
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
    assert_eq!(
        acquire_db(&f.db)
            .get_pull_requests_for_task(&f.task_id)
            .unwrap()
            .len(),
        1
    );
    let event = events.try_recv().expect("immediate PR notification");
    assert_eq!(event.event_name, "task-pull-request-updated");
    assert_eq!(event.payload["task_id"], f.task_id);
}

#[tokio::test]
async fn daemon_continuity_rejects_duplicates_gaps_and_replaced_instances() {
    for interruption in [
        "duplicate",
        "sequence-gap",
        "batch-gap",
        "replacement",
        "unattributed",
    ] {
        let f = Fixture::new(false, Some("test-token")).await;
        let mut session = session(&f, 1);
        let mut adapter = DaemonOutput::new(f.local.clone());
        adapter.accept(
            std::slice::from_ref(&session),
            &batch(
                1,
                vec![output(
                    &session,
                    1,
                    "https://github.com/acme/widgets/pull/4",
                )],
            ),
        );
        let mut next = batch(2, vec![output(&session, 2, "2\n")]);
        match interruption {
            "duplicate" => {
                // A second delivery of a sequence must not contribute even a different suffix.
                adapter.accept(
                    std::slice::from_ref(&session),
                    &batch(2, vec![output(&session, 1, "99\n")]),
                );
                next.cursor = 3;
            }
            "sequence-gap" => next.events = vec![output(&session, 3, "2\n")],
            "batch-gap" => next.gap = true,
            "replacement" => {
                session.pty.instance = openforge_session_host::PtyInstanceId::new(2).unwrap();
                next.events.push(output(&session, 1, "2\n"));
            }
            "unattributed" => session.cwd = None,
            _ => unreachable!(),
        }
        adapter.accept(std::slice::from_ref(&session), &next);
        f.discovery.settled().await;
        let expected = if interruption == "duplicate" {
            vec![42]
        } else {
            vec![]
        };
        assert_eq!(*f.api.calls.lock().unwrap(), expected, "{interruption}");
        // Eligible output continues without combining any missing prefix.
        session.cwd = Some(f.dir.path().into());
        adapter.accept(
            std::slice::from_ref(&session),
            &batch(
                4,
                vec![output(
                    &session,
                    4,
                    "https://github.com/acme/widgets/pull/43\n",
                )],
            ),
        );
        f.discovery.settled().await;
        assert_eq!(
            f.api.calls.lock().unwrap().last(),
            Some(&43),
            "{interruption}"
        );
    }
}

#[tokio::test]
async fn daemon_disconnect_skips_history_and_invalidates_inflight_verification() {
    let f = Fixture::new(true, Some("test-token")).await;
    let session = session(&f, 1);
    let mut adapter = DaemonOutput::new(f.local.clone());
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            1,
            vec![output(
                &session,
                1,
                "https://github.com/acme/widgets/pull/42\nhttps://git",
            )],
        ),
    );
    f.calls(1).await;
    adapter.disconnect();
    // The reconnect inventory cursor is a live-output boundary, not a replay request.
    adapter.resume(3);
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            3,
            vec![output(
                &session,
                2,
                "https://github.com/acme/widgets/pull/99\n",
            )],
        ),
    );
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            4,
            vec![output(&session, 3, "hub.com/acme/widgets/pull/44\n")],
        ),
    );
    f.api.gate.add_permits(10);
    f.discovery.settled().await;
    assert!(acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .is_empty());
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            5,
            vec![output(
                &session,
                4,
                "https://github.com/acme/widgets/pull/43\n",
            )],
        ),
    );
    f.discovery.settled().await;
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42, 43]);
}

#[tokio::test]
async fn daemon_queue_overflow_never_waits_for_github_and_later_output_can_retry() {
    let f = Fixture::new(true, Some("test-token")).await;
    let session = session(&f, 1);
    let mut adapter = DaemonOutput::new(f.local.clone());
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            1,
            vec![output(
                &session,
                1,
                "https://github.com/acme/widgets/pull/42\n",
            )],
        ),
    );
    f.calls(1).await;
    for number in 1000..1400 {
        adapter.accept(
            std::slice::from_ref(&session),
            &batch(
                number,
                vec![output(
                    &session,
                    number,
                    &format!("https://github.com/acme/widgets/pull/{number}\n"),
                )],
            ),
        );
    }
    assert_eq!(*f.api.calls.lock().unwrap(), vec![42]);
    f.release_requests(500);
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().len(), 256);
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            1500,
            vec![output(
                &session,
                1500,
                "https://github.com/acme/widgets/pull/1500\n",
            )],
        ),
    );
    f.discovery.settled().await;
    assert_eq!(f.api.calls.lock().unwrap().last(), Some(&1500));
}

#[tokio::test]
async fn daemon_origin_reuses_stale_result_and_ownership_guards() {
    for race in ["replacement", "workspace", "manual", "absent", "exit"] {
        let f = Fixture::new(true, Some("test-token")).await;
        let mut session = session(&f, 1);
        let mut adapter = DaemonOutput::new(f.local.clone());
        adapter.accept(
            std::slice::from_ref(&session),
            &batch(
                1,
                vec![output(
                    &session,
                    1,
                    "https://github.com/acme/widgets/pull/42\n",
                )],
            ),
        );
        f.calls(1).await;
        match race {
            "replacement" => {
                session.pty.instance = openforge_session_host::PtyInstanceId::new(2).unwrap();
                adapter.accept(&[session], &batch(1, vec![]));
            }
            "workspace" => {
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
            "manual" => {
                let other = acquire_db(&f.db)
                    .create_task("manual", "doing", Some(&f.project_id), None, None)
                    .unwrap();
                crate::github_runtime::link_pull_request(
                    &f.db,
                    &other.id,
                    "https://github.com/acme/widgets/pull/42",
                )
                .unwrap();
            }
            "absent" => adapter.accept(&[], &batch(1, vec![])),
            "exit" => adapter.accept(
                std::slice::from_ref(&session),
                &batch(
                    2,
                    vec![Event::Exited {
                        pty: session.pty.clone(),
                        code: 0,
                    }],
                ),
            ),
            _ => unreachable!(),
        }
        f.release_requests(1);
        f.discovery.settled().await;
        assert_eq!(
            acquire_db(&f.db)
                .get_pull_requests_for_task(&f.task_id)
                .unwrap()
                .len(),
            usize::from(race == "exit"),
            "{race}"
        );
    }
}
