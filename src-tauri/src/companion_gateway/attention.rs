use crate::task_attention::TaskAttentionRow;
use std::sync::{Arc, Mutex};

pub(crate) trait CompanionAttentionSource: Send + Sync {
    fn snapshot(&self) -> Result<Vec<TaskAttentionRow>, String>;
}

#[derive(Clone)]
pub(crate) struct DatabaseCompanionAttentionSource {
    database: Arc<Mutex<crate::db::Database>>,
}

impl DatabaseCompanionAttentionSource {
    pub(crate) fn new(database: Arc<Mutex<crate::db::Database>>) -> Self {
        Self { database }
    }
}

impl CompanionAttentionSource for DatabaseCompanionAttentionSource {
    fn snapshot(&self) -> Result<Vec<TaskAttentionRow>, String> {
        self.database
            .lock()
            .map_err(|_| "Companion attention database lock was poisoned".to_string())?
            .get_task_attention_rows()
            .map_err(|error| format!("failed to project Companion attention: {error}"))
    }
}

#[cfg(test)]
#[derive(Debug, Default)]
pub(crate) struct UnavailableCompanionAttentionSource;

#[cfg(test)]
impl CompanionAttentionSource for UnavailableCompanionAttentionSource {
    fn snapshot(&self) -> Result<Vec<TaskAttentionRow>, String> {
        Err("Companion attention source is unavailable".to_string())
    }
}
