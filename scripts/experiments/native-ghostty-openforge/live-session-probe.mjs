#!/usr/bin/env node
import { _electron } from 'playwright'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDesktopTestLifecycle, createDesktopTestPaths } from '../../desktop-test/lifecycle.mjs'
import { createFixtureRepository, seedFixtureAppData } from '../../desktop-test/fixture.mjs'
import { createDesktopAppDriver } from '../../desktop-test/driver.mjs'
import { resolveRustSidecarLayout } from '../../rust-sidecar-layout.mjs'
import { prepareElectronDevCargoEnv, resolveElectronDevBackendEnv, electronSidecarPath } from '../../electron-dev.mjs'
import { repo, root } from './common.mjs'

const output = join(root, 'live-session')
await mkdir(output, { recursive: true })
const runRoot = await mkdtemp(join(tmpdir(), 'openforge-native-session-'))
const paths = createDesktopTestPaths({ runRoot, artifactRoot: output })
const layout = resolveRustSidecarLayout({ repoRoot: repo })
const backend = await resolveElectronDevBackendEnv({ cwd: repo, env: process.env, rustSidecarLayout: layout })
const cargoEnv = await prepareElectronDevCargoEnv(backend.env)
console.log('Building the backend for the isolated live-session probe')
try {
  const build = execFileSync('cargo', ['build', '--locked', '--offline'], { cwd: layout.backendCrateRootPath, env: cargoEnv, timeout: 1200000, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  await writeFile(join(output, 'backend-build.log'), build)
} catch (error) {
  await writeFile(join(output, 'backend-build.log'), `${error.stdout ?? ''}${error.stderr ?? ''}`)
  throw error
}
const repository = await createFixtureRepository({ runRoot })
const manifest = await seedFixtureAppData({ sidecarPath: electronSidecarPath(backend.cargoTargetDir, layout), appDataDir: paths.appDataDir, repoPath: repository.repoPath, manifestPath: paths.fixtureManifestPath })
const terminalKey = `${manifest.taskId}-shell-0`
process.env.VITE_OPENFORGE_EXPERIMENTAL_GHOSTTY_SESSION = terminalKey
const lifecycle = createDesktopTestLifecycle({ runRoot, outputDir: output, playwrightElectron: true, requireSidecarReadiness: true, timeoutMs: 120000, retainRuntime: true }, {
  electronApi: {
    async launch(options) {
      const application = await _electron.launch(options)
      const observe = page => {
        page.on('dialog', dialog => void (dialog.type() === 'beforeunload' ? dialog.accept() : dialog.dismiss()).catch(error => console.warn('Dialog handling:', error.message)))
        page.on('pageerror', error => console.error('renderer-error:', error.message))
        page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.error('renderer-console:', message.text()) })
      }
      application.on('window', observe)
      for (const page of application.windows()) observe(page)
      return application
    },
  },
  createFixtureRepository: async () => repository,
  seedFixtureAppData: async () => manifest,
})
const report = { terminalKey, runRoot, assertions: [], scope: 'Actual OpenForge, Terminal Runtime, Rust backend and an existing PTY; native state/input, not pixel evidence' }
let context
const addonPath = join(root, 'openforge-ghostty.node')

