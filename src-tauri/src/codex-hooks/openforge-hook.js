const SUPPORTED_OPENFORGE_LIFECYCLE_KINDS = new Set([
  "started",
  "became_busy",
  "requested_permission",
  "ended",
]);

const TURN_MONITOR_ARG = "--monitor-turn";
const TURN_MONITOR_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TURN_MONITOR_POLL_INTERVAL_MS = 500;

async function postLifecycleEvent(kind, rawEventType, rawStatusType = null) {
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

  if (rawStatusType) {
    payload.raw_status_type = rawStatusType;
  }

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

async function readStdinJson() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) return null;

  const input = Buffer.concat(chunks).toString("utf8").trim();
  if (!input) return null;

  try {
    return JSON.parse(input);
  } catch (_error) {
    return null;
  }
}

async function maybeStartTurnCompletionMonitor(kind, rawEventType, hookInput) {
  if (kind !== "became_busy" || rawEventType !== "UserPromptSubmit") return;
  if (!hookInput || typeof hookInput !== "object") return;
  if (typeof hookInput.transcript_path !== "string" || !hookInput.transcript_path) return;
  if (typeof hookInput.turn_id !== "string" || !hookInput.turn_id) return;

  await writeActiveTurnId(hookInput.turn_id);

  const childProcess = await import("node:child_process");
  const child = childProcess.spawn(
    process.execPath,
    [process.argv[1], TURN_MONITOR_ARG, hookInput.transcript_path, hookInput.turn_id],
    {
      detached: true,
      stdio: "ignore",
      env: process.env,
    },
  );
  child.unref();
}

function activeTurnStateKeyPart(value) {
  return String(value || "missing").replace(/[^a-zA-Z0-9_.-]/g, "_");
}

async function activeTurnStatePath() {
  const os = await import("node:os");
  const path = await import("node:path");
  const taskId = activeTurnStateKeyPart(process.env.OPENFORGE_TASK_ID);
  const ptyInstanceId = activeTurnStateKeyPart(process.env.OPENFORGE_PTY_INSTANCE_ID);
  return path.join(os.tmpdir(), `openforge-codex-turn-${taskId}-${ptyInstanceId}.json`);
}

async function writeActiveTurnId(turnId) {
  const fs = await import("node:fs/promises");
  const statePath = await activeTurnStatePath();
  await fs.writeFile(statePath, JSON.stringify({ turnId }), "utf8");
}

async function readActiveTurnId() {
  const fs = await import("node:fs/promises");
  try {
    const statePath = await activeTurnStatePath();
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    return typeof state.turnId === "string" ? state.turnId : null;
  } catch (_error) {
    return null;
  }
}

async function clearActiveTurnId(turnId) {
  const fs = await import("node:fs/promises");
  const statePath = await activeTurnStatePath();
  const activeTurnId = await readActiveTurnId();
  if (activeTurnId !== turnId) return;
  try {
    await fs.unlink(statePath);
  } catch (_error) {
    // Another hook process may already have cleaned this up.
  }
}

function codexTranscriptTurnEndStatus(entry, turnId) {
  if (!entry || typeof entry !== "object" || entry.type !== "event_msg") return null;

  const payload = entry.payload;
  if (!payload || typeof payload !== "object" || payload.turn_id !== turnId) return null;

  if (payload.type === "task_complete") return "task_complete";
  if (payload.type === "turn_aborted") {
    return typeof payload.reason === "string"
      ? `turn_aborted:${payload.reason}`
      : "turn_aborted";
  }

  return null;
}

async function findCodexTranscriptTurnEnd(transcriptPath, turnId, offset) {
  const fs = await import("node:fs/promises");
  let file;
  try {
    file = await fs.open(transcriptPath, "r");
  } catch (_error) {
    return { offset, statusType: null };
  }

  try {
    const stat = await file.stat();
    const start = Math.min(offset, stat.size);
    const length = stat.size - start;
    if (length <= 0) return { offset: stat.size, statusType: null };

    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, start);
    const lines = buffer.toString("utf8").split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const statusType = codexTranscriptTurnEndStatus(JSON.parse(line), turnId);
        if (statusType) return { offset: stat.size, statusType };
      } catch (_error) {
        // Ignore partial or unrelated transcript lines while the file is growing.
      }
    }

    return { offset: stat.size, statusType: null };
  } finally {
    await file.close();
  }
}

async function monitorCodexTranscriptTurn(transcriptPath, turnId, options = {}) {
  const timeoutMs = options.timeoutMs ?? TURN_MONITOR_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? TURN_MONITOR_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let offset = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await findCodexTranscriptTurnEnd(transcriptPath, turnId, offset);
    offset = result.offset;

    if (result.statusType) {
      const activeTurnId = await readActiveTurnId();
      if (activeTurnId === turnId) {
        await postLifecycleEvent("ended", "TranscriptTurnEnd", result.statusType);
        await clearActiveTurnId(turnId);
      }
      return true;
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}

async function main() {
  const [, , firstArg, secondArg, thirdArg] = process.argv;
  try {
    if (firstArg === TURN_MONITOR_ARG) {
      await monitorCodexTranscriptTurn(secondArg, thirdArg);
      return;
    }

    const kind = firstArg;
    const rawEventType = secondArg;
    const hookInput = await readStdinJson();
    await postLifecycleEvent(kind, rawEventType);
    await maybeStartTurnCompletionMonitor(kind, rawEventType, hookInput);
  } catch (_error) {
    // Lifecycle reporting must never block the provider command.
  }
}

main();
