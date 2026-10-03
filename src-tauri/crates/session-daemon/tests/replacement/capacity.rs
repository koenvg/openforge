use super::support::{wait_text, Fixture, FixtureOptions};
use openforge_session_host::CapacityKind;
use openforge_session_protocol::*;
use std::collections::BTreeMap;
#[test]
fn descriptor_pressure_refuses_only_the_new_spawn() {
    let (mut fixture, client) = Fixture::with_options(FixtureOptions {
        fd_limit: Some(128),
        ..Default::default()
    });
    client.enable_operation_retirement().unwrap();
    let mut oldest = None;
    let mut admitted = 0;
    for index in 0..64 {
        let command = ShellCommand {
            owner: TerminalOwner::Shell {
                task_id: "fd-admission".into(),
                index: Some(index),
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
        match client.spawn_ordered(&command) {
            Ok(session) => {
                fixture.track_process(session.pid);
                oldest.get_or_insert(session.pty);
                admitted += 1;
            }
            Err(Error::CapacityExceeded(CapacityKind::FileDescriptors)) => break,
            Err(error) => panic!("admission {index} failed without capacity diagnosis: {error}"),
        }
    }
    assert!(
        admitted > 0 && admitted < 64,
        "unexpected admitted count {admitted}"
    );
    let oldest = oldest.unwrap();
    client
        .write_ordered(&oldest, 1, b"pressure-survivor\n")
        .unwrap();
    wait_text(&client, &oldest, "pressure-survivor");
    assert_eq!(client.inventory().unwrap().capacity.live_sessions, admitted);
}
