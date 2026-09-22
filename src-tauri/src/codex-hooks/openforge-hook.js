const SUPPORTED_OPENFORGE_LIFECYCLE_KINDS = new Set([
  "started",
  "became_busy",
  "requested_permission",
  "ended",
]);

const TURN_MONITOR_ARG = "--monitor-turn";
const TURN_MONITOR_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const TURN_MONITOR_POLL_INTERVAL_MS = 500;
const TURN_STATE_VERSION = 2;
const TURN_STATE_LOCK_TIMEOUT_MS = 2000;
const TURN_STATE_LOCK_POLL_INTERVAL_MS = 10;
const TURN_STATE_LOCK_STALE_MS = 30_000;
const TURN_DELIVERY_LOCK_TIMEOUT_MS = 100;
const MAX_PENDING_NOTIFICATIONS = 64;

function utf8Tail(value, maxBytes) {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  const codePoints = Array.from(value);
  let low = 0;
  let high = codePoints.length;
  let result = "";
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidate = codePoints.slice(codePoints.length - length).join("");
    if (Buffer.byteLength(candidate, "utf8") <= maxBytes) {
      result = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }
  return result;
}

function fitActivitySnapshotToEnvelope(payload, notificationId) {
  const activitySnapshot = payload.activity_snapshot;
  if (typeof activitySnapshot !== "string") {
    return openForgeNotificationPayloadFits(payload, notificationId) ? payload : null;
  }

  const codePoints = Array.from(activitySnapshot);
  let low = 0;
  let high = codePoints.length;
  let result = null;
  while (low <= high) {
    const length = Math.floor((low + high) / 2);
    const candidate = { ...payload };
    if (length === 0) delete candidate.activity_snapshot;
    else candidate.activity_snapshot = codePoints.slice(codePoints.length - length).join("");
    if (openForgeNotificationPayloadFits(candidate, notificationId)) {
      result = candidate;
      low = length + 1;
    } else {
      high = length - 1;
    }
  }
  return result;
}

function fitLifecyclePayload(payload, notificationId = OPENFORGE_NOTIFICATION_ID_PLACEHOLDER) {
  const fitted = { ...payload };
  if (
    typeof fitted.transcript_path === "string"
      && Buffer.byteLength(fitted.transcript_path, "utf8") > OPENFORGE_NOTIFICATION_LIMITS.transcriptPathBytes
  ) delete fitted.transcript_path;
  if (typeof fitted.activity_snapshot === "string") {
    fitted.activity_snapshot = utf8Tail(
      fitted.activity_snapshot,
      OPENFORGE_NOTIFICATION_LIMITS.activitySnapshotBytes,
    );
  }
  if (openForgeNotificationPayloadFits(fitted, notificationId)) return fitted;
  const withTranscript = fitActivitySnapshotToEnvelope(fitted, notificationId);
  if (withTranscript) return withTranscript;
  delete fitted.transcript_path;
  return fitActivitySnapshotToEnvelope(fitted, notificationId) ?? fitted;
}

function boundedJsonSnapshot(value) {
  if (!value || typeof value !== "object") return null;
  const snapshot = { ...value };
  delete snapshot.transcript_path;
  const json = JSON.stringify(snapshot);
  if (!json || json === "{}") return null;
  return utf8Tail(json, OPENFORGE_NOTIFICATION_LIMITS.activitySnapshotBytes);
}

