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

    let configured = invoke_ok(
        &state,
        "set_companion_tailscale_hostname",
        json!({ "hostname": "Forge-Mac.Example.TS.NET." }),
    )
    .await;
    assert_eq!(
        configured["tailscale"]["configuredHostname"],
        "forge-mac.example.ts.net"
    );
    assert_eq!(
        configured["tailscale"]["effectiveHostname"],
        "forge-mac.example.ts.net"
    );
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_config(crate::companion_gateway::COMPANION_TAILSCALE_HOSTNAME_CONFIG)
            .expect("read persisted Tailscale hostname")
            .as_deref(),
        Some("forge-mac.example.ts.net")
    );

    let pairing = invoke_ok(&state, "start_companion_pairing", serde_json::Value::Null).await;
    let qr: serde_json::Value =
        serde_json::from_str(pairing["qrPayload"].as_str().expect("pairing QR payload"))
            .expect("pairing QR JSON");
    assert_eq!(
        qr["protocolVersion"],
        crate::companion_gateway::PROTOCOL_VERSION
    );
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
    let reset = invoke_ok(
        &state,
        "reset_companion_host_identity",
        serde_json::Value::Null,
    )
    .await;
    assert_eq!(reset["enabled"], true);
    assert_eq!(reset["phase"], "running");
    assert_ne!(reset["hostId"], running["hostId"]);
    assert_ne!(
        reset["certificateFingerprint"],
        running["certificateFingerprint"]
    );
    assert_eq!(
        crate::db::acquire_db(&state.db)
            .get_config(crate::companion_gateway::COMPANION_GATEWAY_ENABLED_CONFIG)
            .expect("read persisted preference after reset")
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

#[tokio::test]
async fn companion_tailscale_hostname_rejects_non_magicdns_endpoints() {
    let (mut state, path) = test_state("app_invoke_companion_tailscale_validation");
    state.companion_gateway = Some(crate::companion_gateway::test_manager());

    let error = invoke(
        &state,
        "set_companion_tailscale_hostname",
        json!({ "hostname": "https://public.example.com:17424" }),
    )
    .await
    .expect_err("non-MagicDNS endpoint must be rejected");

    assert_eq!(error.0, StatusCode::BAD_REQUEST);
    assert!(error.1.contains("MagicDNS"));
    assert!(
        crate::db::acquire_db(&state.db)
            .get_config(crate::companion_gateway::COMPANION_TAILSCALE_HOSTNAME_CONFIG)
            .expect("read Tailscale hostname preference")
            .is_none(),
        "invalid hostnames must not be persisted"
    );

    let _ = std::fs::remove_file(path);
}
