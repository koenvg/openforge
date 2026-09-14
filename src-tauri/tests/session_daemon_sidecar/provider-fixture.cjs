#!/usr/bin/env node
// Deterministic provider process. Live CLI demonstrations are separate.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
// Claude command discovery is a separate one-shot query, not an agent session.
if (process.argv.includes('--print') || process.argv.includes('--help') || process.argv.includes('--version')) {
  process.stdout.write('{}\n');
  process.exit(0);
}
const executable = path.basename(process.argv[1]);
const provider = executable === 'claude' ? 'claude-code' : executable;
const root = process.cwd();
const tool = spawn('/bin/sleep', ['600'], { stdio: 'ignore' });
fs.appendFileSync(path.join(root, 'invocations.jsonl'), JSON.stringify(process.argv.slice(2)) + '\n');
let sequence = 0;
function report() {
  process.kill(tool.pid, 0);
  const tty = spawnSync('/usr/bin/tty', [], { stdio: [0, 'pipe', 'pipe'], encoding: 'utf8' });
  if (tty.status !== 0) throw new Error('provider fixture lost its PTY');
  process.stdout.write(`PROVIDER-PROOF-${sequence++} ` + JSON.stringify({
    provider, pid: process.pid, toolPid: tool.pid, cwd: root,
    tty: tty.stdout.trim(),
    instance: process.env.OPENFORGE_PTY_INSTANCE_ID,
    task: process.env.OPENFORGE_TASK_ID, claudeTask: process.env.CLAUDE_TASK_ID,
    term: process.env.TERM, stage: process.env.PRESERVATION_PROOF,
    controllerTokenAbsent: !process.env.OPENFORGE_BACKEND_TOKEN,
    auth: process.env.XAI_API_KEY, termProgram: process.env.TERM_PROGRAM,
    imageSession: process.env.ITERM_SESSION_ID ?? null,
  }) + '\r\n');
}
report();
let pending = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', data => {
  pending += data;
  let newline;
  while ((newline = pending.indexOf('\n')) !== -1) {
    const line = pending.slice(0, newline).trim();
    pending = pending.slice(newline + 1);
    if (line === 'ping') report();
    if (line === 'exit') process.exit(7);
    if (line === 'geometry') {
      const result = spawnSync('/bin/stty', ['size'], { stdio: [0, 'pipe', 'pipe'] });
      process.stdout.write('PROVIDER-GEOMETRY ' + result.stdout.toString().trim() + '\r\n');
    }
    if (line === 'approve') fs.writeFileSync(path.join(root, 'approved'), 'yes');
    if (line === 'cli') {
      const result = spawnSync(path.join(process.env.HOME, '.openforge/bin/openforge'), ['project', 'list'], { env: process.env, encoding: 'utf8' });
      process.stdout.write('PROVIDER-CLI ' + JSON.stringify({ status: result.status, found: result.stdout.includes('Provider preservation proof') }) + '\r\n');
    }
  }
});
let previous = '';
let sending = false;
setInterval(async () => {
  if (fs.existsSync(path.join(root, 'exit-now'))) { tool.kill(); process.exit(7); }
  if (sending) return;
  let kind;
  try { kind = fs.readFileSync(path.join(root, 'notification-kind'), 'utf8').trim(); } catch { return; }
  if (!kind || kind === previous) return;
  sending = true;
  try {
    if (provider === 'opencode' || provider === 'grok') {
      await require('./provider-hooks.cjs')(provider, kind, path.join(root, `accepted-${kind}`));
      previous = kind;
      return;
    }
    const config = JSON.parse(fs.readFileSync(process.env.OPENFORGE_AGENT_CONFIG, 'utf8'));
    const response = await fetch(`http://127.0.0.1:${config.port}/notifications/agent-lifecycle`, {
      method: 'POST', headers: { authorization: `Bearer ${config.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ id: `${provider}-proof-${kind}`, payload: {
        provider, task_id: process.env.OPENFORGE_TASK_ID,
        provider_session_id: `${provider}-native-session`,
        pty_instance_id: Number(process.env.OPENFORGE_PTY_INSTANCE_ID), kind,
      } }), signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) fs.writeFileSync(path.join(root, 'notification-error'), await response.text());
    fs.writeFileSync(path.join(root, `accepted-${kind}`), String(response.status));
    previous = kind;
  } catch (error) {
    fs.writeFileSync(path.join(root, 'notification-error'), String(error));
  } finally { sending = false; }
}, 20);