function lifecyclePayload(kind, rawEventType, rawStatusType = null, hookInput = null) {
  const taskId = process.env.OPENFORGE_TASK_ID || process.env.OPENFORGE_SCOPED_SESSION_ID;
  const ptyInstanceId = Number(process.env.OPENFORGE_PTY_INSTANCE_ID);
  const port = process.env.OPENFORGE_HTTP_PORT;

  if (
    !taskId ||
    !Number.isFinite(ptyInstanceId) ||
    (!port && !process.env.OPENFORGE_AGENT_CONFIG) ||
    !SUPPORTED_OPENFORGE_LIFECYCLE_KINDS.has(kind) ||
    !rawEventType
  ) {
    return null;
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

  if (hookInput && typeof hookInput.transcript_path === "string" && hookInput.transcript_path) {
    payload.transcript_path = hookInput.transcript_path;
  }

  const activitySnapshot = boundedJsonSnapshot(hookInput);
  if (activitySnapshot) {
    payload.activity_snapshot = activitySnapshot;
  }

  return fitLifecyclePayload(payload);
}

async function postLifecycleEvent(kind, rawEventType, rawStatusType = null, hookInput = null) {
  const payload = lifecyclePayload(kind, rawEventType, rawStatusType, hookInput);
  if (!payload) return;
  const port = process.env.OPENFORGE_HTTP_PORT;
  await sendOpenForgeNotification(payload, `http://127.0.0.1:${port}/hooks/agent-lifecycle`);
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
  const taskId = activeTurnStateKeyPart(process.env.OPENFORGE_TASK_ID || process.env.OPENFORGE_SCOPED_SESSION_ID);
  const ptyInstanceId = activeTurnStateKeyPart(process.env.OPENFORGE_PTY_INSTANCE_ID);
  return path.join(os.tmpdir(), `openforge-codex-turn-${taskId}-${ptyInstanceId}.json`);
}

async function codexTurnStateLockPath() {
  return `${await activeTurnStatePath()}.lock`;
}

async function codexTurnDeliveryLockPath() {
  return `${await activeTurnStatePath()}.delivery.lock`;
}

function waitForCodexTurnStateLock(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function codexLockOwnerIsAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

async function recoverStaleCodexTurnStateLock(lockPath, staleMs) {
  const fs = await import("node:fs/promises");
  let stat;
  try {
    stat = await fs.stat(lockPath);
  } catch (error) {
    return error?.code === "ENOENT";
  }
  if (Date.now() - stat.mtimeMs <= staleMs) return false;

  let owner = null;
  try {
    owner = JSON.parse(await fs.readFile(`${lockPath}/owner.json`, "utf8"));
  } catch (_error) {
    // A stale lock without readable owner metadata is safe to replace.
  }
  if (codexLockOwnerIsAlive(owner)) return false;

  try {
    await fs.rm(lockPath, { recursive: true, force: true });
    return true;
  } catch (_error) {
    return false;
  }
}

async function withCodexDirectoryLock(lockPath, callback, options = {}) {
  const fs = await import("node:fs/promises");
  const timeoutMs = options.timeoutMs ?? TURN_STATE_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? TURN_STATE_LOCK_POLL_INTERVAL_MS;
  const staleMs = options.staleMs ?? TURN_STATE_LOCK_STALE_MS;
  const deadline = Date.now() + timeoutMs;

  for (;;) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        await fs.writeFile(
          `${lockPath}/owner.json`,
          JSON.stringify({ pid: process.pid, createdAt: Date.now() }),
          { encoding: "utf8", mode: 0o600 },
        );
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }
      break;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (await recoverStaleCodexTurnStateLock(lockPath, staleMs)) continue;
      if (Date.now() >= deadline) throw new Error("Codex turn state lock timed out");
      await waitForCodexTurnStateLock(pollIntervalMs);
    }
  }

  try {
    return await callback();
  } finally {
    await fs.rm(lockPath, { recursive: true, force: true });
  }
}

async function withCodexTurnStateLock(callback, options = {}) {
  return withCodexDirectoryLock(await codexTurnStateLockPath(), callback, options);
}

async function withCodexTurnDeliveryLock(callback) {
  return withCodexDirectoryLock(await codexTurnDeliveryLockPath(), callback, {
    timeoutMs: TURN_DELIVERY_LOCK_TIMEOUT_MS,
  });
}

function isLifecyclePayload(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.provider === "codex"
      && typeof value.task_id === "string"
      && Number.isFinite(value.pty_instance_id)
      && SUPPORTED_OPENFORGE_LIFECYCLE_KINDS.has(value.kind)
      && typeof value.raw_event_type === "string"
      && value.raw_event_type,
  );
}

function isPendingNotification(value) {
  return Boolean(
    value
      && typeof value === "object"
      && typeof value.id === "string"
      && /^[a-f0-9-]{36}$/.test(value.id)
      && isLifecyclePayload(value.payload),
  );
}

