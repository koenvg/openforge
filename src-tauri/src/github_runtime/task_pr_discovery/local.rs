use super::{
    coordinator::{Discovery, Signal},
    detector::Detector,
};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex, RwLock, Weak},
    time::Instant,
};

#[derive(Default)]
pub(super) struct Completion {
    pub generation: u64,
    pub scheduled: bool,
}

pub(super) struct Origin {
    pub task_id: String,
    pub cwd: PathBuf,
    pub instance: u64,
    pub current: RwLock<bool>,
    pub agent: bool,
    pub completion: Mutex<Completion>,
}

#[derive(Default)]
struct Registry {
    discovery: Option<Discovery>,
    active: HashMap<String, Arc<Origin>>,
    latest: HashMap<String, Weak<Origin>>,
}

/// Receives ownership from successful PTY registration or current daemon inventory, never output text.
#[derive(Clone, Default)]
pub(crate) struct LocalDiscovery(Arc<Mutex<Registry>>);

impl LocalDiscovery {
    pub(crate) fn configure(&self, discovery: Discovery) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).discovery = Some(discovery);
    }
    pub(crate) fn register(&self, key: &str, task_id: &str, cwd: PathBuf, instance: u64) {
        self.register_origin(key, task_id, cwd, instance, false);
    }
    pub(crate) fn ensure_agent(&self, task_id: &str, cwd: PathBuf, instance: u64) {
        let matches = self
            .0
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .active
            .get(task_id)
            .is_some_and(|o| o.agent && o.instance == instance);
        if !matches {
            self.register_agent(task_id, cwd, instance);
        }
    }
    pub(crate) fn register_agent(&self, task_id: &str, cwd: PathBuf, instance: u64) {
        self.register_origin(task_id, task_id, cwd, instance, true);
    }
    fn register_origin(&self, key: &str, task_id: &str, cwd: PathBuf, instance: u64, agent: bool) {
        self.invalidate(key);
        let Ok(cwd) = cwd.canonicalize() else {
            return;
        };
        let mut registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if registry.discovery.is_none() {
            return;
        }
        registry
            .latest
            .retain(|_, origin| origin.strong_count() > 0);
        let origin = Arc::new(Origin {
            task_id: task_id.into(),
            cwd,
            instance,
            current: RwLock::new(true),
            agent,
            completion: Mutex::new(Completion::default()),
        });
        registry.latest.insert(key.into(), Arc::downgrade(&origin));
        registry.active.insert(key.into(), origin);
    }
    pub(crate) fn lifecycle(&self, change: &crate::agent_lifecycle::AgentLifecycleStatusChange) {
        use crate::agent_lifecycle::AgentLifecycleEventKind;
        if change.stage != "implementing" {
            return;
        }
        let Some(instance) = change.pty_instance_id else {
            return;
        };
        if change.status == "running" || change.status == "paused" || change.status == "failed" {
            let registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(origin) = registry
                .latest
                .get(&change.task_id)
                .and_then(Weak::upgrade)
                .filter(|o| o.agent && o.instance == instance)
            {
                let mut completion = origin.completion.lock().unwrap_or_else(|p| p.into_inner());
                completion.generation = completion.generation.wrapping_add(1);
                completion.scheduled = false;
            }
        } else if change.previous_status == "running"
            && change.status == "completed"
            && matches!(
                change.kind,
                AgentLifecycleEventKind::BecameIdle | AgentLifecycleEventKind::Ended
            )
        {
            self.agent_exited(&change.task_id, instance, true);
        }
    }
    pub(crate) fn agent_exited(&self, key: &str, instance: u64, success: bool) {
        let registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let Some(origin) = registry
            .latest
            .get(key)
            .and_then(Weak::upgrade)
            .filter(|o| o.agent && o.instance == instance)
        else {
            return;
        };
        if success {
            let mut completion = origin.completion.lock().unwrap_or_else(|p| p.into_inner());
            if !completion.scheduled {
                completion.scheduled = true;
                if let Some(discovery) = &registry.discovery {
                    discovery.complete(origin.clone(), completion.generation);
                }
            }
        }
    }
    pub(crate) fn invalidate(&self, key: &str) {
        let mut registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(origin) = registry.latest.remove(key).and_then(|o| o.upgrade()) {
            *origin.current.write().unwrap_or_else(|p| p.into_inner()) = false;
        }
        registry.active.remove(key);
    }
    pub(crate) fn finish(&self, key: &str, instance: u64) {
        let mut registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if registry
            .active
            .get(key)
            .is_some_and(|o| o.instance == instance)
        {
            registry.active.remove(key);
        }
    }
    pub(crate) fn observer(&self, key: &str, instance: u64) -> Option<OutputObserver> {
        let registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let origin = registry
            .active
            .get(key)
            .filter(|o| o.instance == instance)?
            .clone();
        Some(OutputObserver {
            origin,
            discovery: registry.discovery.clone()?,
            detector: Detector::default(),
        })
    }
}

pub(crate) struct OutputObserver {
    origin: Arc<Origin>,
    discovery: Discovery,
    detector: Detector,
}
impl OutputObserver {
    pub(crate) fn output(&mut self, text: &str) {
        self.output_bytes(text.as_bytes());
    }

    pub(crate) fn output_bytes(&mut self, bytes: &[u8]) {
        if !*self
            .origin
            .current
            .read()
            .unwrap_or_else(|p| p.into_inner())
        {
            self.detector.reset();
            return;
        }
        self.detector.feed(bytes, Instant::now(), |candidate| {
            self.discovery.submit(Signal {
                origin: self.origin.clone(),
                candidate: Some(candidate),
                completion: None,
            });
        });
    }
    pub(crate) fn gap(&mut self) {
        self.detector.reset();
    }
}
