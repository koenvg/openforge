use super::{detector::Candidate, execution::Execution, local::Origin};
use crate::{app_events::RuntimeEventPublisher, db::Database, github_client::GitHubClient};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::{
    sync::{mpsc, OwnedSemaphorePermit, Semaphore},
    task::JoinSet,
};

const SIGNAL_LIMIT: usize = 256;
const TASK_LIMIT: usize = 128;

#[derive(Clone)]
pub(super) struct Signal {
    pub origin: Arc<Origin>,
    pub candidate: Candidate,
}
struct Pending {
    signal: Signal,
    _slot: OwnedSemaphorePermit,
}
enum Message {
    Signal(Pending),
    #[cfg(test)]
    Barrier(tokio::sync::oneshot::Sender<()>),
}
#[derive(Clone)]
pub(crate) struct Discovery {
    tx: mpsc::Sender<Message>,
    slots: Arc<Semaphore>,
}
impl Discovery {
    pub(crate) fn start(
        db: Arc<Mutex<Database>>,
        github: GitHubClient,
        events: RuntimeEventPublisher,
    ) -> Self {
        Self::with_clock(db, github, events, Arc::new(super::clock::SystemClock))
    }
    pub(super) fn with_clock(
        db: Arc<Mutex<Database>>,
        github: GitHubClient,
        events: RuntimeEventPublisher,
        clock: Arc<dyn super::clock::Clock>,
    ) -> Self {
        let (tx, rx) = mpsc::channel(SIGNAL_LIMIT);
        tokio::spawn(run(
            rx,
            Execution {
                db,
                github,
                events,
                clock,
            },
        ));
        Self {
            tx,
            slots: Arc::new(Semaphore::new(SIGNAL_LIMIT)),
        }
    }
    pub(super) fn submit(&self, signal: Signal) {
        let Ok(slot) = self.slots.clone().try_acquire_owned() else {
            log::debug!("[PR discovery] signal capacity exhausted; reconciliation will recover");
            return;
        };
        let _ = self.tx.try_send(Message::Signal(Pending {
            signal,
            _slot: slot,
        }));
    }
    #[cfg(test)]
    pub(crate) async fn settled(&self) {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx.send(Message::Barrier(tx)).await.unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(5), rx)
            .await
            .expect("discovery settled")
            .unwrap();
    }
}
fn launch(jobs: &mut JoinSet<String>, execution: &Execution, signal: Signal) {
    let execution = execution.clone();
    jobs.spawn(async move {
        let task = signal.origin.task_id.clone();
        execution.discover(signal).await;
        task
    });
}
async fn run(mut rx: mpsc::Receiver<Message>, execution: Execution) {
    let mut tasks: HashMap<String, VecDeque<Pending>> = HashMap::new();
    let mut jobs = JoinSet::new();
    let mut open = true;
    #[cfg(test)]
    let mut barriers = Vec::new();
    while open || !jobs.is_empty() {
        tokio::select! {
            // Drain available signals before completions so repeated output coalesces.
            biased;
            message = rx.recv(), if open => match message {
                Some(Message::Signal(pending)) => {
                    let task = pending.signal.origin.task_id.clone();
                    if !tasks.contains_key(&task) && tasks.len() == TASK_LIMIT {
                        log::debug!("[PR discovery] task capacity exhausted; reconciliation will recover");
                        continue;
                    }
                    let queue = tasks.entry(task).or_default();
                    if queue.iter().any(|p| p.signal.candidate == pending.signal.candidate && Arc::ptr_eq(&p.signal.origin, &pending.signal.origin)) { continue; }
                    if queue.is_empty() { launch(&mut jobs, &execution, pending.signal.clone()); }
                    queue.push_back(pending);
                }
                #[cfg(test)]
                Some(Message::Barrier(done)) => barriers.push(done),
                None => open = false,
            },
            result = jobs.join_next(), if !jobs.is_empty() => {
                match result {
                    Some(Ok(task)) => {
                        if let Some(queue) = tasks.get_mut(&task) {
                            queue.pop_front();
                            if let Some(next) = queue.front() { launch(&mut jobs, &execution, next.signal.clone()); }
                            else { tasks.remove(&task); }
                        }
                    }
                    _ => { log::warn!("[PR discovery] worker failed; closing queue for recovery"); break; }
                }
            }
        }
        #[cfg(test)]
        if tasks.is_empty() {
            for done in barriers.drain(..) {
                let _ = done.send(());
            }
        }
    }
}