function isCodexTurnState(value) {
  return Boolean(
    value
      && typeof value === "object"
      && value.version === TURN_STATE_VERSION
      && typeof value.turnId === "string"
      && value.turnId
      && (value.parentStatus === "active" || value.parentStatus === "ended")
      && Array.isArray(value.activeAgentIds)
      && value.activeAgentIds.every((agentId) => typeof agentId === "string" && agentId)
      && Array.isArray(value.pendingNotifications)
      && value.pendingNotifications.length <= MAX_PENDING_NOTIFICATIONS
      && value.pendingNotifications.every(isPendingNotification),
  );
}

async function readCodexTurnState() {
  const fs = await import("node:fs/promises");
  try {
    const state = JSON.parse(await fs.readFile(await activeTurnStatePath(), "utf8"));
    return isCodexTurnState(state) ? state : null;
  } catch (_error) {
    return null;
  }
}

async function writeCodexTurnState(state) {
  const fs = await import("node:fs/promises");
  const crypto = await import("node:crypto");
  const statePath = await activeTurnStatePath();
  const temporaryPath = `${statePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporaryPath, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
    await fs.rename(temporaryPath, statePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

function codexHookIdentity(hookInput) {
  if (!hookInput || typeof hookInput !== "object") return null;
  return typeof hookInput.turn_id === "string" && hookInput.turn_id
    ? hookInput.turn_id
    : null;
}

async function enqueueLifecycleNotification(state, kind, rawEventType, rawStatusType, hookInput) {
  const payload = lifecyclePayload(kind, rawEventType, rawStatusType, hookInput);
  if (!payload) return state;

  if (
    state.pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS
      && kind !== "ended"
  ) return state;

  const crypto = await import("node:crypto");
  const pendingNotifications = [...state.pendingNotifications];
  if (pendingNotifications.length >= MAX_PENDING_NOTIFICATIONS) {
    const expendableIndex = pendingNotifications.findIndex(
      notification => notification.payload.kind !== "ended",
    );
    if (expendableIndex < 0) return state;
    pendingNotifications.splice(expendableIndex, 1);
  }
  pendingNotifications.push({ id: crypto.randomUUID(), payload });
  return { ...state, pendingNotifications };
}

function repairPendingLifecycleNotification(pending) {
  if (openForgeNotificationPayloadFits(pending.payload, pending.id)) return null;
  const payload = fitLifecyclePayload(pending.payload, pending.id);
  return openForgeNotificationPayloadFits(payload, pending.id)
    ? { ...pending, payload }
    : null;
}

async function drainLifecycleNotifications() {
  try {
    await withCodexTurnDeliveryLock(async () => {
      for (;;) {
        const pending = await withCodexTurnStateLock(async () => {
          const state = await readCodexTurnState();
          const first = state?.pendingNotifications[0] ?? null;
          if (!state || !first) return null;
          const repaired = repairPendingLifecycleNotification(first);
          if (!repaired) return first;
          await writeCodexTurnState({
            ...state,
            pendingNotifications: [repaired, ...state.pendingNotifications.slice(1)],
          });
          return repaired;
        });
        if (!pending) return;

        const port = process.env.OPENFORGE_HTTP_PORT;
        await sendOpenForgeNotification(
          pending.payload,
          `http://127.0.0.1:${port}/hooks/agent-lifecycle`,
          undefined,
          pending.id,
        );

        await withCodexTurnStateLock(async () => {
          const state = await readCodexTurnState();
          if (!state || state.pendingNotifications[0]?.id !== pending.id) return;
          await writeCodexTurnState({
            ...state,
            pendingNotifications: state.pendingNotifications.slice(1),
          });
        });
      }
    });
    return true;
  } catch (error) {
    // Another hook process owns delivery and will drain notifications appended behind its item.
    if (error?.message === "Codex turn state lock timed out") return true;
    return false;
  }
}

