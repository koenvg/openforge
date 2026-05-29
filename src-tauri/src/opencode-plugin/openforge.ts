const interestingEvents = new Set([
  "session.created",
  "session.status",
  "session.idle",
  "session.error",
  "session.updated",
  "message.updated",
  "tool.execute.before",
  "tool.execute.after",
])

const endedSessionIds = new Set()

function isOpenCodeSessionId(value) {
  return typeof value === "string" && value.startsWith("ses")
}

function sessionIdFromEvent(event) {
  const candidates = [
    event?.properties?.session?.id,
    event?.properties?.sessionID,
    event?.properties?.sessionId,
    event?.properties?.info?.id,
  ]

  return candidates.find(isOpenCodeSessionId) ?? null
}

function statusTypeFromEvent(event) {
  const candidates = [
    event?.properties?.status?.type,
    event?.properties?.status,
    event?.properties?.session?.status?.type,
    event?.properties?.session?.status,
  ]

  return candidates.find((value) => typeof value === "string") ?? null
}

function openForgeLifecycleKind(event) {
  switch (event?.type) {
    case "session.created":
      return "started"
    case "session.idle":
      return "ended"
    case "session.error":
      return "failed"
    case "session.status":
    case "session.updated":
    case "message.updated":
    case "tool.execute.before":
    case "tool.execute.after":
      return "became_busy"
    default:
      return null
  }
}

function shouldSuppressPostIdleActivity(kind, providerSessionId) {
  if (kind !== "became_busy" && kind !== "became_idle") return false
  if (providerSessionId) return endedSessionIds.has(providerSessionId)
  return endedSessionIds.size > 0
}

async function postOpenForgeEvent(event) {
  const taskId = process.env.OPENFORGE_TASK_ID
  const ptyInstanceId = Number(process.env.OPENFORGE_PTY_INSTANCE_ID ?? "0")
  const port = process.env.OPENFORGE_HTTP_PORT
  if (!taskId || !ptyInstanceId || !port || !event?.type) return
  if (!interestingEvents.has(event.type)) return
  const kind = openForgeLifecycleKind(event)
  if (!kind) return
  const providerSessionId = sessionIdFromEvent(event)
  if (shouldSuppressPostIdleActivity(kind, providerSessionId)) return
  if (kind === "ended" && providerSessionId) endedSessionIds.add(providerSessionId)

  try {
    await fetch(`http://127.0.0.1:${port}/hooks/agent-lifecycle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: "opencode",
        task_id: taskId,
        pty_instance_id: ptyInstanceId,
        provider_session_id: providerSessionId,
        kind,
        raw_event_type: event.type,
        raw_status_type: statusTypeFromEvent(event),
      }),
    })
  } catch {
    // Keep OpenCode responsive if OpenForge is not listening.
  }
}

export const OpenForgePlugin = async () => {
  return {
    event: async ({ event }) => {
      await postOpenForgeEvent(event)
    },
  }
}
