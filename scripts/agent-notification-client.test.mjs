import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction, constants } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(statuses, provider) {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ path: request.url, auth: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(statuses.shift() ?? 202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ journalId: "journal", position: 1 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise(resolve => server.close(resolve)));
  const dir = mkdtempSync(join(tmpdir(), "of-notification-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "agent.json");
  writeFileSync(config, JSON.stringify({ version: 1, port: server.address().port, token: "private-fixture", pty: { installation: "install", lifetime: "lifetime", instance: 42 }, owner: { Agent: { task_id: "T-1" } } }), { mode: 0o600 });
  let source = readFileSync(new URL("../src-tauri/src/agent-notifications/client.js", import.meta.url), "utf8");
  let action = "sendOpenForgeNotification";
  if (provider) {
    const file = { pi: "pi-extension/openforge.ts", opencode: "opencode-plugin/openforge.ts", codex: "codex-hooks/openforge-hook.js", "claude-code": "agent-notifications/shell-hook.js", grok: "agent-notifications/shell-hook.js" }[provider];
    let adapter = readFileSync(new URL(`../src-tauri/src/${file}`, import.meta.url), "utf8");
    if (provider === "pi") adapter = stripTypeScriptTypes(adapter).replace(/^import .*;\s*$/gm, "").replace("export default function", "function");
    adapter = adapter.replace("export const OpenForgePlugin", "const OpenForgePlugin").replace("openForgeShellHookMain();", "").replace("main();", "");
    source += `\n${adapter}`;
    action = {
      pi: '(kind) => reportPiLifecycle("agent.end")',
      opencode: '(kind) => postOpenForgeEvent({ type: kind === "ended" ? "session.idle" : "permission.asked", properties: {sessionID: "ses_waiting"} })',
      codex: '(kind) => postLifecycleEvent(kind, kind === "ended" ? "Stop" : "PermissionRequest")',
      "claude-code": '(kind) => reportOpenForgeShellHook("claude-code", kind, kind === "ended" ? "stop" : "notification-permission", {})',
      grok: '(kind) => reportOpenForgeShellHook("grok", kind, kind === "ended" ? "stop" : "notification-permission", {})',
    }[provider];
  }
  const errors = [];
  const send = compileFunction(`${source}\nreturn ${action};`, ["process", "console"], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })({ env: { OPENFORGE_AGENT_CONFIG: config, OPENFORGE_TASK_ID: "T-1", OPENFORGE_PTY_INSTANCE_ID: "42" }, getuid: () => process.getuid() }, { error: (...args) => errors.push(args) });
  return { send, received, errors };
}

describe("provider lifecycle transport", () => {
  for (const provider of ["pi", "claude-code", "codex", "opencode", "grok"]) {
    for (const kind of ["ended", "requested_permission"]) {
      it(`${provider} retries ${kind} with one stable notification ID`, async () => {
        const { send, received } = await fixture([503, 202]);
        await send({ provider, kind, task_id: "T-1", pty_instance_id: 42 }, "unused");
        expect(received).toHaveLength(2);
        expect(received[0]).toEqual(received[1]);
        expect(received[0].path).toBe("/notifications/agent-lifecycle");
        expect(received[0].body.id).toMatch(/^[a-f0-9-]{36}$/);
        expect(received[0].body.payload.kind).toBe(kind);
      });
    }
    it(`${provider} native adapter retries completion and permission/input waiting`, async () => {
      const { send, received } = await fixture([503, 202, 503, 202], provider);
      await send("ended");
      await send("requested_permission");
      expect(received).toHaveLength(4);
      expect(received[0]).toEqual(received[1]);
      expect(received[2]).toEqual(received[3]);
      expect(received[0].body.payload.kind).toBe("ended");
      // Pi reports a settled turn as waiting for the next input, not a permission decision.
      expect(received[2].body.payload.kind).toBe(provider === "pi" ? "ended" : "requested_permission");
    });
    it(`${provider} native adapter exposes exhausted acceptance`, async () => {
      const { send, received, errors } = await fixture([503, 503, 503, 503], provider);
      let failed = false;
      try { await send("requested_permission"); } catch { failed = true; }
      expect(failed || errors.length > 0).toBe(true);
      expect(received).toHaveLength(4);
      expect(new Set(received.map(r => r.body.id)).size).toBe(1);
    });
    it(`${provider} reports exhausted acceptance without approving permission`, async () => {
      const { send, received } = await fixture([503, 503, 503, 503]);
      await expect(send({ provider, kind: "requested_permission", task_id: "T-1", pty_instance_id: 42 }, "unused")).rejects.toThrow("notification acceptance failed");
      expect(received).toHaveLength(4);
      expect(new Set(received.map(r => r.body.id)).size).toBe(1);
      expect(received.every(r => r.body.payload.kind === "requested_permission")).toBe(true);
    });
  }
  it("bounds callbacks awaiting acceptance and rejects invalid ownership without fallback", async () => {
    const { send, received } = await fixture([]);
    const payload = { provider: "pi", kind: "ended", task_id: "T-1", pty_instance_id: 42 };
    const outcomes = await Promise.allSettled(Array.from({ length: 65 }, () => send(payload, "unused")));
    expect(outcomes.filter(r => r.status === "fulfilled")).toHaveLength(64);
    expect(outcomes[64].status).toBe("rejected");
    expect(received).toHaveLength(64);
    await expect(send({ ...payload, task_id: "forged" }, "unused")).rejects.toThrow("notification acceptance failed");
    await expect(send({ ...payload, activity_snapshot: "x".repeat(16384) }, "unused")).rejects.toThrow("exceeds 16384 bytes");
    expect(received).toHaveLength(64);
  });

  it("does not retry invalid payload rejection", async () => {
    const { send, received } = await fixture([400]);
    await expect(send({ provider: "pi", kind: "ended", task_id: "T-1", pty_instance_id: 42 }, "unused")).rejects.toThrow("notification acceptance failed");
    expect(received).toHaveLength(1);
  });
  it("captures the notification before an asynchronous caller can mutate it", async () => {
    const { send, received } = await fixture([]);
    const payload = { provider: "pi", kind: "ended", task_id: "T-1", pty_instance_id: 42 };
    const pending = send(payload, "unused");
    payload.kind = "requested_permission";
    await pending;
    expect(received[0].body.payload.kind).toBe("ended");
  });
});
