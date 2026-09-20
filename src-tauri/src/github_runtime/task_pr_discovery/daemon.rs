use super::{local::OutputObserver, LocalDiscovery};
use openforge_session_protocol::{Event, EventBatch, Session};
use std::collections::HashMap;

struct Stream {
    session: Session,
    observer: OutputObserver,
    sequence: Option<u64>,
    finished: bool,
}
impl Stream {
    fn owns(&self, session: &Session) -> bool {
        self.session.pty == session.pty
            && self.session.owner == session.owner
            && self.session.cwd == session.cwd
            && session.owner.session_key() == session.session_key
    }
    fn output(&mut self, sequence: u64, data: &[u8]) {
        if self.finished || self.sequence.is_some_and(|last| sequence <= last) {
            return;
        }
        if self
            .sequence
            .is_some_and(|last| last.checked_add(1) != Some(sequence))
        {
            self.observer.gap();
        }
        self.sequence = Some(sequence);
        self.observer.output_bytes(data);
    }
}

/// Consumes current inventory and live event batches, never recovery snapshots.
pub(crate) struct DaemonOutput {
    registry: LocalDiscovery,
    streams: HashMap<String, Stream>,
    cursor: u64,
}
impl DaemonOutput {
    pub(crate) fn new(registry: LocalDiscovery) -> Self {
        Self {
            registry,
            streams: HashMap::new(),
            cursor: 0,
        }
    }
    pub(crate) fn disconnect(&mut self) {
        for key in self.streams.keys() {
            self.registry.invalidate(key);
        }
        self.streams.clear();
    }
    pub(crate) fn resume(&mut self, cursor: u64) {
        self.disconnect();
        self.cursor = cursor;
    }
    pub(crate) fn accept(&mut self, sessions: &[Session], batch: &EventBatch) {
        // Inventory remains authoritative even when no new output was delivered.
        self.streams.retain(|key, stream| {
            let current = sessions
                .iter()
                .any(|s| &s.session_key == key && stream.owns(s));
            if !current {
                self.registry.invalidate(key);
            }
            current
        });
        if batch.cursor <= self.cursor {
            return;
        }
        self.cursor = batch.cursor;
        if batch.gap {
            for stream in self.streams.values_mut() {
                stream.observer.gap();
            }
            return;
        }
        for session in sessions {
            let Some(cwd) = &session.cwd else { continue };
            if session.owner.session_key() != session.session_key {
                continue;
            }
            let key = &session.session_key;
            if !self.streams.contains_key(key) {
                self.registry.register(
                    key,
                    session.owner.task_id(),
                    cwd.clone(),
                    session.pty.instance.value(),
                );
                let Some(observer) = self.registry.observer(key, session.pty.instance.value())
                else {
                    continue;
                };
                self.streams.insert(
                    key.clone(),
                    Stream {
                        session: session.clone(),
                        observer,
                        sequence: None,
                        finished: false,
                    },
                );
            }
            let Some(stream) = self.streams.get_mut(key) else {
                continue;
            };
            for event in &batch.events {
                match event {
                    Event::Output {
                        pty,
                        sequence,
                        data,
                    } if pty == &session.pty => stream.output(*sequence, data),
                    Event::Exited { pty, .. } if pty == &session.pty => {
                        stream.observer.gap();
                        stream.finished = true;
                        self.registry.finish(key, pty.instance.value());
                    }
                    Event::RecoveryRequired { pty } if pty == &session.pty => stream.observer.gap(),
                    _ => {}
                }
            }
        }
    }
}

impl Drop for DaemonOutput {
    fn drop(&mut self) {
        self.disconnect();
    }
}
