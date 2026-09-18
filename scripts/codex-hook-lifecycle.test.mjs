import { readFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { compileFunction, constants } from "node:vm";
import { afterEach, describe, expect, it } from "vitest";

const source = [
  readFileSync(new URL("../src-tauri/src/agent-notifications/client.js", import.meta.url), "utf8"),
  readFileSync(new URL("../src-tauri/src/codex-hooks/openforge-hook.js", import.meta.url), "utf8")
    .replace(/\nmain\(\);\s*$/, ""),
].join("\n");

const cleanups = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(label) {
  const fakeProcess = Object.create(process);
  Object.defineProperty(fakeProcess, "env", {
    value: {
      ...process.env,
      OPENFORGE_TASK_ID: `T-CODEX-${label}-${Date.now()}-${Math.random()}`,
      OPENFORGE_PTY_INSTANCE_ID: "91",
      OPENFORGE_HTTP_PORT: "38123",
    },
  });
  const create = compileFunction(`${source}
let testFailures = 0;
let testDelay = null;
const testDeliveries = [];
sendOpenForgeNotification = async (payload, _url, _body, notificationId) => {
  if (testDelay) await testDelay;
  if (testFailures > 0) { testFailures -= 1; throw new Error("rejected"); }
  testDeliveries.push({ payload, notificationId });
};
return {
  deliveries: testDeliveries,
  failNext(count = 1) { testFailures = count; },
  delayUntil(promise) { testDelay = promise; },
  clearDelay() { testDelay = null; },
  setPty(value) { process.env.OPENFORGE_PTY_INSTANCE_ID = String(value); },
  event: processCodexLifecycleEvent,
  readState: readCodexTurnState,
  statePath: activeTurnStatePath,
  stateLockPath: codexTurnStateLockPath,
  deliveryLockPath: codexTurnDeliveryLockPath,
  monitor: monitorCodexTranscriptTurn,
  parseTranscript: codexTranscriptLifecycleEvent,
  findTranscriptEvents: findCodexTranscriptLifecycleEvents,
};`, ["process"], { importModuleDynamically: constants.USE_MAIN_CONTEXT_DEFAULT_LOADER });
  const api = create(fakeProcess);
  const paths = [await api.statePath(), await api.stateLockPath(), await api.deliveryLockPath()];
  cleanups.push(() => Promise.all(paths.map(path => rm(path, { recursive: true, force: true }))));
  return api;
}

async function processFixture(label) {
  const taskId = `T-CODEX-PROCESS-${label}-${Date.now()}-${Math.random()}`;
  const scriptPath = join(tmpdir(), `openforge-codex-process-${Date.now()}-${Math.random()}.mjs`);
  const script = `${source}
const deliveries = [];
sendOpenForgeNotification = async (payload, _url, _body, notificationId) => {
  deliveries.push({ payload, notificationId });
};
const event = JSON.parse(process.env.OPENFORGE_CODEX_TEST_EVENT);
await processCodexLifecycleEvent(event.kind, event.rawEventType, event.rawStatusType, event.hookInput);
process.stdout.write(JSON.stringify(deliveries));`;
  await writeFile(scriptPath, script, "utf8");
  const keyPart = value => String(value).replace(/[^a-zA-Z0-9_.-]/g, "_");
  const statePath = join(tmpdir(), `openforge-codex-turn-${keyPart(taskId)}-91.json`);
  cleanups.push(() => Promise.all([
    rm(scriptPath, { force: true }),
    rm(statePath, { force: true }),
    rm(`${statePath}.lock`, { recursive: true, force: true }),
    rm(`${statePath}.delivery.lock`, { recursive: true, force: true }),
  ]));

  const run = event => new Promise((resolve, reject) => {
    const childProcess = spawn(process.execPath, [scriptPath], {
      env: {
        ...process.env,
        OPENFORGE_TASK_ID: taskId,
        OPENFORGE_PTY_INSTANCE_ID: "91",
        OPENFORGE_HTTP_PORT: "38123",
        OPENFORGE_CODEX_TEST_EVENT: JSON.stringify(event),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    childProcess.stdout.on("data", chunk => { stdout += chunk; });
    childProcess.stderr.on("data", chunk => { stderr += chunk; });
    childProcess.on("error", reject);
    childProcess.on("close", code => {
      if (code === 0) resolve(JSON.parse(stdout));
      else reject(new Error(stderr || `Codex hook process exited ${code}`));
    });
  });
  return { run };
}

const parent = turnId => ({ turn_id: turnId, transcript_path: `/tmp/${turnId}.jsonl` });
const child = (turnId, agentId) => ({ ...parent(turnId), agent_id: agentId });

describe("Codex parent and background-agent lifecycle", () => {
  it("waits for post-resolution parent and final-child transcript events", async () => {
    const api = await fixture("confirmed-completion");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-1"));
    await api.event("became_busy", "SubagentStart", null, child("turn-1", "child-1"));
    await api.event("ended", "Stop", null, parent("turn-1"));
    await api.event("ended", "SubagentStop", null, child("turn-1", "child-1"));

    expect(api.deliveries.map(({ payload }) => payload.kind)).toEqual(["became_busy", "became_busy"]);
    expect(JSON.parse(api.deliveries[1].payload.activity_snapshot)).toMatchObject({
      turn_id: "turn-1",
      agent_id: "child-1",
    });
    expect((await api.readState()).activeAgentIds).toEqual(["child-1"]);

    await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-1"));
    expect(api.deliveries.map(({ payload }) => payload.kind)).toEqual(["became_busy", "became_busy"]);
    await api.event("ended", "TranscriptSubagentEnd", "completed", child("turn-1", "child-1"));

    expect(api.deliveries.at(-1).payload).toMatchObject({
      kind: "ended",
      raw_event_type: "TranscriptSubagentEnd",
    });
    expect(await api.readState()).toMatchObject({ parentStatus: "ended", activeAgentIds: [] });
  });

  it("keeps the parent active when children finish first", async () => {
    const api = await fixture("child-first");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-2"));
    await api.event("became_busy", "SubagentStart", null, child("turn-2", "child-1"));
    await api.event("ended", "TranscriptSubagentEnd", "completed", child("turn-2", "child-1"));
    expect(api.deliveries.filter(({ payload }) => payload.kind === "ended")).toHaveLength(0);
    await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-2"));
    expect(api.deliveries.filter(({ payload }) => payload.kind === "ended")).toHaveLength(1);
  });

  it("tracks descendants started after the root parent ends", async () => {
    const api = await fixture("descendant");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-3"));
    await api.event("became_busy", "SubagentStart", null, child("turn-3", "child-1"));
    await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-3"));
    await api.event("became_busy", "SubagentStart", null, child("turn-3", "grandchild-1"));
    await api.event("ended", "TranscriptSubagentEnd", "completed", child("turn-3", "child-1"));

    expect((await api.readState()).activeAgentIds).toEqual(["grandchild-1"]);
    expect(api.deliveries.filter(({ payload }) => payload.kind === "ended")).toHaveLength(0);

    await api.event("ended", "TranscriptSubagentEnd", "completed", child("turn-3", "grandchild-1"));
    expect(api.deliveries.filter(({ payload }) => payload.kind === "ended")).toHaveLength(1);
  });

  it("preserves children when a blocked stop resumes the same turn", async () => {
    const api = await fixture("blocked-stop");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-4"));
    await api.event("became_busy", "SubagentStart", null, child("turn-4", "child-1"));
    await api.event("ended", "Stop", null, parent("turn-4"));
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-4"));
    expect(await api.readState()).toMatchObject({ parentStatus: "active", activeAgentIds: ["child-1"] });
  });

  it("ignores duplicate, malformed, stale, and settled-turn activity", async () => {
    const api = await fixture("fences");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-5"));
    await api.event("became_busy", "SubagentStart", null, parent("turn-5"));
    await api.event("became_busy", "SubagentStart", null, child("turn-5", "child-1"));
    await api.event("became_busy", "SubagentStart", null, child("turn-5", "child-1"));
    await api.event("ended", "TranscriptSubagentEnd", "completed", child("old-turn", "child-1"));
    await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-5"));
    await api.event("ended", "TranscriptSubagentEnd", "completed", child("turn-5", "child-1"));
    await api.event("became_busy", "PostToolUse", null, parent("turn-5"));

    expect(api.deliveries.map(({ payload }) => payload.raw_event_type)).toEqual([
      "UserPromptSubmit",
      "SubagentStart",
      "TranscriptSubagentEnd",
    ]);
  });

  it("isolates coordination state by PTY instance", async () => {
    const api = await fixture("pty-fence");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-pty"));
    api.setPty(92);
    await api.event("became_busy", "SubagentStart", null, child("turn-pty", "wrong-pty-child"));
    expect(await api.readState()).toBeNull();
    api.setPty(91);
    expect((await api.readState()).activeAgentIds).toEqual([]);
  });

  it("replaces legacy, corrupt, or unsupported state only on a new prompt", async () => {
    const api = await fixture("invalid-state");
    const invalidStates = [
      JSON.stringify({ turnId: "legacy" }),
      "{not-json",
      JSON.stringify({ version: 99, turnId: "future", parentStatus: "active", activeAgentIds: [] }),
    ];
    for (const [index, invalidState] of invalidStates.entries()) {
      await writeFile(await api.statePath(), invalidState, "utf8");
      await api.event("became_busy", "PreToolUse", null, parent(`invalid-${index}`));
      expect(await api.readState()).toBeNull();
      await api.event("became_busy", "UserPromptSubmit", null, parent(`recovered-${index}`));
      expect((await api.readState()).turnId).toBe(`recovered-${index}`);
    }
  });

  it("replaces settled state only for a new prompt and fences the old turn", async () => {
    const api = await fixture("follow-up");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-old"));
    await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-old"));
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-new"));
    await api.event("became_busy", "PreToolUse", null, parent("turn-old"));
    await api.event("became_busy", "PreToolUse", null, parent("turn-new"));
    expect((await api.readState()).turnId).toBe("turn-new");
    expect(api.deliveries.at(-1).payload.raw_event_type).toBe("PreToolUse");
  });

  it("lets the superseded turn monitor exit", async () => {
    const api = await fixture("superseded-monitor");
    const transcript = join(tmpdir(), `openforge-codex-superseded-${Date.now()}-${Math.random()}.jsonl`);
    cleanups.push(() => rm(transcript, { force: true }));
    await writeFile(transcript, "", "utf8");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-old"));
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-new"));
    await expect(api.monitor(transcript, "turn-old", { timeoutMs: 100, pollIntervalMs: 1 })).resolves.toBe(true);
  });

  it("persists rejected completion and replays it with the same notification ID", async () => {
    const api = await fixture("durable-outbox");
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-6"));
    api.failNext();
    expect(await api.event("ended", "TranscriptTurnEnd", "task_complete", parent("turn-6"))).toBe(false);
    const pendingId = (await api.readState()).pendingNotifications[0].id;

    expect(await api.event("ended", "Stop", null, parent("turn-6"))).toBe(true);
    expect(api.deliveries.at(-1)).toMatchObject({
      notificationId: pendingId,
      payload: { kind: "ended", raw_event_type: "TranscriptTurnEnd" },
    });
    expect((await api.readState()).pendingNotifications).toEqual([]);
  });

  it("does not hold the state lock during slow notification delivery", async () => {
    const api = await fixture("slow-delivery");
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    api.delayUntil(gate);
    const first = api.event("became_busy", "UserPromptSubmit", null, parent("turn-slow"));
    await new Promise(resolve => setTimeout(resolve, 20));
    const second = api.event("became_busy", "SubagentStart", null, child("turn-slow", "child-1"));
    await expect(Promise.race([
      second.then(() => "transitioned"),
      new Promise(resolve => setTimeout(() => resolve("blocked"), 500)),
    ])).resolves.toBe("transitioned");
    expect((await api.readState()).activeAgentIds).toEqual(["child-1"]);
    api.clearDelay();
    release();
    await first;
  });

  it("serializes parent and multi-child confirmations across hook processes", async () => {
    const { run } = await processFixture("concurrent");
    await run({ kind: "became_busy", rawEventType: "UserPromptSubmit", hookInput: parent("turn-process") });
    await run({ kind: "became_busy", rawEventType: "SubagentStart", hookInput: child("turn-process", "child-1") });
    await run({ kind: "became_busy", rawEventType: "SubagentStart", hookInput: child("turn-process", "child-2") });
    const firstConfirmations = await Promise.all([
      run({ kind: "ended", rawEventType: "TranscriptTurnEnd", rawStatusType: "task_complete", hookInput: parent("turn-process") }),
      run({ kind: "ended", rawEventType: "TranscriptSubagentEnd", rawStatusType: "completed", hookInput: child("turn-process", "child-1") }),
    ]);
    expect(firstConfirmations.flat().filter(({ payload }) => payload.kind === "ended")).toHaveLength(0);

    const final = await run({
      kind: "ended",
      rawEventType: "TranscriptSubagentEnd",
      rawStatusType: "completed",
      hookInput: child("turn-process", "child-2"),
    });
    expect(final.filter(({ payload }) => payload.kind === "ended")).toHaveLength(1);
  });

  it("recovers an abandoned state lock", async () => {
    const api = await fixture("stale-lock");
    const fs = await import("node:fs/promises");
    const lockPath = await api.stateLockPath();
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(`${lockPath}/owner.json`, JSON.stringify({ pid: 99999999 }), "utf8");
    const stale = new Date(Date.now() - 31_000);
    await fs.utimes(lockPath, stale, stale);
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-lock"));
    expect((await api.readState()).turnId).toBe("turn-lock");
  });

  it("uses transcript confirmations for parent and child completion", async () => {
    const api = await fixture("monitor");
    const transcript = join(tmpdir(), `openforge-codex-monitor-${Date.now()}-${Math.random()}.jsonl`);
    cleanups.push(() => rm(transcript, { force: true }));
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-monitor"));
    await api.event("became_busy", "SubagentStart", null, child("turn-monitor", "child-1"));
    await writeFile(transcript, [
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: "turn-monitor" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "item_completed", turn_id: "turn-monitor", item: { type: "SubAgentActivity", kind: "completed", agent_thread_id: "child-1" } } }),
    ].join("\n") + "\n", "utf8");

    await expect(api.monitor(transcript, "turn-monitor", { timeoutMs: 200, pollIntervalMs: 1 })).resolves.toBe(true);
    expect(api.deliveries.at(-1).payload).toMatchObject({ kind: "ended", raw_event_type: "TranscriptSubagentEnd" });
  });

  it("completes a childless turn after a transcript-reported capacity failure", async () => {
    const api = await fixture("capacity");
    const transcript = join(tmpdir(), `openforge-codex-capacity-${Date.now()}-${Math.random()}.jsonl`);
    cleanups.push(() => rm(transcript, { force: true }));
    await api.event("became_busy", "UserPromptSubmit", null, parent("turn-capacity"));
    await writeFile(transcript, [
      JSON.stringify({ type: "event_msg", payload: { type: "error", message: "model is at capacity" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: "turn-capacity" } }),
    ].join("\n") + "\n", "utf8");

    await expect(api.monitor(transcript, "turn-capacity", { timeoutMs: 200, pollIntervalMs: 1 })).resolves.toBe(true);
    expect(api.deliveries.at(-1).payload).toMatchObject({
      kind: "ended",
      raw_event_type: "TranscriptTurnEnd",
      raw_status_type: "task_complete",
    });
  });

  it("retains a partial transcript line for the next poll", async () => {
    const api = await fixture("partial-line");
    const transcript = join(tmpdir(), `openforge-codex-partial-${Date.now()}-${Math.random()}.jsonl`);
    cleanups.push(() => rm(transcript, { force: true }));
    const line = JSON.stringify({ type: "event_msg", payload: { type: "task_complete", turn_id: "turn-partial" } });
    await writeFile(transcript, line.slice(0, 20), "utf8");
    const first = await api.findTranscriptEvents(transcript, "turn-partial", 0);
    expect(first).toEqual({ offset: 0, events: [] });
    await writeFile(transcript, `${line}\n`, "utf8");
    const second = await api.findTranscriptEvents(transcript, "turn-partial", first.offset);
    expect(second.events).toEqual([{ type: "parent_ended", statusType: "task_complete" }]);
  });

  it("recognizes interrupted parent turns without treating unrelated turns as terminal", async () => {
    const api = await fixture("interrupted");
    expect(api.parseTranscript(
      { type: "event_msg", payload: { type: "turn_aborted", turn_id: "turn-abort", reason: "interrupted" } },
      "turn-abort",
    )).toEqual({ type: "parent_ended", statusType: "turn_aborted:interrupted" });
    expect(api.parseTranscript(
      { type: "event_msg", payload: { type: "task_complete", turn_id: "other-turn" } },
      "turn-abort",
    )).toBeNull();
  });
});
