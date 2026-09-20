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

pub(super) struct Origin {
    pub task_id: String,
    pub cwd: PathBuf,
    pub instance: u64,
    pub current: RwLock<bool>,
}

#[derive(Default)]
struct Registry {
    discovery: Option<Discovery>,
    active: HashMap<String, Arc<Origin>>,
    latest: HashMap<String, Weak<Origin>>,
}

/// Receives ownership only from successful local PTY registration, never output text.
#[derive(Clone, Default)]
pub(crate) struct LocalDiscovery(Arc<Mutex<Registry>>);

impl LocalDiscovery {
    pub(crate) fn configure(&self, discovery: Discovery) {
        self.0.lock().unwrap_or_else(|p| p.into_inner()).discovery = Some(discovery);
    }
    pub(crate) fn register(&self, key: &str, task_id: &str, cwd: PathBuf, instance: u64) {
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
        });
        registry.latest.insert(key.into(), Arc::downgrade(&origin));
        registry.active.insert(key.into(), origin);
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
        if !*self
            .origin
            .current
            .read()
            .unwrap_or_else(|p| p.into_inner())
        {
            self.detector.reset();
            return;
        }
        self.detector
            .feed(text.as_bytes(), Instant::now(), |candidate| {
                self.discovery.submit(Signal {
                    origin: self.origin.clone(),
                    candidate,
                });
            });
    }
    pub(crate) fn gap(&mut self) {
        self.detector.reset();
    }
}
