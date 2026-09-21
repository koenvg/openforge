use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, Weak,
    },
};

/// Tickets live only while callers overlap, including time waiting for the shared
/// request permit. A later periodic or explicit refresh always gets a fresh ticket.
#[derive(Default)]
pub(super) struct PrRefreshRequests(Mutex<HashMap<String, Weak<AtomicBool>>>);

pub(crate) struct PrRefreshRequest(Arc<AtomicBool>);
impl PrRefreshRequest {
    pub(crate) fn claim(&self) -> bool {
        !self.0.swap(true, Ordering::SeqCst)
    }
}
impl PrRefreshRequests {
    pub(super) fn register(&self, key: String) -> PrRefreshRequest {
        let mut requests = self.0.lock().unwrap_or_else(|e| e.into_inner());
        requests.retain(|_, request| request.strong_count() > 0);
        let ticket = requests
            .get(&key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let ticket = Arc::new(AtomicBool::new(false));
                requests.insert(key, Arc::downgrade(&ticket));
                ticket
            });
        PrRefreshRequest(ticket)
    }
}
impl super::GitHubClient {
    pub(crate) fn pr_refresh_request(&self, key: String) -> PrRefreshRequest {
        self.pr_refresh_requests.register(key)
    }
}
