#!/usr/bin/env node
// Deterministic Pi command fixture, not a replacement for a supported-provider demonstration.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const root = process.cwd();
const config = JSON.parse(fs.readFileSync(process.env.OPENFORGE_AGENT_CONFIG, 'utf8'));
const tool = spawn('/bin/sleep', ['120'], { stdio: 'ignore' });
fs.appendFileSync(path.join(root, 'invocations.jsonl'), JSON.stringify(process.argv.slice(2)) + '\n');
let reportSequence = 0;
let cliSequence = 0;
function report() {
  process.kill(tool.pid, 0);
  process.stdout.write(`PI-PROOF-${reportSequence++} ` + JSON.stringify({
    pid: process.pid, toolPid: tool.pid, cwd: root,
    instance: process.env.OPENFORGE_PTY_INSTANCE_ID,
    term: process.env.TERM, stage: process.env.PRESERVATION_PROOF,
    controllerTokenAbsent: !process.env.OPENFORGE_BACKEND_TOKEN,
  }) + '\r\n');
}
report();
process.stdin.setEncoding('utf8');
let pending = '';
process.stdin.on('data', data => {
  pending += data;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline).trim();
    pending = pending.slice(newline + 1);
    if (line === 'ping') report();
    if (line === 'geometry') {
      const result = spawnSync('/bin/stty', ['size'], { stdio: [0, 'pipe', 'pipe'] });
      process.stdout.write('PI-GEOMETRY ' + result.stdout.toString().trim() + '\r\n');
    }
    if (line === 'cli') {
      const result = spawnSync(path.join(process.env.HOME, '.openforge/bin/openforge'), ['project', 'list'], { env: process.env, encoding: 'utf8' });
      process.stdout.write(`PI-CLI-${cliSequence++} ` + JSON.stringify({ status: result.status, found: result.stdout.includes('Pi preservation proof') }) + '\r\n');
    }
  }
});
// A control file lets the fixture send a lifecycle hook while no Sidecar is present.
let previous = '';
let sending = false;
setInterval(async () => {
  if (sending) return;
  let kind;
  try { kind = fs.readFileSync(path.join(root, 'notification-kind'), 'utf8').trim(); } catch { return; }
  if (!kind || kind === previous) return;
  sending = true;
  try {
    const response = await fetch(`http://127.0.0.1:${config.port}/notifications/agent-lifecycle`, {
      method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `pi-proof-${kind}`, payload: {
        provider: 'pi', task_id: process.env.OPENFORGE_TASK_ID,
        pty_instance_id: Number(process.env.OPENFORGE_PTY_INSTANCE_ID), kind,
      } }), signal: AbortSignal.timeout(5000),
    });
    fs.writeFileSync(path.join(root, `accepted-${kind}`), String(response.status));
    previous = kind;
  } finally { sending = false; }
}, 20);
