use super::support::{wait_text, Fixture};
use openforge_session_client::Client;
use openforge_session_protocol::*;
use std::{collections::BTreeMap, path::PathBuf, time::Instant};
#[test]
fn many_live_sessions_survive_image_replacement() {
    for count in [33, 256] {
        let (mut fixture, client) = Fixture::new();
        client.enable_operation_retirement().unwrap();
        let mut sessions = Vec::with_capacity(count);
        for index in 0..count {
            let command = ShellCommand {
                owner: if index % 2 == 0 {
                    TerminalOwner::Shell {
                        task_id: format!("scale-{index}"),
                        index: Some(0),
                    }
                } else {
                    TerminalOwner::Agent {
                        task_id: format!("scale-{index}"),
                    }
                },
                command: PreparedCommand {
                    program: "/bin/cat".into(),
                    args: vec![],
                    cwd: fixture.root().into(),
                    env: BTreeMap::new(),
                },
                columns: 80,
                rows: 24,
                image_protocol: None,
            };
            let session = client
                .spawn_ordered(&command)
                .unwrap_or_else(|error| panic!("spawn {index} of {count} failed: {error}"));
            fixture.track_process(session.pid);
            sessions.push(session);
        }
        // Leave output in flight on many readers when the image handoff begins.
        for (index, session) in sessions.iter().enumerate() {
            client
                .write_ordered(&session.pty, 1, format!("BEFORE-{index}\n").as_bytes())
                .unwrap();
        }
        for index in [0, count / 2, count - 1] {
            wait_text(&client, &sessions[index].pty, &format!("BEFORE-{index}"));
        }
        client.flush_operation_receipts().unwrap();
        let usage = client.inventory().unwrap().capacity.resources.unwrap();
        eprintln!(
            "{count} PTYs: descriptors={}/{}, processes={}/{}, reclaimable_memory={} bytes, spawn_reserve={} bytes, checkpoint_limit={} bytes",
            usage.open_descriptors,
            usage.descriptor_limit,
            usage.occupied_processes,
            usage.process_limit,
            usage.available_memory_bytes,
            usage.spawn_memory_reserve_bytes,
            usage.checkpoint_byte_limit
        );
        let operation = OperationId::parse(format!("replace-{count}")).unwrap();
        client
            .replacement_phase(
                operation.clone(),
                ReplacementPhase::Prepare {
                    executable: PathBuf::from(env!(
                        "CARGO_BIN_EXE_openforge-session-daemon-fixture-v2"
                    )),
                },
            )
            .unwrap();
        fixture.status(operation.as_str(), "prepared");
        let started = Instant::now();
        let commit = client.replacement_phase(operation.clone(), ReplacementPhase::Commit);
        assert!(
            commit.is_ok() || matches!(&commit, Err(Error::Transport(_) | Error::OutcomeUnknown)),
            "unexpected replacement refusal: {commit:?}"
        );
        fixture.status(operation.as_str(), "activated");
        let log = std::fs::read_to_string(fixture.root().join("fixture.log")).unwrap();
        let metrics = log
            .lines()
            .rev()
            .find_map(|line| line.strip_prefix("session handoff metrics: "))
            .expect("bounded checkpoint and pause metrics");
        let numbers: Vec<usize> = metrics
            .split(',')
            .map(|value| value.parse().unwrap())
            .collect();
        assert_eq!(numbers.len(), 3);
        assert!(numbers[0] > count, "checkpoint body omitted live state");
        assert_eq!(numbers[1], count + 4, "unexpected inherited FD inventory");
        assert!(numbers[2] < 10_000, "handoff pause exceeded ten seconds");
        eprintln!(
            "{count} PTYs: checkpoint={} bytes, inherited={} FDs, pause={}ms",
            numbers[0], numbers[1], numbers[2]
        );
        eprintln!("replacement of {count} PTYs took {:?}", started.elapsed());
        let next = Client::connect(fixture.root()).unwrap();
        next.enable_operation_retirement().unwrap();
        let inventory = next.inventory().unwrap();
        assert_eq!(inventory.capacity.live_sessions, count);
        for (index, original) in sessions.iter().enumerate() {
            let restored = inventory
                .sessions
                .iter()
                .find(|session| session.pty == original.pty)
                .unwrap();
            assert_eq!(restored.pid, original.pid, "process {index} restarted");
            assert_eq!(restored.owner, original.owner);
        }
        for (index, original) in sessions.iter().enumerate() {
            wait_text(&next, &original.pty, &format!("BEFORE-{index}"));
        }
        for index in [0, count / 2, count - 1] {
            let pty = &sessions[index].pty;
            next.resize_ordered(pty, 2, 90, 30).unwrap();
            next.write_ordered(pty, 3, format!("AFTER-{index}\n").as_bytes())
                .unwrap();
            wait_text(&next, pty, &format!("AFTER-{index}"));
        }
    }
}
