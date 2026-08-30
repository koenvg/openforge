use super::{build_plugin_host, stdio_test_support::StdioTestHarness};
use serde_json::json;

const BACKEND_SIDECAR: &str = r#"const readline = require('node:readline');
const { pathToFileURL } = require('node:url');
const backends = new Map();
async function loadBackend(path) {
  if (backends.has(path)) return backends.get(path);
  const mod = await import(pathToFileURL(path).href);
  backends.set(path, mod);
  return mod;
}
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', async (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const mod = await loadBackend(request.params.backendPath);
  const result = await mod[request.params.command](request.params.payload);
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
rl.on('close', () => process.exit(0));"#;

const DIAGNOSTICS_SIDECAR: &str = r#"const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  if (!line.trim()) return;
  const request = JSON.parse(line);
  const result = {
    memoryUsage: { rssBytes: 100, heapTotalBytes: 80, heapUsedBytes: 60, externalBytes: 20, arrayBuffersBytes: 10 },
    plugins: [{ pluginId: 'com.example.memory', state: 'ready', active: true, activationCount: 2, reloadCount: 1 }],
    pluginCount: 1,
    pluginsTruncated: false
  };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
});
rl.on('close', () => process.exit(0));"#;

const ECHO_BACKEND: &str =
    "export async function ping(payload) { return { echoed: payload.message }; }";

#[tokio::test]
async fn invoke_backend_round_trips_through_real_sidecar_stdio() {
    let harness = StdioTestHarness::new(BACKEND_SIDECAR).await;
    let backend_path = harness.write_file("backend.mjs", ECHO_BACKEND);

    let host = build_plugin_host();
    host.start_sidecar().await.expect("sidecar should start");
    let result = host
        .invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "hello" }),
        )
        .await
        .expect("invoke should succeed");
    host.stop_sidecar().await.expect("sidecar should stop");

    assert_eq!(result["echoed"], "hello");
}

#[tokio::test]
async fn concurrent_first_invoke_calls_wait_for_transport_readiness() {
    let harness = StdioTestHarness::new(BACKEND_SIDECAR).await;
    let backend_path = harness.write_file("backend.mjs", ECHO_BACKEND);

    let host = build_plugin_host();
    let (first, second) = tokio::join!(
        host.invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "hello" }),
        ),
        host.invoke_backend(
            "com.example.echo",
            "ping",
            &backend_path,
            json!({ "message": "world" }),
        )
    );
    host.stop_sidecar().await.expect("sidecar should stop");

    assert_eq!(
        first.expect("first invoke should succeed")["echoed"],
        "hello"
    );
    assert_eq!(
        second.expect("second invoke should succeed")["echoed"],
        "world"
    );
}

#[tokio::test]
async fn process_diagnostics_round_trip_uses_bounded_content_free_contract() {
    let _harness = StdioTestHarness::new(DIAGNOSTICS_SIDECAR).await;
    let host = build_plugin_host();

    host.start_sidecar().await.expect("sidecar should start");
    let diagnostics = host
        .process_diagnostics()
        .await
        .expect("process diagnostics should round trip")
        .expect("running sidecar should return diagnostics");
    host.stop_sidecar().await.expect("sidecar should stop");

    assert_eq!(diagnostics.memory_usage.heap_used_bytes, 60);
    assert_eq!(diagnostics.memory_usage.array_buffers_bytes, 10);
    assert_eq!(diagnostics.plugins.len(), 1);
    assert_eq!(diagnostics.plugins[0].plugin_id, "com.example.memory");
    assert!(diagnostics.plugins[0].active);
    assert_eq!(diagnostics.plugins[0].activation_count, 2);
    assert_eq!(diagnostics.plugins[0].reload_count, 1);
    assert!(!diagnostics.plugins_truncated);
}
