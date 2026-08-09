use super::*;

pub(super) fn handle(state: &AppState, request: &AppInvokeRequest) -> AppResult<serde_json::Value> {
    match request.command.as_str() {
        "list_browser_session_purge_intents" => {
            let intents: Vec<db::BrowserSessionPurgeIntentRow> = {
                let db = crate::db::acquire_db(&state.db);
                db.list_browser_session_purge_intents().map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to list Task Browser Session purge intents: {error}"),
                    )
                })?
            };
            json_value(intents)
        }
        "acknowledge_browser_session_purge_intent" => {
            let intent_id = payload_i64(&request.payload, "intentId")?;
            let db = crate::db::acquire_db(&state.db);
            db.acknowledge_browser_session_purge_intent(intent_id)
                .map_err(|error| {
                    (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        format!("Failed to acknowledge Task Browser Session purge intent: {error}"),
                    )
                })?;
            Ok(serde_json::Value::Null)
        }
        _ => unreachable!("browser session handler only receives browser session commands"),
    }
}
