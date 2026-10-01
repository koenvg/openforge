use super::{Authority, InputRoutes};
use crate::pty_manager::daemon_transport::CommandFence;
use openforge_session_host::{
    Controller, ControllerGeneration, DaemonLifetimeId, InstallationId, PtyIdentity, PtyInstanceId,
    TerminalOwner,
};
use openforge_session_protocol::{Error, Session};
use std::cell::{Cell, RefCell};

const KEY: &str = "task-1";

struct FakeDaemon {
    controller: Controller,
    sessions: RefCell<Vec<Session>>,
    lookups: Cell<usize>,
}

impl FakeDaemon {
    fn new(sessions: Vec<Session>) -> Self {
        Self {
            controller: controller(1),
            sessions: RefCell::new(sessions),
            lookups: Cell::new(0),
        }
    }
}

impl Authority for FakeDaemon {
    fn controller(&self) -> &Controller {
        &self.controller
    }
    fn newest(&self, key: &str) -> Result<Option<Session>, Error> {
        self.lookups.set(self.lookups.get() + 1);
        Ok(self
            .sessions
            .borrow()
            .iter()
            .filter(|session| session.session_key == key)
            .max_by_key(|session| session.pty.instance.value())
            .cloned())
    }
}

fn controller(generation: u64) -> Controller {
    Controller {
        installation: InstallationId::parse("install").unwrap(),
        lifetime: DaemonLifetimeId::parse("lifetime").unwrap(),
        generation: ControllerGeneration::new(generation).unwrap(),
    }
}

fn pty(instance: u64) -> PtyIdentity {
    PtyIdentity {
        installation: InstallationId::parse("install").unwrap(),
        lifetime: DaemonLifetimeId::parse("lifetime").unwrap(),
        instance: PtyInstanceId::new(instance).unwrap(),
    }
}

fn session(instance: u64, next_io_sequence: u64) -> Session {
    Session {
        pty: pty(instance),
        session_key: KEY.into(),
        owner: TerminalOwner::Agent {
            task_id: KEY.into(),
        },
        cwd: None,
        pid: 1,
        exit_code: None,
        next_io_sequence: Some(next_io_sequence),
    }
}

fn fence(generation: u64, instance_id: u64) -> CommandFence {
    CommandFence {
        controller: controller(generation),
        instance_id,
    }
}

#[test]
fn repeated_input_reads_inventory_once_and_advances_the_sequence() {
    let daemon = FakeDaemon::new(vec![session(1, 4)]);
    let mut routes = InputRoutes::default();
    let mut sent = Vec::new();
    for _ in 0..3 {
        routes
            .send(&daemon, KEY, None, |pty, sequence| {
                sent.push((pty.instance.value(), sequence));
                Ok(())
            })
            .unwrap();
    }
    assert_eq!(sent, [(1, 4), (1, 5), (1, 6)]);
    assert_eq!(daemon.lookups.get(), 1);
}

#[test]
fn out_of_order_refusal_refreshes_the_route_and_retries_once() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    routes.send(&daemon, KEY, None, |_, _| Ok(())).unwrap();
    daemon.sessions.replace(vec![session(1, 9)]);
    let mut sent = Vec::new();
    routes
        .send(&daemon, KEY, None, |_, sequence| {
            sent.push(sequence);
            if sequence == 9 {
                Ok(())
            } else {
                Err(Error::OutOfOrder)
            }
        })
        .unwrap();
    assert_eq!(sent, [2, 9]);
    assert_eq!(daemon.lookups.get(), 2);
}

#[test]
fn a_refusal_on_a_fresh_route_is_returned_without_retry() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    let mut attempts = 0;
    let result = routes.send(&daemon, KEY, None, |_, _| {
        attempts += 1;
        Err(Error::OutOfOrder)
    });
    assert!(matches!(result, Err(Error::OutOfOrder)));
    assert_eq!(attempts, 1);
    routes.send(&daemon, KEY, None, |_, _| Ok(())).unwrap();
    assert_eq!(daemon.lookups.get(), 2);
}

#[test]
fn an_unknown_outcome_drops_the_route() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    let result = routes.send(&daemon, KEY, None, |_, _| Err(Error::OutcomeUnknown));
    assert!(matches!(result, Err(Error::OutcomeUnknown)));
    daemon.sessions.replace(vec![session(1, 2)]);
    let mut sent = Vec::new();
    routes
        .send(&daemon, KEY, None, |_, sequence| {
            sent.push(sequence);
            Ok(())
        })
        .unwrap();
    assert_eq!(sent, [2]);
}

#[test]
fn fenced_input_follows_a_replacement_pty_that_matches_the_fence() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    routes.send(&daemon, KEY, None, |_, _| Ok(())).unwrap();
    daemon.sessions.replace(vec![session(1, 2), session(2, 1)]);
    let mut sent = Vec::new();
    routes
        .send(&daemon, KEY, Some(&fence(1, 2)), |pty, sequence| {
            sent.push((pty.instance.value(), sequence));
            Ok(())
        })
        .unwrap();
    assert_eq!(sent, [(2, 1)]);
}

#[test]
fn fenced_input_for_a_replaced_pty_is_stale_without_sending() {
    let daemon = FakeDaemon::new(vec![session(1, 1), session(2, 1)]);
    let mut routes = InputRoutes::default();
    let result = routes.send(&daemon, KEY, Some(&fence(1, 1)), |_, _| {
        panic!("stale input must not reach the daemon")
    });
    assert!(matches!(result, Err(Error::StalePty)));
}

#[test]
fn fenced_input_from_another_controller_is_stale_controller() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    let result = routes.send(&daemon, KEY, Some(&fence(2, 1)), |_, _| {
        panic!("stale input must not reach the daemon")
    });
    assert!(matches!(result, Err(Error::StaleController)));
}

#[test]
fn input_without_a_session_is_stale() {
    let daemon = FakeDaemon::new(Vec::new());
    let mut routes = InputRoutes::default();
    let result = routes.send(&daemon, KEY, None, |_, _| {
        panic!("input without a session must not reach the daemon")
    });
    assert!(matches!(result, Err(Error::StalePty)));
}

#[test]
fn cleared_routes_follow_the_newest_pty() {
    let daemon = FakeDaemon::new(vec![session(1, 1)]);
    let mut routes = InputRoutes::default();
    routes.send(&daemon, KEY, None, |_, _| Ok(())).unwrap();
    daemon.sessions.replace(vec![session(1, 2), session(2, 1)]);
    routes.clear();
    let mut sent = Vec::new();
    routes
        .send(&daemon, KEY, None, |pty, sequence| {
            sent.push((pty.instance.value(), sequence));
            Ok(())
        })
        .unwrap();
    assert_eq!(sent, [(2, 1)]);
}
