// Embedded into each installed adapter so running agents retain their transport code.
// No request-response command or permission decision may use this client.
let openForgeNotificationTail = Promise.resolve();
let openForgePendingNotifications = 0;

function sendOpenForgeNotification(payload, legacyUrl) {
  // Serialize callbacks from a long-lived provider. Retries reuse the same envelope.
  let captured;
  try {
    const json = JSON.stringify(payload);
    if (Buffer.byteLength(json) > 16384) return Promise.reject(new Error("notification acceptance failed: payload exceeds 16384 bytes"));
    captured = JSON.parse(json);
  } catch { return Promise.reject(new Error("notification acceptance failed: invalid payload")); }
  if (openForgePendingNotifications >= 64) return Promise.reject(new Error("notification acceptance failed: callback capacity exhausted"));
  openForgePendingNotifications += 1;
  const work = openForgeNotificationTail.then(() => deliverOpenForgeNotification(captured, legacyUrl))
    .finally(() => { openForgePendingNotifications -= 1; });
  openForgeNotificationTail = work.catch(() => {});
  return work;
}

async function openForgeNotificationConfig(payload) {
  const path = process.env.OPENFORGE_AGENT_CONFIG;
  if (!path) return null;
  const { isAbsolute } = await import("node:path");
  const { open } = await import("node:fs/promises");
  const { constants } = await import("node:fs");
  if (!isAbsolute(path)) throw new Error("notification configuration invalid");
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid() || stat.size > 4096) throw new Error("notification configuration invalid");
    const buffer = Buffer.alloc(4097);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > 4096) throw new Error("notification configuration invalid");
    const config = JSON.parse(buffer.toString("utf8", 0, bytesRead));
    if (config.version !== 1 || !Number.isInteger(config.port) || config.port < 1 || config.port > 65535
      || typeof config.token !== "string" || !/^[a-zA-Z0-9_-]{1,256}$/.test(config.token)
      || config.owner?.Agent?.task_id !== payload.task_id || config.pty?.instance !== payload.pty_instance_id) throw new Error("notification configuration invalid");
    return config;
  } finally { await file.close(); }
}

async function deliverOpenForgeNotification(payload, legacyUrl) {
  let config;
  try { config = await openForgeNotificationConfig(payload); }
  catch { throw new Error("notification acceptance failed: private configuration unavailable"); }
  const { randomUUID } = await import("node:crypto");
  const body = JSON.stringify(config ? { id: randomUUID(), payload } : payload);
  if (Buffer.byteLength(body) > 16384) throw new Error("notification acceptance failed: payload exceeds 16384 bytes");
  const url = config ? `http://127.0.0.1:${config.port}/notifications/agent-lifecycle` : legacyUrl;
  // Legacy listeners have no durable deduplication contract. Never replay their requests.
  const attempts = config ? 4 : 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    let retry = true;
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json", ...(config ? { Authorization: `Bearer ${config.token}` } : {}) },
        body, signal: controller.signal,
      });
      if (!config && response.ok) { await response.body?.cancel(); return; }
      if (config && response.status === 202) {
        const reader = response.body.getReader();
        let size = 0;
        const chunks = [];
        try {
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            size += value.length;
            if (size > 1024) throw new Error("invalid receipt");
            chunks.push(value);
          }
        } finally { await reader.cancel(); }
        const receipt = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        if (typeof receipt.journalId !== "string" || receipt.journalId.length > 128 || !Number.isSafeInteger(receipt.position) || receipt.position < 1) throw new Error("invalid receipt");
        return;
      }
      retry = [408, 425, 429, 500, 502, 503, 504].includes(response.status);
      await response.body?.cancel();
    } catch {
      // Lost acceptance replies are safe to retry only because the sender ID is unchanged.
    } finally { clearTimeout(timeout); }
    if (!retry || attempt + 1 === attempts) break;
    await new Promise(resolve => setTimeout(resolve, [100, 250, 500][attempt]));
  }
  // Fixed diagnostic, with no payload, credential, URL, provider text or response body.
  throw new Error("notification acceptance failed: retry budget exhausted or ingress rejected payload");
}
