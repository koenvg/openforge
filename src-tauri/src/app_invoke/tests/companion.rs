use super::*;

#[tokio::test]
async fn companion_gateway_commands_persist_opt_in_and_report_lifecycle_state() {
    let (mut state, path) = test_state("app_invoke_companion_gateway_lifecycle");
    state.companion_gateway = Some(crate::companion_gateway::test_manager());

    let initial = invoke_ok(
        &state,
        "get_companion_gateway_status",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(initial["enabled"], false);
    assert_eq!(initial["phase"], "disabled");

    let running = invoke_ok(
        &state,
        "set_companion_gateway_enabled",
        json!({ "enabled": true }),
    )
    .await;
    assert_eq!(running["enabled"], true);
    assert_eq!(running["phase"], "running");
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_config(crate::companion_gateway::COMPANION_GATEWAY_ENABLED_CONFIG)
            .expect("read persisted preference")
            .as_deref(),
        Some("true")
    );
    assert!(
        invoke_ok(
            &state,
            "get_config",
            json!({ "key": "companion_host_identity" }),
        )
        .await
        .is_null(),
        "the generic config bridge must never expose Companion private material"
    );

    let disabled = invoke_ok(
        &state,
        "set_companion_gateway_enabled",
        json!({ "enabled": false }),
    )
    .await;
    assert_eq!(disabled["enabled"], false);
    assert_eq!(disabled["phase"], "disabled");
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_config(crate::companion_gateway::COMPANION_GATEWAY_ENABLED_CONFIG)
            .expect("read persisted preference")
            .as_deref(),
        Some("false")
    );

    let _ = std::fs::remove_file(path);
}
