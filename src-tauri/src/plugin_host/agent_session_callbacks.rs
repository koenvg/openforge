use super::callbacks::{
    optional_param_string, optional_param_u64, optional_param_usize, required_param_string,
};
use super::PluginHost;
use serde_json::Value;

impl PluginHost {
    pub(super) fn list_agent_sessions_for_host(&self, params: &Value) -> Result<Value, String> {
        let _plugin_id = required_param_string(params, "pluginId")?;
        let provider = required_param_string(params, "provider")?;
        let overlaps = params
            .get("overlaps")
            .filter(|value| value.is_object())
            .ok_or_else(|| "plugin host callback missing object param: overlaps".to_string())?;
        let start_inclusive = optional_param_u64(overlaps, "startInclusive")?.ok_or_else(|| {
            "plugin host callback missing integer param: overlaps.startInclusive".to_string()
        })?;
        let end_exclusive = optional_param_u64(overlaps, "endExclusive")?.ok_or_else(|| {
            "plugin host callback missing integer param: overlaps.endExclusive".to_string()
        })?;
        let start_inclusive = i64::try_from(start_inclusive).map_err(|_| {
            "plugin host callback integer param out of range: overlaps.startInclusive".to_string()
        })?;
        let end_exclusive = i64::try_from(end_exclusive).map_err(|_| {
            "plugin host callback integer param out of range: overlaps.endExclusive".to_string()
        })?;
        if start_inclusive >= end_exclusive {
            return Err(
                "plugin host callback overlaps.startInclusive must be less than overlaps.endExclusive"
                    .to_string(),
            );
        }

        let task_id = optional_param_string(params, "taskId")?;
        let cursor = optional_param_string(params, "cursor")?;
        let page_size = optional_param_usize(params, "pageSize")?
            .ok_or_else(|| "plugin host callback missing integer param: pageSize".to_string())?;
        if !(1..=crate::db::MAX_AGENT_SESSION_PAGE_SIZE).contains(&page_size) {
            return Err(format!(
                "plugin host callback pageSize must be between 1 and {}",
                crate::db::MAX_AGENT_SESSION_PAGE_SIZE
            ));
        }

        let db_state = self.database_state_for_host()?;
        let db = crate::db::acquire_db(db_state.as_ref());
        let page = db
            .list_agent_sessions(
                &provider,
                start_inclusive,
                end_exclusive,
                task_id.as_deref(),
                cursor.as_deref(),
                page_size,
            )
            .map_err(|error| format!("failed to list Agent Sessions: {error}"))?;
        serde_json::to_value(page)
            .map_err(|error| format!("failed to serialize Agent Sessions: {error}"))
    }
}
