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

    let pairing = invoke_ok(&state, "start_companion_pairing", serde_json::Value::Null).await;
    let qr: serde_json::Value =
        serde_json::from_str(pairing["qrPayload"].as_str().expect("pairing QR payload"))
            .expect("pairing QR JSON");
    assert_eq!(qr["protocolVersion"], 1);
    assert_eq!(qr["hostId"], running["hostId"]);
    assert_eq!(
        qr.as_object()
            .expect("pairing QR object")
            .keys()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>(),
        std::collections::BTreeSet::from([
            "certificateSha256",
            "endpointCandidates",
            "hostId",
            "oneTimeSecret",
            "protocolVersion",
        ]),
    );
    assert_eq!(
        invoke_ok(
            &state,
            "get_companion_pairing_status",
            serde_json::Value::Null,
        )
        .await["sessionId"],
        pairing["sessionId"],
    );
    invoke_ok(
        &state,
        "cancel_companion_pairing",
        json!({ "sessionId": pairing["sessionId"] }),
    )
    .await;
    assert!(invoke_ok(
        &state,
        "get_companion_pairing_status",
        serde_json::Value::Null,
    )
    .await
    .is_null(),);
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
