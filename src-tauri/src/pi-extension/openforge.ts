import { open } from "node:fs/promises";
import { O_NONBLOCK, O_RDONLY } from "node:constants";
import { isAbsolute, join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_OPENFORGE_HTTP_PORT = "17422";
const MAX_ACTIVITY_SNAPSHOT_CHARS = 8_000;
const MAX_BACKGROUND_RUN_ID_CHARS = 256;
const MAX_BACKGROUND_PATH_CHARS = 4_096;
const SUBAGENT_LIFECYCLE_ARTIFACT_VERSION = 3;
const RECOVERY_READ_CONCURRENCY = 16;
const MAX_STATUS_FILE_BYTES = 64_000;
const TERMINAL_RECONCILIATION_DELAY_MS = 2_000;
const TERMINAL_BACKGROUND_STATES = new Set([
  "complete",
  "failed",
  "partial",
  "paused",
  "stopped",
  "rejected",
]);

type OpenForgePiLifecycleEventType =
  | "agent.start"
  | "agent.end"
  | "subagent.async_active"
  | "user_prompt";

interface OpenForgePiLifecycleMetadata {
  provider_session_id?: string;
  transcript_path?: string;
  activity_snapshot?: string;
}

interface PiSessionContext {
  isIdle?: () => boolean;
  sessionManager?: {
    getSessionFile?: () => string | undefined;
    getEntries?: () => unknown[];
    getSessionId?: () => string | undefined;
  };
}

interface ActiveBackgroundRun {
  id: string;
  sessionId: string;
  asyncDir: string;
}

function boundedString(value: unknown, maxChars: number) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= maxChars ? trimmed : undefined;
}

function currentBackgroundOwner(ctx: PiSessionContext) {
  return boundedString(
    ctx.sessionManager?.getSessionFile?.() ?? ctx.sessionManager?.getSessionId?.(),
    MAX_BACKGROUND_PATH_CHARS,
  );
}

function activeRunFromStartEvent(data: unknown): ActiveBackgroundRun | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const candidate = data as Record<string, unknown>;
  if (candidate.lifecycleArtifactVersion !== SUBAGENT_LIFECYCLE_ARTIFACT_VERSION) return undefined;
  const id = boundedString(candidate.id, MAX_BACKGROUND_RUN_ID_CHARS);
  const sessionId = boundedString(candidate.sessionId, MAX_BACKGROUND_PATH_CHARS);
  const asyncDir = boundedString(candidate.asyncDir, MAX_BACKGROUND_PATH_CHARS);
  return id && sessionId && asyncDir && isAbsolute(asyncDir)
    ? { id, sessionId, asyncDir }
    : undefined;
}

interface BackgroundRunCompletion {
  runId: string;
  sessionId: string;
  triggerTurn: boolean;
}

function backgroundRunCompletion(data: unknown): BackgroundRunCompletion | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const candidate = data as Record<string, unknown>;
  if (candidate.lifecycleArtifactVersion !== SUBAGENT_LIFECYCLE_ARTIFACT_VERSION) return undefined;
  const runId = boundedString(candidate.runId, MAX_BACKGROUND_RUN_ID_CHARS);
  const sessionId = boundedString(candidate.sessionId, MAX_BACKGROUND_PATH_CHARS);
  return runId && sessionId
    ? { runId, sessionId, triggerTurn: candidate.triggerTurn === true }
    : undefined;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : undefined;
}

function recoveryCandidateFromEntry(entry: unknown): Pick<ActiveBackgroundRun, "id" | "asyncDir"> | undefined {
  const entryRecord = record(entry);
  const message = record(entryRecord?.message);
  if (entryRecord?.type !== "message" || message?.role !== "toolResult" || message.toolName !== "subagent") {
    return undefined;
  }
  const details = record(message.details);
  const id = boundedString(details?.asyncId, MAX_BACKGROUND_RUN_ID_CHARS);
  const asyncDir = boundedString(details?.asyncDir, MAX_BACKGROUND_PATH_CHARS);
  return id && asyncDir && isAbsolute(asyncDir) ? { id, asyncDir } : undefined;
}

