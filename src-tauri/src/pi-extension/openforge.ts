import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const DEFAULT_OPENFORGE_HTTP_PORT = "17422";
const MAX_ACTIVITY_SNAPSHOT_CHARS = 8_000;

type OpenForgePiLifecycleEventType = "agent.start" | "agent.end" | "user_prompt";

interface OpenForgePiLifecycleMetadata {
  transcript_path?: string;
  activity_snapshot?: string;
}

function openForgeLifecycleKind(eventType: OpenForgePiLifecycleEventType) {
  return eventType === "user_prompt" ? "became_busy" : eventType === "agent.start" ? "started" : "ended";
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
  pi.on("input", async (event, ctx) => {
    const transcriptPath = ctx.sessionManager?.getSessionFile?.();
    await reportPiLifecycle("user_prompt", {
      transcript_path: transcriptPath,
      activity_snapshot: buildPiActivitySnapshot(event, ctx),
    });
  });

  pi.on("agent_start", async () => {
    await reportPiLifecycle("agent.start");
  });

  pi.on("agent_end", async () => {
    await reportPiLifecycle("agent.end");
  });
}