async function processCodexLifecycleEventUnlocked(kind, rawEventType, rawStatusType, hookInput) {
  const turnId = codexHookIdentity(hookInput);

  if (rawEventType === "SessionStart") {
    const state = await readCodexTurnState();
    if (state?.parentStatus === "ended") return null;
    if (!state) return lifecyclePayload(kind, rawEventType, rawStatusType, hookInput);
    await writeCodexTurnState(
      await enqueueLifecycleNotification(state, kind, rawEventType, rawStatusType, hookInput),
    );
    return null;
  }

  if (rawEventType === "UserPromptSubmit") {
    if (!turnId) return null;
    const previous = await readCodexTurnState();
    const nextState = {
      version: TURN_STATE_VERSION,
      turnId,
      parentStatus: "active",
      activeAgentIds: previous?.turnId === turnId ? previous.activeAgentIds : [],
      pendingNotifications: previous?.pendingNotifications ?? [],
    };
    await writeCodexTurnState(
      await enqueueLifecycleNotification(nextState, kind, rawEventType, rawStatusType, hookInput),
    );
    return null;
  }

  if (rawEventType === "SubagentStart" || rawEventType === "TranscriptSubagentEnd") {
    const agentId = typeof hookInput?.agent_id === "string" && hookInput.agent_id
      ? hookInput.agent_id
      : null;
    if (!turnId || !agentId) return null;

    const state = await readCodexTurnState();
    if (!state || state.turnId !== turnId) return null;

    const activeAgentIds = new Set(state.activeAgentIds);
    if (rawEventType === "SubagentStart") {
      if (
        (state.parentStatus !== "active" && activeAgentIds.size === 0)
          || activeAgentIds.has(agentId)
      ) return null;
      activeAgentIds.add(agentId);
      const nextState = await enqueueLifecycleNotification(
        { ...state, activeAgentIds: [...activeAgentIds] },
        "became_busy",
        rawEventType,
        rawStatusType,
        hookInput,
      );
      await writeCodexTurnState(nextState);
      return null;
    }

    if (!activeAgentIds.delete(agentId)) return null;
    let nextState = { ...state, activeAgentIds: [...activeAgentIds] };
    if (nextState.parentStatus === "ended" && nextState.activeAgentIds.length === 0) {
      nextState = await enqueueLifecycleNotification(
        nextState,
        "ended",
        rawEventType,
        rawStatusType,
        hookInput,
      );
    }
    await writeCodexTurnState(nextState);
    return null;
  }

  if (rawEventType === "Stop" || rawEventType === "SubagentStop") {
    // These hooks run before Codex combines blocking decisions from every matching hook.
    return null;
  }

  if (rawEventType === "TranscriptTurnEnd") {
    if (!turnId) return null;
    const state = await readCodexTurnState();
    if (!state || state.turnId !== turnId || state.parentStatus === "ended") return null;
    let nextState = { ...state, parentStatus: "ended" };
    if (nextState.activeAgentIds.length === 0) {
      nextState = await enqueueLifecycleNotification(
        nextState,
        "ended",
        rawEventType,
        rawStatusType,
        hookInput,
      );
    }
    await writeCodexTurnState(nextState);
    return null;
  }

  if (
    rawEventType === "PreToolUse"
      || rawEventType === "PostToolUse"
      || rawEventType === "PermissionRequest"
  ) {
    if (!turnId) return null;
    const state = await readCodexTurnState();
    if (!state || state.turnId !== turnId || state.parentStatus !== "active") return null;
    await writeCodexTurnState(
      await enqueueLifecycleNotification(state, kind, rawEventType, rawStatusType, hookInput),
    );
    return null;
  }

  return lifecyclePayload(kind, rawEventType, rawStatusType, hookInput);
}

async function processCodexLifecycleEvent(kind, rawEventType, rawStatusType, hookInput) {
  if (!(process.env.OPENFORGE_TASK_ID || process.env.OPENFORGE_SCOPED_SESSION_ID) || !Number.isFinite(Number(process.env.OPENFORGE_PTY_INSTANCE_ID))) {
    return true;
  }

  const directPayload = await withCodexTurnStateLock(
    () => processCodexLifecycleEventUnlocked(kind, rawEventType, rawStatusType, hookInput),
  );
  if (directPayload) {
    const port = process.env.OPENFORGE_HTTP_PORT;
    try {
      await sendOpenForgeNotification(
        directPayload,
        `http://127.0.0.1:${port}/hooks/agent-lifecycle`,
      );
    } catch (_error) {
      return false;
    }
  }
  return drainLifecycleNotifications();
}

