use super::{newest_session, CommandFence};
use openforge_session_client::Client;
use openforge_session_host::{Controller, PtyIdentity};
use openforge_session_protocol::{Error, Session};
use std::collections::HashMap;

pub(super) trait Authority {
    fn controller(&self) -> &Controller;
    fn newest(&self, key: &str) -> Result<Option<Session>, Error>;
}

impl Authority for Client {
    fn controller(&self) -> &Controller {
        Client::controller(self)
    }
    fn newest(&self, key: &str) -> Result<Option<Session>, Error> {
        Ok(newest_session(self.inventory()?.sessions, key))
    }
}

#[derive(Clone)]
struct Route {
    pty: PtyIdentity,
    next: u64,
}

#[derive(Default)]
pub(super) struct InputRoutes(HashMap<String, Route>);

impl InputRoutes {
    /// Retries once from fresh inventory only when a cached route is refused before
    /// the daemon reserves its sequence, so input is never applied twice.
    pub(super) fn send(
        &mut self,
        authority: &impl Authority,
        key: &str,
        fence: Option<&CommandFence>,
        mut send: impl FnMut(&PtyIdentity, u64) -> Result<(), Error>,
    ) -> Result<(), Error> {
        if fence.is_some_and(|fence| &fence.controller != authority.controller()) {
            return Err(Error::StaleController);
        }
        let mut cached = self.0.get(key).cloned();
        loop {
            let from_cache = cached.is_some();
            let route = match cached.take() {
                Some(route) => route,
                None => fresh(authority, key)?,
            };
            if fence.is_some_and(|fence| route.pty.instance.value() != fence.instance_id) {
                self.0.remove(key);
                if from_cache {
                    continue;
                }
                return Err(Error::StalePty);
            }
            match send(&route.pty, route.next) {
                Ok(()) => {
                    let next = route.next.checked_add(1).ok_or(Error::Capacity)?;
                    self.0.insert(key.into(), Route { next, ..route });
                    return Ok(());
                }
                Err(Error::OutOfOrder | Error::StalePty) if from_cache => {
                    self.0.remove(key);
                }
                Err(error) => {
                    self.0.remove(key);
                    return Err(error);
                }
            }
        }
    }

    pub(super) fn clear(&mut self) {
        self.0.clear();
    }
}

fn fresh(authority: &impl Authority, key: &str) -> Result<Route, Error> {
    let session = authority.newest(key)?.ok_or(Error::StalePty)?;
    Ok(Route {
        next: session.next_io_sequence.ok_or(Error::Capacity)?,
        pty: session.pty,
    })
}

#[cfg(test)]
#[path = "input_routes_tests.rs"]
mod tests;
