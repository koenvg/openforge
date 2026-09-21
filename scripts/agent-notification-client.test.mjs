import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { compileFunction, constants } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const cleanups = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

async function fixture(statuses, provider, { agentConfig = true } = {}) {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ path: request.url, method: request.method, auth: request.headers.authorization, body: JSON.parse(body) });
    response.writeHead(statuses.shift() ?? 202, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ journalId: "journal", position: 1 }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise(resolve => server.close(resolve)));
  const dir = mkdtempSync(join(tmpdir(), "of-notification-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, "agent.json");
  const origin = `http://127.0.0.1:${server.address().port}`;
  const legacyBase = `${origin}/hooks/legacy-event`;
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
      "claude-code": `(kind) => reportOpenForgeShellHook("claude-code", kind, kind === "ended" ? "stop" : "notification-permission", { session_id: "hook-sub-session" }, ${JSON.stringify(legacyBase)})`,
      grok: `(kind) => reportOpenForgeShellHook("grok", kind, kind === "ended" ? "stop" : "notification-permission", { session_id: "hook-sub-session" }, ${JSON.stringify(legacyBase)})`,
    }[provider];
  }
  const errors = [];
  const env = { OPENFORGE_TASK_ID: "T-1", OPENFORGE_PTY_INSTANCE_ID: "42", GROK_SESSION_ID: "grok-session-9", CLAUDE_SESSION_ID: "claude-session-9" };
  if (agentConfig) env.OPENFORGE_AGENT_CONFIG = config;
  const send = compileFunction(`${source}\nreturn ${action};`, ["process", "console"], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER })({ env, getuid: () => process.getuid() }, { error: (...args) => errors.push(args) });
  return { send, received, errors, origin, legacyBase };
}

async function runShellHook(provider, stdin) {
  const received = [];
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    received.push({ path: request.url, method: request.method, body: JSON.parse(body) });
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise(resolve => server.close(resolve)));
  const read = name => readFileSync(new URL(`../src-tauri/src/agent-notifications/${name}`, import.meta.url), "utf8");
  const source = `${read("client.js")}\n${read("shell-hook.js")}`;
  const endpoint = provider === "grok" ? "grok-stop" : "stop";
  const legacyBase = `http://127.0.0.1:${server.address().port}/hooks/${endpoint}`;
  const child = spawn(process.execPath, ["-e", source, provider, "ended", "stop", legacyBase], {
    env: { PATH: process.env.PATH, OPENFORGE_TASK_ID: "T-1", OPENFORGE_PTY_INSTANCE_ID: "42", GROK_SESSION_ID: "grok-session-9", CLAUDE_SESSION_ID: "claude-session-9" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", chunk => { stdout += chunk; });
  child.stderr.resume();
  child.stdin.end(stdin);
  await new Promise(resolve => child.on("close", resolve));
  return { received, stdout };
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
      if (provider === "claude-code" || provider === "grok") {
        expect(received[0].body.payload.provider_session_id).toBe(`${provider === "grok" ? "grok" : "claude"}-session-9`);
      }
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

  for (const [provider, sessionId] of [["grok", "grok-session-9"], ["claude-code", "claude-session-9"]]) {
    it(`${provider} shell hook falls back to the legacy listener without private configuration`, async () => {
      const { send, received } = await fixture([200], provider, { agentConfig: false });
      await send("ended");
      expect(received).toHaveLength(1);
      expect(received[0].auth).toBeUndefined();
      expect(received[0].method).toBe("POST");
      expect(received[0].path).toBe(`/hooks/legacy-event?task_id=T-1&pty_instance_id=42&session_id=${sessionId}`);
    });
  }

  it("does not replay a failed legacy delivery", async () => {
    const { send, received } = await fixture([503], "grok", { agentConfig: false });
    await expect(send("ended")).rejects.toThrow("notification acceptance failed");
    expect(received).toHaveLength(1);
  });

  it("does not retry invalid payload rejection", async () => {
    const { send, received } = await fixture([400]);
    await expect(send({ provider: "pi", kind: "ended", task_id: "T-1", pty_instance_id: 42 }, "unused")).rejects.toThrow("notification acceptance failed");
    expect(received).toHaveLength(1);
  });
  it("reuses a caller-provided ID when a durable sender replays later", async () => {
    const { send, received } = await fixture([503, 503, 503, 503, 202]);
    const payload = { provider: "codex", kind: "ended", task_id: "T-1", pty_instance_id: 42 };
    const notificationId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await expect(send(payload, "unused", undefined, notificationId)).rejects.toThrow("notification acceptance failed");
    await send(payload, "unused", undefined, notificationId);
    expect(received).toHaveLength(5);
    expect(received.every(request => request.body.id === notificationId)).toBe(true);
  });
  it("reports the legacy event from the generated argument order without touching stdout", async () => {
    const { received, stdout } = await runShellHook("grok", JSON.stringify({ session_id: "grok-stdin-session" }));
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].path).toBe("/hooks/grok-stop?task_id=T-1&pty_instance_id=42&session_id=grok-session-9");
    expect(received[0].body).toMatchObject({ provider: "grok", kind: "ended", raw_event_type: "stop", task_id: "T-1", pty_instance_id: 42 });
    expect(stdout).toBe("");
  });

  for (const [label, stdin] of [["oversized", "x".repeat(70000)], ["unparseable", "not json at all"]]) {
    it(`still reports the lifecycle event when hook stdin is ${label}`, async () => {
      const { received } = await runShellHook("grok", stdin);
      expect(received).toHaveLength(1);
      expect(received[0].body.kind).toBe("ended");
    });
  }

  it("posts Claude's own hook body to the legacy listener", async () => {
    const hookBody = { session_id: "claude-stdin-session", tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: "/tmp/transcript.jsonl", background_tasks: [{ id: "bash-1", status: "running" }] };
    const { received, stdout } = await runShellHook("claude-code", JSON.stringify(hookBody));
    expect(received).toHaveLength(1);
    expect(received[0].method).toBe("POST");
    expect(received[0].path).toBe("/hooks/stop?task_id=T-1&pty_instance_id=42&session_id=claude-session-9");
    expect(received[0].body).toEqual(hookBody);
    expect(stdout).toBe("");
  });

  it("posts a Claude tool_input larger than the envelope bound", async () => {
    const hookBody = { tool_name: "Write", tool_input: { content: "x".repeat(20000) } };
    const { received } = await runShellHook("claude-code", JSON.stringify(hookBody));
    expect(received).toHaveLength(1);
    expect(received[0].body.tool_input.content).toHaveLength(20000);
  });

  it("posts a Claude background inventory larger than the envelope bound", async () => {
    const background_tasks = Array.from({ length: 400 }, (_, i) => ({ id: `bash-${i}`, type: "bash", status: "running", description: "x".repeat(60) }));
    const { received } = await runShellHook("claude-code", JSON.stringify({ transcript_path: "/tmp/transcript.jsonl", background_tasks }));
    expect(received).toHaveLength(1);
    expect(received[0].body.background_tasks).toHaveLength(400);
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