function codexTranscriptLifecycleEvent(entry, turnId) {
  if (!entry || typeof entry !== "object" || entry.type !== "event_msg") return null;

  const payload = entry.payload;
  if (!payload || typeof payload !== "object" || payload.turn_id !== turnId) return null;

  if (payload.type === "task_complete") {
    return { type: "parent_ended", statusType: "task_complete" };
  }
  if (payload.type === "turn_aborted") {
    return {
      type: "parent_ended",
      statusType: typeof payload.reason === "string"
        ? `turn_aborted:${payload.reason}`
        : "turn_aborted",
    };
  }

  const item = payload.type === "item_completed" ? payload.item : null;
  if (
    item?.type === "SubAgentActivity"
      && item.kind === "completed"
      && typeof item.agent_thread_id === "string"
      && item.agent_thread_id
  ) {
    return { type: "child_ended", agentId: item.agent_thread_id };
  }

  return null;
}

async function findCodexTranscriptLifecycleEvents(transcriptPath, turnId, offset) {
  const fs = await import("node:fs/promises");
  let file;
  try {
    file = await fs.open(transcriptPath, "r");
  } catch (_error) {
    return { offset, events: [] };
  }

  try {
    const stat = await file.stat();
    const start = offset <= stat.size ? offset : 0;
    const length = stat.size - start;
    if (length <= 0) return { offset: start, events: [] };

    const buffer = Buffer.alloc(length);
    await file.read(buffer, 0, length, start);
    const lastNewline = buffer.lastIndexOf(0x0a);
    if (lastNewline < 0) return { offset: start, events: [] };
    const lines = buffer.subarray(0, lastNewline + 1).toString("utf8").split("\n");
    const events = [];

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = codexTranscriptLifecycleEvent(JSON.parse(line), turnId);
        if (event) events.push(event);
      } catch (_error) {
        // Ignore partial or unrelated transcript lines while the file is growing.
      }
    }

    return { offset: start + lastNewline + 1, events };
  } finally {
    await file.close();
  }
}

async function codexTurnMonitorCanExit(turnId) {
  return withCodexTurnStateLock(async () => {
    const state = await readCodexTurnState();
    return Boolean(
      state
        && (
          state.turnId !== turnId
            || (
              state.parentStatus === "ended"
                && state.activeAgentIds.length === 0
                && state.pendingNotifications.length === 0
            )
        ),
    );
  });
}

async function monitorCodexTranscriptTurn(transcriptPath, turnId, options = {}) {
  const timeoutMs = options.timeoutMs ?? TURN_MONITOR_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? TURN_MONITOR_POLL_INTERVAL_MS;
  const startedAt = Date.now();
  let offset = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const result = await findCodexTranscriptLifecycleEvents(transcriptPath, turnId, offset);
    offset = result.offset;

    for (const event of result.events) {
      if (event.type === "parent_ended") {
        await processCodexLifecycleEvent(
          "ended",
          "TranscriptTurnEnd",
          event.statusType,
          { turn_id: turnId, transcript_path: transcriptPath },
        );
      } else {
        await processCodexLifecycleEvent(
          "ended",
          "TranscriptSubagentEnd",
          "completed",
          { turn_id: turnId, agent_id: event.agentId, transcript_path: transcriptPath },
        );
      }
    }

    await drainLifecycleNotifications();
    if (await codexTurnMonitorCanExit(turnId)) return true;

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
    const accepted = await processCodexLifecycleEvent(kind, rawEventType, null, hookInput);
    await maybeStartTurnCompletionMonitor(kind, rawEventType, hookInput);
    if (!accepted) throw new Error("Codex lifecycle delivery remains pending");
  } catch (_error) {
    console.error("[openforge] Codex notification acceptance failed");
  }
}

main();
