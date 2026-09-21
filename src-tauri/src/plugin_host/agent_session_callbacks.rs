use super::callbacks::{
    optional_param_string, optional_param_u64, optional_param_usize, required_param_string,
};
use super::PluginHost;
use crate::scoped_agent_session_service::{
    OwnedSessionScope, ScopedAgentSessionError, ScopedAgentSessionService, StartScopedAgentSession,
};
use serde_json::Value;

impl PluginHost {
    fn scoped_agent_session_service_for_host(&self) -> Result<ScopedAgentSessionService, String> {
        self.app_handle
            .try_state::<ScopedAgentSessionService>()
            .map(|service| service.inner().clone())
            .ok_or_else(|| {
                "HOST_UNAVAILABLE: scoped Agent Session service is unavailable".to_string()
            })
    }

    fn scoped_session_scope(params: &Value) -> Result<OwnedSessionScope, String> {
        let value = params.get("scope").ok_or_else(|| {
            "INVALID_SCOPE: plugin host callback missing object param: scope".to_string()
        })?;
        serde_json::from_value(value.clone())
            .map_err(|error| format!("INVALID_SCOPE: invalid Session Scope: {error}"))
    }

    fn publish_scoped_session_change(&self, plugin_id: &str, scope: &OwnedSessionScope) {
        let _ = self.app_handle.emit(
            "scoped-agent-session-changed",
            serde_json::json!({
                "pluginId": plugin_id,
                "namespace": scope.namespace,
                "targetKey": scope.target_key,
                "revision": scope.revision,
            }),
        );
    }

    pub(super) async fn start_scoped_agent_session_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        if params.get("toolPolicy").is_some() {
            return Err(
                "INVALID_SCOPE: Scoped Agent Session start no longer accepts toolPolicy"
                    .to_string(),
            );
        }
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        let state = self
            .scoped_agent_session_service_for_host()?
            .start(StartScopedAgentSession {
                owner_plugin_id: plugin_id.clone(),
                scope: scope.clone(),
                project_id: required_param_string(params, "projectId")?,
                checkout_revision: required_param_string(params, "checkoutRevision")?,
                initial_input: required_param_string(params, "initialInput")?,
            })
            .await
            .map_err(scoped_error)?;
        self.publish_scoped_session_change(&plugin_id, &scope);
        serde_json::to_value(state).map_err(|error| error.to_string())
    }

    pub(super) fn scoped_agent_session_status_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        let state = self
            .scoped_agent_session_service_for_host()?
            .status(&plugin_id, &scope)
            .map_err(scoped_error)?;
        serde_json::to_value(state).map_err(|error| error.to_string())
    }

    pub(super) async fn observe_scoped_agent_session_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        let after_sequence = optional_param_u64(params, "afterSequence")?;
        let (transitions, cursor, mut has_more) = {
            let db_state = self.database_state_for_host()?;
            let db = crate::db::acquire_db(db_state.as_ref());
            match after_sequence {
                Some(after_sequence) => {
                    let mut transitions = db
                        .scoped_agent_session_events_after(
                            &plugin_id,
                            &scope.namespace,
                            &scope.target_key,
                            &scope.revision,
                            after_sequence,
                            101,
                        )
                        .map_err(|error| error.to_string())?;
                    let has_more = transitions.len() > 100;
                    transitions.truncate(100);
                    let cursor = transitions
                        .last()
                        .map_or(after_sequence, |transition| transition.sequence);
                    (transitions, cursor, has_more)
                }
                None => {
                    let cursor = db
                        .latest_scoped_agent_session_event_sequence(
                            &plugin_id,
                            &scope.namespace,
                            &scope.target_key,
                            &scope.revision,
                        )
                        .map_err(|error| error.to_string())?;
                    (Vec::new(), cursor, false)
                }
            }
        };
        let service = self.scoped_agent_session_service_for_host()?;
        let state = service.status(&plugin_id, &scope).map_err(scoped_error)?;
        let output_revision = if state.is_some() {
            service.output_revision(&plugin_id, &scope).await.ok()
        } else {
            None
        };
        let latest_sequence = {
            let db_state = self.database_state_for_host()?;
            let latest = crate::db::acquire_db(db_state.as_ref())
                .latest_scoped_agent_session_event_sequence(
                    &plugin_id,
                    &scope.namespace,
                    &scope.target_key,
                    &scope.revision,
                )
                .map_err(|error| error.to_string())?;
            latest
        };
        has_more |= latest_sequence > cursor;
        let transitions = transitions
            .into_iter()
            .map(|transition| {
                serde_json::json!({
                    "sequence": transition.sequence,
                    "state": {
                        "id": transition.session_id,
                        "turnId": transition.turn_id,
                        "status": transition.status,
                        "queuePosition": null,
                        "queueReason": null,
                        "acceptsInput": true,
                        "workspaceAvailable": transition.workspace_available,
                        "errorCode": transition.error_code,
                        "errorMessage": transition.error_message,
                        "createdAt": transition.created_at,
                        "updatedAt": transition.updated_at,
                    },
                })
            })
            .collect::<Vec<_>>();
        Ok(serde_json::json!({
            "state": state,
            "outputRevision": output_revision,
            "cursor": cursor,
            "transitions": transitions,
            "hasMore": has_more,
        }))
    }

    pub(super) async fn input_scoped_agent_session_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        let input = required_param_string(params, "input")?;
        let state = self
            .scoped_agent_session_service_for_host()?
            .input(&plugin_id, &scope, &input)
            .await
            .map_err(scoped_error)?;
        self.publish_scoped_session_change(&plugin_id, &scope);
        serde_json::to_value(state).map_err(|error| error.to_string())
    }

    pub(super) async fn abort_scoped_agent_session_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        let state = self
            .scoped_agent_session_service_for_host()?
            .abort(&plugin_id, &scope)
            .await
            .map_err(scoped_error)?;
        self.publish_scoped_session_change(&plugin_id, &scope);
        serde_json::to_value(state).map_err(|error| error.to_string())
    }

    pub(super) async fn release_scoped_agent_session_for_host(
        &self,
        params: &Value,
    ) -> Result<Value, String> {
        let plugin_id = required_param_string(params, "pluginId")?;
        let scope = Self::scoped_session_scope(params)?;
        self.scoped_agent_session_service_for_host()?
            .release(&plugin_id, &scope)
            .await
            .map_err(scoped_error)?;
        self.publish_scoped_session_change(&plugin_id, &scope);
        Ok(Value::Null)
    }

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

fn scoped_error(error: ScopedAgentSessionError) -> String {
    use crate::db::ScopedAgentSessionStoreError;
    let code = match &error {
        ScopedAgentSessionError::InvalidScope(_) => "INVALID_SCOPE",
        ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::LiveSessionExists {
            ..
        })
        | ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::SessionExists {
            ..
        }) => "DUPLICATE_SCOPE",
        ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::QueueFull { .. }) => {
            "CAPACITY"
        }
        ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::OwnershipConflict {
            ..
        })
        | ScopedAgentSessionError::Forbidden => "FORBIDDEN",
        ScopedAgentSessionError::InputTooLarge => "INPUT_TOO_LARGE",
        ScopedAgentSessionError::ProjectNotFound(_) => "PROJECT_NOT_FOUND",
        ScopedAgentSessionError::NotReady(_) => "NOT_READY",
        ScopedAgentSessionError::Storage(ScopedAgentSessionStoreError::NotFound { .. }) => {
            "NOT_FOUND"
        }
        ScopedAgentSessionError::Storage(_) | ScopedAgentSessionError::Runtime(_) => "INTERNAL",
    };
    format!("{code}: {error}")
}
