async function reportOpenForgeShellHook(provider, kind, rawEventType, input) {
  const taskId = process.env.OPENFORGE_TASK_ID;
  if (!taskId) return;
  const payload = {
    provider, kind, task_id: taskId,
    pty_instance_id: Number(process.env.OPENFORGE_PTY_INSTANCE_ID),
    raw_event_type: rawEventType,
    provider_session_id: input?.session_id || process.env[provider === "grok" ? "GROK_SESSION_ID" : "CLAUDE_SESSION_ID"] || null,
  };
  if (typeof input?.transcript_path === "string") payload.transcript_path = input.transcript_path;
  if (provider === "claude-code" && input?.background_tasks != null) payload.background_tasks = input.background_tasks;
  await sendOpenForgeNotification(payload, "unused");
}

async function openForgeShellHookMain() {
  try {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 65536) throw new Error("hook input too large");
      chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString("utf8").trim();
    const input = text ? JSON.parse(text) : {};
    await reportOpenForgeShellHook(process.argv[1], process.argv[2], process.argv[3], input);
  } catch {
    console.error("[openforge] notification acceptance failed");
  }
  // A lifecycle notification is not a permission decision. Never print allow/deny JSON.
}
openForgeShellHookMain();