async function native(operation, id, text) {
  return Promise.race([context.electronApplication.evaluate(async ({ app }, args) => {
    const require = process.getBuiltinModule('module').createRequire(app.getAppPath() + '/package.json')
    const addon = require(args.path)
    if (args.operation === 'inspect') return addon.inspect(args.id)
    if (args.operation === 'destroy') return addon.destroy(args.id)
    if (args.operation === 'command') { addon.submitText(args.id, args.text); addon.pressKey(args.id, 36) }
    else addon.submitText(args.id, args.text)
  }, { path: addonPath, operation, id, text }),
  new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Native main-process call timed out')), 10000); timer.unref() })])
}
async function attachment() {
  await context.page.waitForFunction(() => document.querySelector('[data-native-terminal-state="live"]')?.getAttribute('data-native-attachment'), null, { timeout: 30000 })
  return context.page.evaluate(() => JSON.parse(document.querySelector('[data-native-terminal-state="live"]').getAttribute('data-native-attachment')))
}
async function waitText(id, text) {
  const deadline = Date.now() + 15000
  let lastState
  while (Date.now() < deadline) {
    try {
      const state = await native('inspect', id)
      lastState = state
      if (state.text.includes(text)) return state
    } catch (error) { if (!String(error).includes('Native output pending')) throw error }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  await writeFile(join(output, 'last-native-state.json'), JSON.stringify(lastState, null, 2))
  throw new Error(`Native terminal did not contain ${text}`)
}
// The persistent Rust sidecar survives Electron exit. Own only this fixture tree.
function fixtureProcesses() {
  const pid = context?.readiness?.process.pid
  if (!pid) return []
  let environment
  try { environment = execFileSync('ps', ['eww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' }) } catch { return [] }
  if (!environment.includes(`OPENFORGE_APP_DATA_DIR=${paths.appDataDir} `)) throw new Error('Refusing cleanup: fixture sidecar identity changed')
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,lstart=,command='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const fields = line.trim().split(/\s+/)
    return { pid: Number(fields[0]), parent: Number(fields[1]), identity: fields.slice(2).join(' ') }
  })
  const owned = new Set([pid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) if (owned.has(row.parent) && !owned.has(row.pid)) { owned.add(row.pid); changed = true }
  }
  return rows.filter(row => owned.has(row.pid))
}
function stopFixtureProcesses(rows) {
  for (const row of rows.reverse()) {
    try {
      const identity = execFileSync('ps', ['-p', String(row.pid), '-o', 'lstart=,command='], { encoding: 'utf8' }).trim().split(/\s+/).join(' ')
      if (identity === row.identity) process.kill(row.pid, 'SIGKILL')
    } catch { /* Already exited. */ }
  }
}
async function waitVisible(id, visible) {
  const deadline = Date.now() + 10000
  while (Date.now() < deadline) {
    try { if ((await native('inspect', id)).visible === visible) return }
    catch (error) {
      if (!visible && /Unknown native attachment|destroyed/.test(String(error))) return
      if (!String(error).includes('Native output pending')) throw error
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  throw new Error(`Native visibility did not become ${visible}`)
}
async function observation() {
  return context.page.evaluate(key => window.__openforgeE2e.terminal.observe(key), terminalKey)
}

try {
  context = await lifecycle.start()
  context.page.on('pageerror', error => console.error('renderer-error:', error.message))
  await context.page.getByText(manifest.projectName, { exact: true }).first().waitFor({ state: 'visible', timeout: 120000 })
  console.log('Fixture UI is ready')
  const driver = createDesktopAppDriver(context.page, { timeoutMs: 30000 })
  await driver.verifyDesktopBridge()
  await driver.selectSeededTask(manifest)
  await driver.attachTerminalView(manifest.taskId, { focus: false })
  let owner = await attachment()
  await context.page.waitForFunction(key => window.__openforgeE2e.terminal.observe(key).lifecycle.ptyActive, terminalKey, { timeout: 30000 })
  owner = await attachment()
  await native('command', owner.id, `python3 -c 'print(bytes.fromhex("${Buffer.from('EXISTING-NATIVE-SESSION').toString('hex')}").decode())'`)
  await waitText(owner.id, 'EXISTING-NATIVE-SESSION')
  const before = await observation()
  const instance = before.lifecycle.currentPtyInstance
  assert.ok(Number.isSafeInteger(instance))

  // The milestone is this second attachment: the PTY and its output already exist.
  const previousOwner = owner.id
  await driver.detachTerminalView(context.page.getByRole('region', { name: 'Terminal region for Shell 1' }), { projectName: manifest.projectName })
  await driver.selectSeededTask(manifest)
  await driver.attachTerminalView(manifest.taskId, { focus: false })
  owner = await attachment()
  assert.notEqual(owner.id, previousOwner)
  await waitText(owner.id, 'EXISTING-NATIVE-SESSION')
  assert.equal((await observation()).lifecycle.currentPtyInstance, instance)
  report.assertions.push('Reattached native Ghostty to the same existing PTY and restored its marker')

  await driver.selectTaskView('Files')
  await waitVisible(owner.id, false)
  await driver.attachTerminalView(manifest.taskId, { focus: false })
  owner = await attachment()
  await waitVisible(owner.id, true)
  assert.equal((await observation()).lifecycle.currentPtyInstance, instance)
  report.assertions.push('Native view hides behind another pane and reappears without replacing the PTY')

  const program = `import os,termios,tty,select,time\nold=termios.tcgetattr(0)\ntry:\n tty.setraw(0)\n os.write(1,b'\\r\\nQUERY-ARMED\\x1b[5n')\n reply=b''\n deadline=time.monotonic()+1\n while time.monotonic()<deadline:\n  if select.select([0],[],[],0.05)[0]: reply+=os.read(0,4096)\n os.write(1,b'\\r\\nREPLY='+reply.hex().encode()+b'\\r\\nINPUT-ARMED')\n incoming=b''\n deadline=time.monotonic()+10\n while len(incoming)<7 and time.monotonic()<deadline:\n  if select.select([0],[],[],0.05)[0]: incoming+=os.read(0,4096)\n os.write(1,b'\\r\\nINPUT='+incoming.hex().encode()+b'\\r\\n')\nfinally:\n termios.tcsetattr(0,termios.TCSANOW,old)\n`
  await native('command', owner.id, `python3 -c 'import base64;exec(base64.b64decode("${Buffer.from(program).toString('base64')}"))'`)
  await waitText(owner.id, 'INPUT-ARMED')
  await native('submit', owner.id, 'hé🙂')
  const state = await waitText(owner.id, 'INPUT=68c3a9f09f9982')
  assert.match(state.text, /INPUT=68c3a9f09f9982(?:\s|$)/)
  assert.match(state.text, /REPLY=1b5b306e(?:\s|$)/)
  report.assertions.push('Observed one backend DSR reply and exact native UTF-8 input at the PTY')

  await context.electronApplication.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1100, 780) })
  await new Promise(resolve => setTimeout(resolve, 500))
  await native('command', owner.id, `python3 -c 'print(bytes.fromhex("${Buffer.from('AFTER-NATIVE-RESIZE').toString('hex')}").decode())'`)
  const resized = await waitText(owner.id, 'AFTER-NATIVE-RESIZE')
  assert.equal(resized.terminalColumns, resized.columns)
  assert.equal(resized.terminalRows, resized.rows)
  assert.equal((await observation()).lifecycle.currentPtyInstance, instance)
  report.assertions.push('Live output and the same PTY survived resize')
  report.final = { instance, columns: resized.columns, rows: resized.rows }
  await native('destroy', owner.id)
  await context.page.evaluate(async key => {
    const { desktopRestartTerminalControl } = await import('/src/lib/desktopRestartTerminalControl.ts')
    await desktopRestartTerminalControl.writePty(key, 'printf "\\x46\\x41\\x4c\\x4c\\x42\\x41\\x43\\x4b\\x2d\\x52\\x45\\x43\\x4f\\x56\\x45\\x52\\x45\\x44\\n"\r')
  }, terminalKey)
  await context.page.waitForFunction(() => document.querySelector('[data-native-terminal-state="fallback"]'), null, { timeout: 15000 })
  const recovered = await context.page.evaluate(key => window.__openforgeE2e.terminal.drain(key, { marker: 'FALLBACK-RECOVERED', markerMatch: 'line', timeoutMs: 15000 }), terminalKey)
  assert.equal(recovered.markerFound, true)
  assert.equal(recovered.observation.lifecycle.currentPtyInstance, instance)
  report.assertions.push('A lost native attachment recovered into xterm from the same PTY authority')
  // Chromium screenshots omit AppKit subviews; retain only surrounding layout evidence.
  await context.page.screenshot({ path: join(output, 'chromium-layout-only.png'), timeout: 3000 }).catch(error => { report.layoutCaptureError = String(error) })
  report.pixelEvidence = false
  report.passed = true
  console.log(JSON.stringify(report))
} catch (error) {
  report.passed = false
  if (context) {
    await context.page.screenshot({ path: join(output, 'failure-layout-only.png'), timeout: 2000 }).catch(() => {})
    await writeFile(join(output, 'failure-dom.txt'), await context.page.locator('body').innerText({ timeout: 2000 }).catch(() => 'DOM unavailable'))
    context.launcher.children().electron?.kill('SIGKILL')
  }
  report.error = String(error.stack ?? error).replace(/openforge-e2e-token=[a-f0-9]+/g, 'openforge-e2e-token=[redacted]')
  throw error
} finally {
  let owned = []
  try { owned = fixtureProcesses() } catch (error) { report.cleanupError = String(error) }
  report.fixtureProcessIds = owned.map(row => row.pid)
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  if (context) {
    await context.page.evaluate(async key => {
      const { desktopRestartTerminalControl } = await import('/src/lib/desktopRestartTerminalControl.ts')
      await desktopRestartTerminalControl.killPty(key)
    }, terminalKey).catch(() => {})
  }
  try { await lifecycle.shutdown() } finally { stopFixtureProcesses(owned) }
}
