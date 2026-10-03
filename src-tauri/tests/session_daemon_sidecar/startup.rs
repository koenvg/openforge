use super::*;
#[path = "../support/startup_gate.rs"]
mod startup_gate;
use startup_gate::StartupGate;

#[test]
#[ignore = "requires built Sidecar and replacement-fixtures startup daemon"]
fn private_sidecar_is_ready_while_bootstrap_image_preflight_waits() {
    let mut fixture = Fixture::new();
    fixture.use_installation_daemon();
    let daemon = required_daemon_artifact("OPENFORGE_TEST_STARTUP_DAEMON");
    fixture.provider_env.push((
        "OPENFORGE_SESSION_DAEMON_PATH".into(),
        daemon.to_string_lossy().into(),
    ));
    let gate = StartupGate::new(&fixture.daemon_root());
    fixture.start("first");
    gate.wait_until_entered();
    let inventory = fixture.invoke("get_restart_terminal_inventory", json!({}));
    let controller = serde_json::from_value(inventory["controller"].clone()).unwrap();
    let maintenance =
        openforge_session_client::MaintenanceClient::attach(&fixture.daemon_root(), controller)
            .unwrap();
    assert!(!maintenance.capabilities().unwrap().supports_replacement);
    assert!(matches!(
        maintenance.prepare(
            openforge_session_host::OperationId::parse("pending-bootstrap").unwrap(),
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).as_path(),
        ),
        Err(openforge_session_protocol::Error::UnsupportedReplacement)
    ));
    let client = openforge_session_client::Client::connect(&fixture.daemon_root()).unwrap();
    assert!(client.inventory().unwrap().sessions.is_empty());
    client.shutdown_empty().unwrap();
    gate.wait_until_disconnected();
    gate.finish(true);
}
