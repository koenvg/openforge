function openForgeSessionIdEnvName(provider) {
  return provider === "grok" ? "GROK_SESSION_ID" : "CLAUDE_SESSION_ID";
}

function openForgeLegacyHookUrl(base, provider, taskId) {
  if (!base) return undefined;
  const query = new URLSearchParams({
    task_id: taskId,
    pty_instance_id: process.env.OPENFORGE_PTY_INSTANCE_ID ?? "",
    // The legacy route persists this as the resume identity, so it stays on
    // the provider's own environment variable. Hook stdin can carry a
    // narrower sub-session id, which would break resume.
    session_id: process.env[openForgeSessionIdEnvName(provider)] ?? "",
  });
  return `${base}?${query}`;
}

async function reportOpenForgeShellHook(provider, kind, rawEventType, input, legacyBase) {
  const taskId = process.env.OPENFORGE_TASK_ID;
  if (!taskId) return;
  const claudeCode = provider === "claude-code";
  const payload = {
    provider, kind, task_id: taskId,
    pty_instance_id: Number(process.env.OPENFORGE_PTY_INSTANCE_ID),
    raw_event_type: rawEventType,
    provider_session_id: input?.session_id || process.env[openForgeSessionIdEnvName(provider)] || null,
  };
  if (typeof input?.transcript_path === "string") payload.transcript_path = input.transcript_path;
  if (claudeCode && input?.background_tasks != null) payload.background_tasks = input.background_tasks;
  // Claude's legacy route reads tool_name and tool_input from the provider's own hook body.
  const legacyBody = claudeCode ? JSON.stringify(input ?? {}) : undefined;
  await sendOpenForgeNotification(payload, openForgeLegacyHookUrl(legacyBase, provider, taskId), legacyBody);
}

// Oversized or unparseable stdin degrades to an empty object rather than
// throwing: identity comes from the environment, so the lifecycle event is
// still reportable, and dropping it would strand the task's status.
async function readOpenForgeShellHookInput() {
  try {
    const chunks = [];
    let bytes = 0;
    let oversized = false;
    for await (const chunk of process.stdin) {
      bytes += chunk.length;
      if (bytes > 65536) { oversized = true; chunks.length = 0; continue; }
      chunks.push(chunk);
    }
    if (oversized) return {};
    const text = Buffer.concat(chunks).toString("utf8").trim();
    return text ? JSON.parse(text) : {};
  } catch { return {}; }
}

async function openForgeShellHookMain() {
  try {
    const input = await readOpenForgeShellHookInput();
    await reportOpenForgeShellHook(process.argv[1], process.argv[2], process.argv[3], input, process.argv[4]);
  } catch {
    console.error("[openforge] notification acceptance failed");
  }
  // A lifecycle notification is not a permission decision. Never print allow/deny JSON.
}
openForgeShellHookMain();
