// Invoke the installed provider integration, not a replacement notification client.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function writeReceipt(file, status) {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, String(status));
  fs.renameSync(temporary, file);
}

// Grok executes its installed shell hook in a child Node process. Observe the
// actual ingress receipt without changing the request or approving any tool.
if (process.env.OPENFORGE_PROOF_HOOK_RECEIPT) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    const response = await originalFetch(...args);
    writeReceipt(process.env.OPENFORGE_PROOF_HOOK_RECEIPT, response.status);
    return response;
  };
}

let plugin;
module.exports = async function notify(provider, kind, receipt) {
  if (provider === 'opencode') {
    plugin ??= import('node:url').then(({ pathToFileURL }) =>
      import(pathToFileURL(path.join(process.env.HOME, '.config/opencode/plugins/openforge.ts')).href)
    ).then(module => module.OpenForgePlugin());
    const eventTypes = {
      requested_permission: 'permission.asked',
      input_wait: 'question.asked',
      became_busy: 'tool.execute.before',
      became_idle: 'session.idle',
      ended: 'session.idle',
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      const response = await originalFetch(...args);
      writeReceipt(receipt, response.status);
      return response;
    };
    try {
      await (await plugin).event({ event: {
        type: eventTypes[kind], properties: { sessionID: 'ses_opencode_native' },
      } });
    } finally { globalThis.fetch = originalFetch; }
    return;
  }
  if (provider === 'grok') {
    const hooks = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.grok/hooks/openforge.json'), 'utf8')).hooks;
    const eventTypes = {
      requested_permission: 'Notification',
      input_wait: 'Notification',
      became_busy: 'PreToolUse',
      became_idle: 'Stop',
      ended: 'SessionEnd',
    };
    const command = hooks[eventTypes[kind]][0].hooks[0].command;
    const result = spawnSync('/bin/sh', ['-c', command], {
      input: JSON.stringify({ session_id: 'grok-native-session' }), encoding: 'utf8',
      env: { ...process.env, NODE_OPTIONS: `--require ${__filename}`, OPENFORGE_PROOF_HOOK_RECEIPT: receipt },
      timeout: 10000,
    });
    if (result.status !== 0 || result.stdout || result.stderr) {
      throw new Error(`Grok telemetry hook failed or emitted a decision: ${result.status} ${result.stdout} ${result.stderr}`);
    }
    return;
  }
  throw new Error(`Unsupported native hook fixture: ${provider}`);
};
