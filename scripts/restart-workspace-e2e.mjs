#!/usr/bin/env node
/** Real Electron replacement against an isolated daemon; never attaches to a developer app. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { chromium } from 'playwright'
import { createDesktopTestLifecycle } from './desktop-test/lifecycle.mjs'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'
import { createElectronDevLauncher } from './electron-dev.mjs'
import { stopProcess, waitForDevTools } from './electron-process.mjs'
import { waitForOwnedDaemonExit } from './desktop-test/daemon-ownership.mjs'
import { cleanupRestartFixture } from './restart-workspace-fixture.mjs'

function spawnCommand(command, args, options = {}) {
  const detached = process.platform !== 'win32'
  const child = spawn(command, args, { cwd: process.cwd(), stdio: 'inherit', shell: process.platform === 'win32', ...options, detached })
  child.openforgeDetached = detached
  return child
}

const daemonRoot = await mkdtemp('/tmp/openforge-restart-daemon-')
let originalLaunch = null
let browser = null
let page = null
let normalProcess = null
const lifecycle = createDesktopTestLifecycle({ timeoutMs: 120_000, retainRuntime: true }, {
  createElectronDevLauncher: options => createElectronDevLauncher({
    ...options,
    env: { ...options.env, OPENFORGE_SESSION_DAEMON_ROOT: daemonRoot,
      CARGO_TARGET_DIR: resolve('src-tauri/target'),
      OPENFORGE_SESSION_DAEMON_PATH: resolve('src-tauri/crates/session-daemon/target/debug/openforge-session-daemon'),
      OPENFORGE_SESSION_DAEMON_SHELL_KEY: '', OPENFORGE_E2E_RESTART_WINDOWS: '2' },
  }, {
    spawnCommand(command, args, options) {
      if (command === 'pnpm' && args[0] === 'exec' && args[1] === 'electron') originalLaunch = { command, args, options }
      return spawnCommand(command, args, options)
    },
  }),
})

async function until(check, timeout = 30_000) {
  const deadline = Date.now() + timeout
  let error
  while (Date.now() < deadline) {
    try { const result = await check(); if (result) return result } catch (caught) { error = caught }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw error ?? new Error('Controlled restart condition timed out')
}
async function windows() {
  return until(async () => {
    const pages = browser.contexts().flatMap(context => context.pages()).filter(page => page.url().startsWith('http://127.0.0.1:'))
    if (pages.length !== 2) return false
    for (const candidate of pages) if (!await candidate.locator('[data-app-ready="true"]').count()) return false
    return pages
  })
}
async function workspace(candidate) {
  return candidate.evaluate(async () => {
    const { get } = await import('/node_modules/svelte/src/store/index-client.js')
    const stores = await import('/src/lib/stores.ts')
    const { terminalSessionService } = await import('/src/lib/terminalSessionService.ts')
    return { projectId: get(stores.activeProjectId), taskId: get(stores.selectedTaskId), view: get(stores.currentView), tasks: terminalSessionService.snapshotWorkspace() }
  })
}
async function inventory(candidate) {
  return candidate.evaluate(async () => (await import('/src/lib/ipc.ts')).getRestartTerminalInventory())
}

let context
try {
  const build = spawnSync('cargo', ['build', '--manifest-path', 'src-tauri/crates/session-daemon/Cargo.toml'], { stdio: 'inherit' })
  assert.equal(build.status, 0)
  context = await lifecycle.start()
  browser = context.browser
  const initialPages = await windows()
  page = initialPages[0]
  const otherPage = initialPages[1]
  const manifest = context.fixture.manifest
  const marker = `restore-${crypto.randomUUID()}`
  const directory = join(context.fixture.repository.repoPath, 'retained-cwd')
  await mkdir(directory)
  const driver = createDesktopAppDriver(page, { timeoutMs: 30_000 })
  const attached = await driver.openSeededTerminal(manifest)
  await driver.typeTerminalCommand(attached.region, `export OF_RESTART='${marker}'; cd '${directory}'; printf 'BEFORE:%s\\n' "$OF_RESTART"`)
  await driver.drainTerminal(attached.terminalKey, { marker: `BEFORE:${marker}`, timeoutMs: 30_000 })

  const other = await page.evaluate(async ({ projectId, directory }) => {
    const ipc = await import('/src/lib/ipc.ts')
    const task = await ipc.createTask('Other retained workspace', 'backlog', projectId, null)
    for (const index of [4, 7, 9]) await ipc.spawnShellPty(task.id, directory, 80, 24, index)
    await ipc.writePty(`${task.id}-shell-7`, 'exit\r')
    const { regularTerminalSessions } = await import('/src/lib/terminalSessionService.ts')
    regularTerminalSessions.updateTaskTerminalTabsSession(task.id, {
      tabs: [{ index: 4, key: `${task.id}-shell-4`, label: 'Build' }, { index: 7, key: `${task.id}-shell-7`, label: 'Exited' }],
      activeTabIndex: 7, nextIndex: 8,
    })
    return { id: task.id, title: task.title }
  }, { projectId: manifest.projectId, directory })
  // Match the existing isolated fixture's non-agent workspace without starting an AI provider.
  const seedOtherWorkspace = spawnSync('python3', ['-c',
    'import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); c.execute("INSERT INTO task_workspaces (task_id,project_id,workspace_path,repo_path,kind,branch_name,provider_name,status,created_at,updated_at) SELECT ?,project_id,?,repo_path,kind,branch_name,provider_name,status,created_at,updated_at FROM task_workspaces WHERE task_id=?", (sys.argv[2],sys.argv[3],sys.argv[4])); c.commit()',
    manifest.databasePath, other.id, directory, manifest.taskId], { encoding: 'utf8' })
  assert.equal(seedOtherWorkspace.status, 0, seedOtherWorkspace.stderr)
  await until(async () => (await inventory(page)).sessions.some(session => session.key === `${other.id}-shell-7` && !session.isLive))
  await otherPage.evaluate(async taskId => {
    const { regularTerminalSessions } = await import('/src/lib/terminalSessionService.ts')
    regularTerminalSessions.updateTaskTerminalTabsSession(taskId, {
      tabs: [{ index: 4, key: `${taskId}-shell-4`, label: 'Other build' }, { index: 7, key: `${taskId}-shell-7`, label: 'Other exited' }],
      activeTabIndex: 4, nextIndex: 8,
    })
  }, other.id)
  const otherDriver = createDesktopAppDriver(otherPage, { timeoutMs: 30_000 })
  await otherDriver.selectSeededTask({ ...manifest, taskId: other.id, taskTitle: other.title })
  await otherDriver.selectTaskView('Terminal')
  await otherPage.getByRole('region', { name: 'Terminal region for Shell 5' }).waitFor()
  const before = await inventory(page)
  const beforeWorkspaces = await Promise.all(initialPages.map(workspace))
  assert.equal(before.hasLegacySessions, false)

  const sourceBrowser = browser
  await page.evaluate(async () => (await import('/src/lib/ipc.ts')).restartApp()).catch(error => {
    if (!/closed|destroyed/i.test(error.message)) throw error
  })
  await until(() => !sourceBrowser.isConnected())
  await waitForDevTools(context.ports.chromiumDebugPort, { timeoutMs: 60_000 })
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${context.ports.chromiumDebugPort}`)
  const replacementPages = await windows()
  const afterWorkspaces = await Promise.all(replacementPages.map(workspace))
  assert.deepEqual(afterWorkspaces.map(item => item.taskId).sort(), beforeWorkspaces.map(item => item.taskId).sort())
  page = replacementPages[afterWorkspaces.findIndex(item => item.taskId === manifest.taskId)]
  const after = await inventory(page)
  assert.equal(after.controller.installation, before.controller.installation)
  assert.ok(after.controller.generation > before.controller.generation)
  assert.deepEqual(after.sessions, before.sessions)
  const hiddenTabs = (await workspace(page)).tasks.find(task => task.taskId === other.id)
  assert.deepEqual(hiddenTabs.tabs.map(tab => tab.index), [4, 7, 9])
  assert.deepEqual(hiddenTabs.tabs.slice(0, 2).map(tab => tab.label), ['Build', 'Exited'])
  assert.equal(hiddenTabs.activeTabIndex, 7)
  assert.equal(hiddenTabs.nextIndex, 10)
  const restoredDriver = createDesktopAppDriver(page, { timeoutMs: 30_000 })
  const region = page.getByRole('region', { name: 'Terminal region for Shell 1' })
  await region.waitFor()
  await restoredDriver.drainTerminal(attached.terminalKey, { marker: `BEFORE:${marker}`, timeoutMs: 30_000 })
  await restoredDriver.typeTerminalCommand(region, `printf 'AFTER:%s CWD:%s\\n' "$OF_RESTART" "\${PWD##*/}"`)
  await restoredDriver.drainTerminal(attached.terminalKey, { marker: `AFTER:${marker} CWD:retained-cwd`, timeoutMs: 30_000 })
  await restoredDriver.selectSeededTask({ ...manifest, taskId: other.id, taskTitle: other.title })
  await restoredDriver.selectTaskView('Terminal')
  await page.getByRole('region', { name: 'Terminal region for Shell 8' }).waitFor()
  await until(async () => {
    const state = await restoredDriver.observeTerminal(`${other.id}-shell-7`)
    return state.lifecycle.authorityReadApplied && !state.lifecycle.authorityReadPending
  })
  assert.deepEqual((await inventory(page)).sessions, before.sessions)
  for (const candidate of replacementPages) assert.equal(await candidate.evaluate(async () => (await import('/src/lib/ipc.ts')).getRestartWorkspace()), null)
  const record = JSON.parse(await readFile(join(context.paths.electronUserDataDir, 'restart-workspace.json'), 'utf8'))
  assert.equal(record.restoredWindowIds.length, 2)

  const restoredBrowser = browser
  await page.evaluate(async () => (await import('/src/lib/ipc.ts')).quitApp()).catch(() => {})
  await until(() => !restoredBrowser.isConnected())
  await until(async () => !(await readdir(join(daemonRoot, 'session-v1'))).includes('control.sock'))
  await waitForOwnedDaemonExit(join(daemonRoot, 'session-v1'))
  assert.ok(originalLaunch)
  normalProcess = spawnCommand(originalLaunch.command, originalLaunch.args, originalLaunch.options)
  await waitForDevTools(context.ports.chromiumDebugPort, { timeoutMs: 60_000 })
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${context.ports.chromiumDebugPort}`)
  const normalPages = await windows()
  page = normalPages[0]
  for (const candidate of normalPages) {
    assert.equal(await candidate.evaluate(async () => (await import('/src/lib/ipc.ts')).getRestartWorkspace()), null)
    assert.ok(!(await workspace(candidate)).tasks.some(task => task.tabs.some(tab => tab.label === 'Build')))
  }
  console.log('PASS: real controlled replacement; two Tasks/windows; retained cwd/environment/output/PTY identities; exited and unsnapshotted tabs; consumed records; normal launch isolation')
} catch (error) {
  console.error('Controlled restart fixture failed:', error.message)
  console.error('Launch flags:', Object.fromEntries(Object.entries(originalLaunch?.options.env ?? {}).filter(([key]) => key.startsWith('OPENFORGE_SESSION_DAEMON') || ['OPENFORGE_E2E', 'OPENFORGE_E2E_RESTART_WINDOWS', 'OPENFORGE_ELECTRON_USER_DATA_DIR'].includes(key))))
  for (const candidate of browser?.contexts().flatMap(context => context.pages()) ?? []) {
    console.error('Renderer:', await candidate.locator('body').innerText({ timeout: 1000 }).catch(() => 'unavailable'))
  }
  if (context) await browser?.contexts()[0]?.pages()[0]?.screenshot({ path: context.paths.failureScreenshotPath }).catch(() => {})
  throw error
} finally {
  await cleanupRestartFixture({
    daemonRoot,
    runRoot: context?.paths.runRoot,
    stopOwnedWriters: async () => {
      if (page && !page.isClosed()) await page.evaluate(async () => (await import('/src/lib/ipc.ts')).quitApp()).catch(() => {})
      await browser?.close().catch(() => {})
      try {
        if (normalProcess) {
          await stopProcess(normalProcess, { forceWaitMs: 5000 })
          if (normalProcess.exitCode === null && normalProcess.signalCode === null) {
            throw new Error('Owned normal Electron launcher did not exit; retaining fixture resources')
          }
        }
      } finally {
        await lifecycle.shutdown()
      }
    },
  }).catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