async function readBoundedStatusFile(path: string) {
  const file = await open(path, O_RDONLY | O_NONBLOCK);
  try {
    const metadata = await file.stat();
    if (!metadata.isFile() || metadata.size > MAX_STATUS_FILE_BYTES) return undefined;
    const buffer = Buffer.allocUnsafe(MAX_STATUS_FILE_BYTES + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    return bytesRead <= MAX_STATUS_FILE_BYTES ? buffer.toString("utf8", 0, bytesRead) : undefined;
  } finally {
    await file.close();
  }
}

type BackgroundRunArtifactState = "active" | "terminal" | "unknown";

async function backgroundRunArtifactState(run: ActiveBackgroundRun): Promise<BackgroundRunArtifactState> {
  try {
    const rawStatus = await readBoundedStatusFile(join(run.asyncDir, "status.json"));
    if (rawStatus === undefined) return "unknown";
    const status = record(JSON.parse(rawStatus));
    if (status?.lifecycleArtifactVersion !== SUBAGENT_LIFECYCLE_ARTIFACT_VERSION) return "unknown";
    if (status.runId !== run.id || status.sessionId !== run.sessionId) return "unknown";
    if (status.state === "queued" || status.state === "running") return "active";
    return typeof status.state === "string" && TERMINAL_BACKGROUND_STATES.has(status.state)
      ? "terminal"
      : "unknown";
  } catch {
    return "unknown";
  }
}

async function activeRunFromStatus(
  candidate: Pick<ActiveBackgroundRun, "id" | "asyncDir">,
  ownerSessionId: string,
): Promise<ActiveBackgroundRun | undefined> {
  const run = { ...candidate, sessionId: ownerSessionId };
  return (await backgroundRunArtifactState(run)) === "active" ? run : undefined;
}

async function recoverActiveBackgroundRuns(ctx: PiSessionContext) {
  const ownerSessionId = currentBackgroundOwner(ctx);
  const entries = ctx.sessionManager?.getEntries?.();
  if (!ownerSessionId || !Array.isArray(entries)) return [];

  const candidates: Array<Pick<ActiveBackgroundRun, "id" | "asyncDir">> = [];
  const seenRunIds = new Set<string>();
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = recoveryCandidateFromEntry(entries[index]);
    if (!candidate || seenRunIds.has(candidate.id)) continue;
    seenRunIds.add(candidate.id);
    candidates.push(candidate);
  }

  const recovered: ActiveBackgroundRun[] = [];
  for (let offset = 0; offset < candidates.length; offset += RECOVERY_READ_CONCURRENCY) {
    const batch = await Promise.all(
      candidates
        .slice(offset, offset + RECOVERY_READ_CONCURRENCY)
        .map((candidate) => activeRunFromStatus(candidate, ownerSessionId)),
    );
    for (const run of batch) {
      if (run) recovered.push(run);
    }
  }
  return recovered;
}

async function reconcileTrackedBackgroundRuns(activeRuns: Map<string, ActiveBackgroundRun>) {
  const runs = [...activeRuns.values()];
  const artifactStates = await Promise.all(runs.map((run) => backgroundRunArtifactState(run)));
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index];
    if (run && artifactStates[index] === "terminal" && activeRuns.get(run.id) === run) {
      activeRuns.delete(run.id);
    }
  }
}

function processTerminalRunId(data: unknown) {
  const event = record(data);
  if (event?.version !== 1) return undefined;
  if (event.state !== "observed" && event.state !== "unknown" && event.state !== "not-started") {
    return undefined;
  }
  return boundedString(event.runId, MAX_BACKGROUND_RUN_ID_CHARS);
}

