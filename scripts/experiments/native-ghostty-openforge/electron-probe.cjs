// Runs in Electron's main process. It attaches no PTY and launches no shell.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(process.env.GHOSTTY_OPENFORGE_ROOT ?? path.join(__dirname, '../../../artifacts/terminal-presentation/native-ghostty-openforge'))
let window
let bridge
let attachment

async function main() {
  await app.whenReady()
  bridge = require(path.join(root, 'openforge-ghostty.node'))
  const events = []
  bridge.initialize(event => events.push(event))
  window = new BrowserWindow({ width: 900, height: 600, show: false })
  await window.loadURL('data:text/html,<title>Native Ghostty bridge test</title>')
  const bounds = { x: 20, y: 20, width: 640, height: 400, scale: 1, visible: false }
  const create = (token, snapshot = Buffer.alloc(0)) => bridge.create(window.getNativeWindowHandle(), token, bounds, snapshot)
  attachment = create(1)
  const initial = Buffer.from('\x1b[?2026hBEFORE\r\n\x1b[6n\x1b[c\x1b[?1004h\x1b[?2026l')
  await bridge.appendAsync(attachment.id, 1, 0, initial)
  // A main-thread parser deadlocks when these notifications fill its own mailbox.
  const notificationFlood = Buffer.from('\x1b]0;hosted-title\x07'.repeat(1000) + '\r\nASYNC-OUTPUT')
  if (process.env.GHOSTTY_SYNC_OUTPUT_RED === '1') bridge.append(attachment.id, 1, initial.length, notificationFlood)
  if (process.env.GHOSTTY_EXIT_PENDING === '1') {
    void bridge.appendAsync(attachment.id, 1, initial.length, notificationFlood).catch(() => {})
    app.quit()
    await new Promise(() => {}) // Let graceful quit exercise async environment cleanup.
  }
  await bridge.appendAsync(attachment.id, 1, initial.length, notificationFlood)
  assert.match(bridge.inspect(attachment.id).text, /ASYNC-OUTPUT/)
  await assert.rejects(bridge.appendAsync(attachment.id, 2, initial.length, Buffer.from('STALE')), /rejected/)
  await assert.rejects(bridge.appendAsync(attachment.id, 1, initial.length + 1, Buffer.from('GAP')), /rejected/)
  const snapshot = bridge.snapshot(attachment.id)
  assert.ok(snapshot.length > 0)
  assert.throws(() => create(2, Buffer.from('malformed')), /create/)
  assert.match(bridge.inspect(attachment.id).text, /BEFORE/)
  for (let token = 2; token <= 6; token++) {
    const replacement = create(token, snapshot)
    assert.match(bridge.inspect(replacement.id).text, /BEFORE/)
    const old = attachment
    attachment = replacement
    bridge.destroy(old.id)
    assert.throws(() => bridge.inspect(old.id), /Unknown/)
    assert.equal(bridge.destroy(old.id), false)
    await bridge.appendAsync(attachment.id, token, 0, Buffer.from('LIVE'))
    while (!bridge.nextHistory(attachment.id).finished) {}
    assert.match(bridge.inspect(attachment.id).text, /LIVE/)
  }
  bridge.submitText(attachment.id, 'typed')
  bridge.pressKey(attachment.id, 36) // macOS Return, through native user-key encoding.
  const deadline = Date.now() + 5000
  while (events.reduce((count, event) => count + event.data.length, 0) < 6 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  assert.equal(Buffer.concat(events.map(event => Buffer.from(event.data))).toString(), 'typed\r')
  assert.ok(events.every(event => event.kind === 'input' && event.id === attachment.id && event.token === 6))
  assert.equal(bridge.inspect(attachment.id).terminalColumns, bridge.inspect(attachment.id).columns)
  assert.equal(bridge.inspect(attachment.id).terminalRows, bridge.inspect(attachment.id).rows)
  bridge.focus(attachment.id)
  bridge.setBounds(attachment.id, { ...bounds, width: 700, height: 440 })
  assert.ok(bridge.inspect(attachment.id).columns > 0)
  const retiring = create(9)
  const pending = bridge.appendAsync(retiring.id, 9, 0, notificationFlood)
  bridge.hide(retiring.id) // Must not wait for output or mutate parsed terminal state.
  assert.equal(bridge.destroy(retiring.id), true)
  assert.equal(bridge.destroy(retiring.id), false)
  await assert.rejects(pending, /destroyed/)
  assert.throws(() => bridge.inspect(retiring.id), /Unknown|destroyed/)
  bridge.destroy(attachment.id)
  attachment = null
  console.log(JSON.stringify({ event: 'electron-bridge-passed', scope: 'real BrowserWindow / N-API / hosted Surface state and input; no session or pixel evidence' }))
}

main().then(() => app.exit(0)).catch(error => {
  console.error(error)
  if (attachment && bridge) bridge.destroy(attachment.id)
  if (window && !window.isDestroyed()) window.destroy()
  app.exit(1)
})
