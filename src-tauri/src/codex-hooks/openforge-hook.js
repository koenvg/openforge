const SUPPORTED_OPENFORGE_LIFECYCLE_KINDS = new Set([
  "started",
  "became_busy",
  "requested_permission",
  "ended",
]);

async function postLifecycleEvent(kind, rawEventType) {
  const taskId = process.env.OPENFORGE_TASK_ID;
  const ptyInstanceId = Number(process.env.OPENFORGE_PTY_INSTANCE_ID);
  const port = process.env.OPENFORGE_HTTP_PORT;

  if (
    !taskId ||
    !Number.isFinite(ptyInstanceId) ||
    !port ||
    !SUPPORTED_OPENFORGE_LIFECYCLE_KINDS.has(kind) ||
    !rawEventType
  ) {
    return;
  }

  const payload = {
    provider: "codex",
    task_id: taskId,
    pty_instance_id: ptyInstanceId,
    kind,
    raw_event_type: rawEventType,
  };

  await postJson(`http://127.0.0.1:${port}/hooks/agent-lifecycle`, payload);
}

async function postJson(url, payload) {
  const body = JSON.stringify(payload);
  if (typeof fetch === "function") {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    return;
  }

  const http = await import("node:http");
  await new Promise((resolve) => {
    const endpoint = new URL(url);
    const request = http.request(
      {
        hostname: endpoint.hostname,
        port: endpoint.port,
        path: endpoint.pathname,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        response.resume();
        response.on("end", resolve);
      },
    );
    request.on("error", resolve);
    request.write(body);
    request.end();
  });
}

async function main() {
  const [, , kind, rawEventType] = process.argv;
  try {
    await postLifecycleEvent(kind, rawEventType);
  } catch (_error) {
    // Lifecycle reporting must never block the provider command.
  }
}

main();
