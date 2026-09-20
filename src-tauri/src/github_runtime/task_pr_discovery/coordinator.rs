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
    pub candidate: Option<Candidate>,
    pub completion: Option<u64>,
}
struct Pending {
    signal: Signal,
    _slot: OwnedSemaphorePermit,
}
enum Message {
    Signal(Pending),
    Completion(Pending),
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
                recent: Default::default(),
            },
        ));
        Self {
            tx,
            slots: Arc::new(Semaphore::new(SIGNAL_LIMIT)),
        }
    }
    pub(super) fn complete(&self, origin: Arc<Origin>, generation: u64) {
        let Ok(slot) = self.slots.clone().try_acquire_owned() else {
            log::debug!(
                "[PR discovery] completion signal capacity exhausted; reconciliation will recover"
            );
            return;
        };
        let _ = self.tx.try_send(Message::Completion(Pending {
            signal: Signal {
                origin,
                candidate: None,
                completion: Some(generation),
            },
            _slot: slot,
        }));
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
    pub(crate) async fn completion_barrier(&self) -> tokio::sync::oneshot::Receiver<()> {
        let (tx, rx) = tokio::sync::oneshot::channel();
        self.tx.send(Message::Barrier(tx)).await.unwrap();
        rx
    }
    #[cfg(test)]
    pub(crate) async fn settled(&self) {
        tokio::time::timeout(
            // Capacity tests drain 256 discoveries plus their immediate detail requests.
            std::time::Duration::from_secs(30),
            self.completion_barrier().await,
        )
        .await
        .expect("discovery settled")
        .unwrap();
    }
}
impl Signal {
    pub(super) fn is_current(&self) -> bool {
        *self
            .origin
            .current
            .read()
            .unwrap_or_else(|p| p.into_inner())
            && self.completion.is_none_or(|generation| {
                self.origin
                    .completion
                    .lock()
                    .unwrap_or_else(|p| p.into_inner())
                    .generation
                    == generation
            })
    }
}

fn has_task_capacity(
    task: &str,
    tasks: &HashMap<String, VecDeque<Pending>>,
    timers: &HashMap<String, usize>,
) -> bool {
    tasks.contains_key(task)
        || timers.contains_key(task)
        || tasks
            .keys()
            .chain(timers.keys())
            .collect::<std::collections::HashSet<_>>()
            .len()
            < TASK_LIMIT
}

fn enqueue(
    pending: Pending,
    tasks: &mut HashMap<String, VecDeque<Pending>>,
    jobs: &mut JoinSet<String>,
    execution: &Execution,
) {
    let task = pending.signal.origin.task_id.clone();
    if !tasks.contains_key(&task) && tasks.len() == TASK_LIMIT {
        log::debug!("[PR discovery] task capacity exhausted; reconciliation will recover");
        return;
    }
    let queue = tasks.entry(task).or_default();
    if queue.iter().any(|p| {
        p.signal.candidate == pending.signal.candidate
            && p.signal.completion == pending.signal.completion
            && Arc::ptr_eq(&p.signal.origin, &pending.signal.origin)
    }) {
        return;
    }
    if queue.is_empty() {
        launch(jobs, execution, pending.signal.clone());
    }
    queue.push_back(pending);
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
    let mut timers = JoinSet::new();
    let mut timer_tasks = HashMap::<String, usize>::new();
    let mut open = true;
    #[cfg(test)]
    let mut barriers = Vec::new();
    while open || !jobs.is_empty() || !timers.is_empty() {
        tokio::select! {
            // Drain available signals before completions so repeated output coalesces.
            biased;
            message = rx.recv(), if open => match message {
                Some(Message::Signal(pending)) => {
                    if !has_task_capacity(&pending.signal.origin.task_id, &tasks, &timer_tasks) {
                        log::debug!("[PR discovery] task capacity exhausted; reconciliation will recover");
                        continue;
                    }
                    enqueue(pending, &mut tasks, &mut jobs, &execution);
                }
                Some(Message::Completion(pending)) => {
                    if timers.len() >= TASK_LIMIT || !has_task_capacity(&pending.signal.origin.task_id, &tasks, &timer_tasks) {
                        log::debug!("[PR discovery] completion capacity exhausted; reconciliation will recover");
                        continue;
                    }
                    *timer_tasks.entry(pending.signal.origin.task_id.clone()).or_default() += 1;
                    let clock = execution.clock.clone();
                    timers.spawn(async move {
                        clock.sleep(std::time::Duration::from_secs(2)).await;
                        pending
                    });
                }
                #[cfg(test)]
                Some(Message::Barrier(done)) => barriers.push(done),
                None => open = false,
            },
            result = timers.join_next(), if !timers.is_empty() => {
                if let Some(Ok(pending)) = result {
                    let task = &pending.signal.origin.task_id;
                    if let Some(count) = timer_tasks.get_mut(task) {
                        *count -= 1;
                        if *count == 0 { timer_tasks.remove(task); }
                    }
                    if pending.signal.is_current() { enqueue(pending, &mut tasks, &mut jobs, &execution); }
                }
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
        if tasks.is_empty() && timers.is_empty() {
            for done in barriers.drain(..) {
                let _ = done.send(());
            }
        }
    }
}
