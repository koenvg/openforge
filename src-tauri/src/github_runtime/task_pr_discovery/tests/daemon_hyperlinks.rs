use super::*;
use crate::github_runtime::task_pr_discovery::daemon::DaemonOutput;
use openforge_session_protocol::{Event, EventBatch, Session};

fn session(f: &Fixture) -> Session {
    serde_json::from_value(serde_json::json!({
        "pty": {"installation":"test", "lifetime":"daemon", "instance":1},
        "sessionKey": format!("{}-shell-0", f.task_id),
        "owner": {"Shell":{"task_id":f.task_id, "index":0}},
        "cwd": f.dir.path(), "pid":123, "exitCode":null, "nextIoSequence":1
    }))
    .unwrap()
}

fn output(session: &Session, sequence: u64, text: &str) -> Event {
    Event::Output {
        pty: session.pty.clone(),
        sequence,
        data: text.as_bytes().into(),
    }
}

fn link(number: i64) -> String {
    format!("\x1b]8;;https://github.com/acme/widgets/pull/{number}\x07PR #{number}\x1b]8;;\x07")
}

fn batch(cursor: u64, gap: bool, events: Vec<Event>) -> EventBatch {
    EventBatch {
        cursor,
        gap,
        retained_bytes: 0,
        events,
    }
}

fn linked(f: &Fixture) -> Vec<i64> {
    acquire_db(&f.db)
        .get_pull_requests_for_task(&f.task_id)
        .unwrap()
        .iter()
        .map(|pr| pr.pr_number)
        .collect()
}

#[tokio::test]
async fn daemon_hyperlink_frames_link_without_views_or_completion() {
    let f = Fixture::new(false, Some("test-token")).await;
    let session = session(&f);
    let current = std::slice::from_ref(&session);
    let mut adapter = DaemonOutput::new(f.local.clone());
    let mut events = f.bus.sender().subscribe();
    adapter.accept(
        current,
        &batch(
            1,
            false,
            vec![output(
                &session,
                1,
                "\x1b]8;;https://github.com/acme/widgets/pull/4",
            )],
        ),
    );
    adapter.accept(
        current,
        &batch(2, false, vec![output(&session, 2, "2\x07PR #42")]),
    );
    f.discovery.settled().await;
    assert_eq!(linked(&f), vec![42]);
    assert_eq!(
        events.try_recv().unwrap().event_name,
        "task-pull-request-updated"
    );
}

#[tokio::test]
async fn daemon_hyperlinks_reject_replay_and_discard_partial_frames_on_discontinuity() {
    for interruption in ["sequence", "journal", "disconnect", "recovery"] {
        let f = Fixture::new(false, Some("test-token")).await;
        let session = session(&f);
        let current = std::slice::from_ref(&session);
        let mut adapter = DaemonOutput::new(f.local.clone());
        adapter.accept(
            current,
            &batch(
                1,
                false,
                vec![output(
                    &session,
                    1,
                    "\x1b]8;;https://github.com/acme/widgets/pull/4",
                )],
            ),
        );
        match interruption {
            "journal" => adapter.accept(
                current,
                &batch(2, true, vec![output(&session, 2, &link(42))]),
            ),
            "disconnect" => {
                adapter.disconnect();
                adapter.resume(2);
            }
            "recovery" => adapter.accept(
                current,
                &batch(
                    2,
                    false,
                    vec![Event::RecoveryRequired {
                        pty: session.pty.clone(),
                    }],
                ),
            ),
            _ => {}
        }
        let next = if interruption == "recovery" { 2 } else { 3 };
        adapter.accept(
            current,
            &batch(3, false, vec![output(&session, next, "2\x07")]),
        );
        adapter.accept(
            current,
            &batch(2, false, vec![output(&session, next + 1, &link(42))]),
        );
        adapter.accept(
            current,
            &batch(4, false, vec![output(&session, next, &link(42))]),
        );
        f.discovery.settled().await;
        assert!(linked(&f).is_empty(), "{interruption}");
        adapter.accept(
            current,
            &batch(5, false, vec![output(&session, next + 1, &link(43))]),
        );
        f.discovery.settled().await;
        assert_eq!(linked(&f), vec![43], "{interruption}");
    }
}

