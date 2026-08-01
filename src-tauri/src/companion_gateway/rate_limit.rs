use std::{
    collections::{HashMap, VecDeque},
    net::IpAddr,
    sync::Mutex,
    time::{Duration, Instant},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RateLimitError {
    Limited,
    Unavailable,
}

#[derive(Default)]
struct SlidingWindowState {
    by_peer: HashMap<IpAddr, VecDeque<Instant>>,
    global: VecDeque<Instant>,
}

pub(crate) struct SlidingWindowRateLimiter {
    state: Mutex<SlidingWindowState>,
    per_peer_limit: usize,
    global_limit: usize,
    max_peers: usize,
    window: Duration,
}

impl SlidingWindowRateLimiter {
    pub(crate) fn new(
        per_peer_limit: usize,
        global_limit: usize,
        max_peers: usize,
        window: Duration,
    ) -> Self {
        Self {
            state: Mutex::new(SlidingWindowState::default()),
            per_peer_limit,
            global_limit,
            max_peers,
            window,
        }
    }

    pub(crate) fn admit(&self, peer: IpAddr) -> Result<(), RateLimitError> {
        let now = Instant::now();
        let mut state = self.state.lock().map_err(|_| RateLimitError::Unavailable)?;
        prune_attempts(&mut state.global, now, self.window);
        if state.global.len() >= self.global_limit {
            return Err(RateLimitError::Limited);
        }
        state.by_peer.retain(|_, attempts| {
            prune_attempts(attempts, now, self.window);
            !attempts.is_empty()
        });
        if !state.by_peer.contains_key(&peer) && state.by_peer.len() >= self.max_peers {
            return Err(RateLimitError::Limited);
        }
        let attempts = state.by_peer.entry(peer).or_default();
        if attempts.len() >= self.per_peer_limit {
            return Err(RateLimitError::Limited);
        }
        attempts.push_back(now);
        state.global.push_back(now);
        Ok(())
    }
}

fn prune_attempts(attempts: &mut VecDeque<Instant>, now: Instant, window: Duration) {
    while attempts
        .front()
        .is_some_and(|attempt| now.duration_since(*attempt) >= window)
    {
        attempts.pop_front();
    }
}
