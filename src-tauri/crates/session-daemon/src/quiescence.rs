//! Admission barrier for work whose side effects must finish before exec.
use openforge_session_protocol::Error;
use std::{sync::{Arc, Condvar, Mutex}, time::{Duration, Instant}};

#[derive(Default)]
struct State { paused: bool, active: usize }
#[derive(Default)]
pub(crate) struct Gate { state: Mutex<State>, changed: Condvar }
pub(crate) struct Permit(Arc<Gate>);
pub(crate) struct Paused(Arc<Gate>);

impl Gate {
    pub fn enter(self: &Arc<Self>) -> Option<Permit> {
        let mut state = self.state.lock().ok()?;
        if state.paused { return None; }
        state.active = state.active.checked_add(1)?;
        Some(Permit(Arc::clone(self)))
    }
    pub fn pause(self: &Arc<Self>, budget: Duration) -> Result<Paused, Error> {
        let deadline = Instant::now() + budget;
        let mut state = self.state.lock().map_err(|_| Error::OutcomeUnknown)?;
        if state.paused { return Err(Error::InvalidRequest); }
        state.paused = true;
        while state.active != 0 {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                state.paused = false;
                return Err(Error::OutcomeUnknown);
            }
            state = self.changed.wait_timeout(state, remaining)
                .map_err(|_| Error::OutcomeUnknown)?.0;
        }
        Ok(Paused(Arc::clone(self)))
    }
}
impl Drop for Permit {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() {
            state.active -= 1;
            self.0.changed.notify_all();
        }
    }
}
impl Drop for Paused {
    fn drop(&mut self) {
        if let Ok(mut state) = self.0.state.lock() { state.paused = false; }
    }
}

impl Paused {
    pub fn protects(&self, gate: &Arc<Gate>) -> bool { Arc::ptr_eq(&self.0, gate) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{sync::Arc, time::{Duration, Instant}};

    #[test]
    fn pause_waits_for_inflight_work_and_rejects_new_work_until_released() {
        let gate = Arc::new(Gate::default());
        let active = gate.enter().unwrap();
        let pausing = Arc::clone(&gate);
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let thread = std::thread::spawn(move || {
            ready_tx.send(pausing.pause(Duration::from_secs(2))).unwrap();
        });
        let deadline = Instant::now() + Duration::from_secs(1);
        while gate.enter().is_some() {
            assert!(Instant::now() < deadline);
            std::thread::yield_now();
        }
        assert!(ready_rx.try_recv().is_err());
        drop(active);
        let paused = ready_rx.recv_timeout(Duration::from_secs(2)).unwrap().unwrap();
        thread.join().unwrap();
        assert!(gate.enter().is_none());
        drop(paused);
        assert!(gate.enter().is_some());
    }

    #[test]
    fn a_failed_pause_reopens_admission_without_cancelling_inflight_work() {
        let gate = Arc::new(Gate::default());
        let active = gate.enter().unwrap();
        assert!(gate.pause(Duration::ZERO).is_err());
        assert!(gate.enter().is_some());
        drop(active);
        let paused = gate.pause(Duration::ZERO).unwrap();
        assert!(gate.enter().is_none());
        drop(paused);
        assert!(gate.enter().is_some());
    }
}