#[tokio::test]
async fn daemon_hyperlink_replacement_rejects_old_lifetime_and_pending_work() {
    let f = Fixture::new(false, Some("test-token")).await;
    let old = session(&f);
    let mut new = old.clone();
    new.pty.lifetime = openforge_session_host::DaemonLifetimeId::parse("replacement").unwrap();
    let mut adapter = DaemonOutput::new(f.local.clone());
    adapter.accept(
        std::slice::from_ref(&old),
        &batch(1, false, vec![output(&old, 1, &link(42))]),
    );
    adapter.accept(
        std::slice::from_ref(&new),
        &batch(
            2,
            false,
            vec![output(&old, 100, &link(42)), output(&new, 1, &link(43))],
        ),
    );
    f.discovery.settled().await;
    assert_eq!(linked(&f), vec![43]);
}

#[tokio::test]
async fn daemon_hyperlinks_require_authoritative_task_inventory() {
    for owner in ["missing-cwd", "project", "review", "wrong-key"] {
        let f = Fixture::new(false, Some("test-token")).await;
        let mut session = session(&f);
        match owner {
            "missing-cwd" => session.cwd = None,
            "project" => {
                session.owner = openforge_session_protocol::TerminalOwner::Shell {
                    task_id: f.project_id.clone(),
                    index: Some(0),
                };
                session.session_key = session.owner.session_key();
            }
            "review" => {
                session.owner = openforge_session_protocol::TerminalOwner::Agent {
                    task_id: "review-only".into(),
                };
                session.session_key = session.owner.session_key();
            }
            _ => session.session_key = "wrong-key".into(),
        }
        let mut adapter = DaemonOutput::new(f.local.clone());
        adapter.accept(
            std::slice::from_ref(&session),
            &batch(1, false, vec![output(&session, 1, &link(42))]),
        );
        f.discovery.settled().await;
        assert!(linked(&f).is_empty(), "{owner}");
    }
}

#[tokio::test]
async fn daemon_hyperlink_work_survives_normal_exit_but_not_removal_or_teardown() {
    for ending in ["removed", "drop", "exit"] {
        let f = Fixture::new(false, Some("test-token")).await;
        let session = session(&f);
        let current = std::slice::from_ref(&session);
        let mut adapter = DaemonOutput::new(f.local.clone());
        adapter.accept(
            current,
            &batch(1, false, vec![output(&session, 1, &link(42))]),
        );
        match ending {
            "removed" => adapter.accept(&[], &batch(2, false, vec![])),
            "drop" => {
                drop(adapter);
                f.discovery.settled().await;
                assert!(linked(&f).is_empty());
                continue;
            }
            _ => adapter.accept(
                current,
                &batch(
                    2,
                    false,
                    vec![
                        Event::Exited {
                            pty: session.pty.clone(),
                            code: 0,
                        },
                        output(&session, 2, &link(43)),
                    ],
                ),
            ),
        }
        f.discovery.settled().await;
        assert_eq!(
            linked(&f),
            if ending == "exit" { vec![42] } else { vec![] },
            "{ending}"
        );
    }
}

#[tokio::test]
async fn daemon_hyperlink_queue_saturation_does_not_wait_for_github_or_block_exit() {
    let f = Fixture::new(true, Some("test-token")).await;
    let session = session(&f);
    let current = std::slice::from_ref(&session);
    let mut adapter = DaemonOutput::new(f.local.clone());
    adapter.accept(
        current,
        &batch(1, false, vec![output(&session, 1, &link(42))]),
    );
    f.calls(1).await;
    let events = (2..402)
        .map(|sequence| {
            output(
                &session,
                sequence,
                &link(i64::try_from(sequence).unwrap() + 42),
            )
        })
        .collect();
    adapter.accept(current, &batch(2, false, events));
    adapter.accept(
        current,
        &batch(
            3,
            false,
            vec![Event::Exited {
                pty: session.pty.clone(),
                code: 0,
            }],
        ),
    );
    assert!(linked(&f).is_empty());
    adapter.disconnect();
    f.release_requests(1024);
    f.discovery.settled().await;
    assert!(linked(&f).is_empty());
}

#[tokio::test]
async fn gapped_daemon_hyperlink_and_exit_batch_cannot_trigger_discovery() {
    let f = Fixture::new(false, Some("test-token")).await;
    let mut session = session(&f);
    session.owner = openforge_session_protocol::TerminalOwner::Agent {
        task_id: f.task_id.clone(),
    };
    session.session_key = f.task_id.clone();
    let mut adapter = DaemonOutput::new(f.local.clone());
    adapter.accept(
        std::slice::from_ref(&session),
        &batch(
            1,
            true,
            vec![
                output(&session, 1, &link(42)),
                Event::Exited {
                    pty: session.pty.clone(),
                    code: 0,
                },
            ],
        ),
    );
    f.discovery.settled().await;
    assert!(linked(&f).is_empty());
}
