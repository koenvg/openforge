use super::*;

pub(super) async fn handle(
    state: &AppState,
    request: &AppInvokeRequest,
) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "get_process_memory_history" => json_value(state.process_memory_history.snapshot()),
        "set_process_memory_history_enabled" => {
            let enabled = payload_bool(&request.payload, "enabled")?;
            let snapshot = state
                .process_memory_history
                .set_enabled(enabled, state.process_memory_sampling_context())
                .await
                .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))?;
            json_value(snapshot)
        }
        _ => unreachable!("process memory history handler only receives its own commands"),
    }
}