function openForgeLifecycleKind(eventType: OpenForgePiLifecycleEventType) {
  return eventType === "user_prompt" || eventType === "subagent.async_active"
    ? "became_busy"
    : eventType === "agent.start"
      ? "started"
      : "ended";
}

function boundedActivitySnapshot(text: string) {
  return text.length > MAX_ACTIVITY_SNAPSHOT_CHARS
    ? `${text.slice(0, MAX_ACTIVITY_SNAPSHOT_CHARS)}\n[openforge: pi activity snapshot truncated]`
    : text;
}

function buildPiActivitySnapshot(
  event: { text?: string; source?: string; streamingBehavior?: string },
  ctx: { cwd?: string; sessionManager?: { getSessionFile?: () => string | undefined } },
) {
  const prompt = typeof event.text === "string" ? event.text.trim() : "";
  const sessionFile = ctx.sessionManager?.getSessionFile?.();
  return boundedActivitySnapshot(
    [
      "Pi Agent Session activity snapshot",
      `source: ${event.source ?? "unknown"}`,
      `streaming_behavior: ${event.streamingBehavior ?? "none"}`,
      `cwd: ${ctx.cwd ?? "unknown"}`,
      sessionFile ? `transcript_path: ${sessionFile}` : undefined,
      "",
      "User prompt:",
      prompt,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n"),
  );
}

async function reportPiLifecycle(
  eventType: OpenForgePiLifecycleEventType,
  metadata: OpenForgePiLifecycleMetadata = {},
) {
  const taskId = process.env.OPENFORGE_TASK_ID;
  const ptyInstanceId = process.env.OPENFORGE_PTY_INSTANCE_ID;
  if (!taskId || !ptyInstanceId) return;

  const port = process.env.OPENFORGE_HTTP_PORT ?? DEFAULT_OPENFORGE_HTTP_PORT;
  try {
    await fetch(`http://127.0.0.1:${port}/hooks/agent-lifecycle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "pi",
        task_id: taskId,
        pty_instance_id: Number(ptyInstanceId),
        kind: openForgeLifecycleKind(eventType),
        raw_event_type: eventType,
        ...metadata,
      }),
    });
  } catch (error) {
    console.error(`[openforge] Failed to report Pi lifecycle event ${eventType}:`, error);
  }
}

export default function openForgeExtension(pi: ExtensionAPI) {
  const activeBackgroundRuns = new Map<string, ActiveBackgroundRun>();
  let currentOwnerSessionId: string | undefined;
  let currentProviderSessionId: string | undefined;
  let currentIsIdle: (() => boolean) | undefined;

  const deferredTerminalChecks = new Map<string, ReturnType<typeof setTimeout>>();

  const cancelDeferredTerminalCheck = (runId: string) => {
    const timeout = deferredTerminalChecks.get(runId);
    if (timeout) clearTimeout(timeout);
    deferredTerminalChecks.delete(runId);
  };

  const cancelAllDeferredTerminalChecks = () => {
    for (const timeout of deferredTerminalChecks.values()) clearTimeout(timeout);
    deferredTerminalChecks.clear();
  };

  const deferTerminalReconciliation = (run: ActiveBackgroundRun) => {
    cancelDeferredTerminalCheck(run.id);
    const timeout = setTimeout(() => {
      deferredTerminalChecks.delete(run.id);
      if (currentOwnerSessionId !== run.sessionId || activeBackgroundRuns.get(run.id) !== run) return;
      activeBackgroundRuns.delete(run.id);
      if (activeBackgroundRuns.size === 0 && currentIsIdle?.()) {
        void reportPiLifecycle("agent.end", { provider_session_id: currentProviderSessionId });
      }
    }, TERMINAL_RECONCILIATION_DELAY_MS);
    deferredTerminalChecks.set(run.id, timeout);
  };

  const updateCurrentSession = (ctx: PiSessionContext) => {
    currentOwnerSessionId = currentBackgroundOwner(ctx);
    currentProviderSessionId = ctx.sessionManager?.getSessionId?.();
    currentIsIdle = ctx.isIdle;
  };

  const unsubscribeAsyncStarted = pi.events.on("subagent:async-started", (data) => {
    const run = activeRunFromStartEvent(data);
    if (!run || run.sessionId !== currentOwnerSessionId) return;
    cancelAllDeferredTerminalChecks();
    activeBackgroundRuns.set(run.id, run);
  });

  const unsubscribeAsyncComplete = pi.events.on("subagent:async-complete", (data) => {
    const completion = backgroundRunCompletion(data);
    if (!completion || completion.sessionId !== currentOwnerSessionId) return;
    cancelDeferredTerminalCheck(completion.runId);
    const run = activeBackgroundRuns.get(completion.runId);
    if (!run || run.sessionId !== completion.sessionId) return;
    activeBackgroundRuns.delete(completion.runId);
    if (!completion.triggerTurn && activeBackgroundRuns.size === 0 && currentIsIdle?.()) {
      void reportPiLifecycle("agent.end", { provider_session_id: currentProviderSessionId });
    }
  });

  const unsubscribeProcessTerminal = pi.events.on("subagent:process-terminal", async (data) => {
    const runId = processTerminalRunId(data);
    const run = runId ? activeBackgroundRuns.get(runId) : undefined;
    if (!run || (await backgroundRunArtifactState(run)) !== "terminal") return;
    if (activeBackgroundRuns.get(run.id) !== run) return;
    deferTerminalReconciliation(run);
  });

  pi.on("session_shutdown", () => {
    unsubscribeAsyncStarted();
    unsubscribeAsyncComplete();
    unsubscribeProcessTerminal();
    cancelAllDeferredTerminalChecks();
    activeBackgroundRuns.clear();
    currentOwnerSessionId = undefined;
    currentProviderSessionId = undefined;
    currentIsIdle = undefined;
  });

  pi.on("session_start", async (_event, ctx) => {
    const nextOwnerSessionId = currentBackgroundOwner(ctx);
    if (currentOwnerSessionId !== nextOwnerSessionId) {
      cancelAllDeferredTerminalChecks();
      activeBackgroundRuns.clear();
    }
    updateCurrentSession(ctx);
    const recoveredRuns = await recoverActiveBackgroundRuns(ctx);
    if (currentOwnerSessionId !== nextOwnerSessionId) return;
    for (const run of recoveredRuns) {
      activeBackgroundRuns.set(run.id, run);
    }
    if (activeBackgroundRuns.size > 0) {
      await reportPiLifecycle("subagent.async_active", {
        provider_session_id: ctx.sessionManager?.getSessionId?.(),
      });
    }
  });

  pi.on("input", async (event, ctx) => {
    updateCurrentSession(ctx);
    const transcriptPath = ctx.sessionManager?.getSessionFile?.();
    await reportPiLifecycle("user_prompt", {
      provider_session_id: ctx.sessionManager?.getSessionId?.(),
      transcript_path: transcriptPath,
      activity_snapshot: buildPiActivitySnapshot(event, ctx),
    });
  });

  pi.on("agent_start", async (_event, ctx) => {
    updateCurrentSession(ctx);
    cancelAllDeferredTerminalChecks();
    await reportPiLifecycle("agent.start", {
      provider_session_id: ctx.sessionManager?.getSessionId?.(),
    });
  });

  pi.on("agent_settled", async (_event, ctx) => {
    updateCurrentSession(ctx);
    cancelAllDeferredTerminalChecks();
    await reconcileTrackedBackgroundRuns(activeBackgroundRuns);
    await reportPiLifecycle(activeBackgroundRuns.size > 0 ? "subagent.async_active" : "agent.end", {
      provider_session_id: ctx.sessionManager?.getSessionId?.(),
    });
  });
}
