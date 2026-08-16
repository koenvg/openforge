#!/usr/bin/env node
// Launches the Electron app (reusing the electron-dev orchestration) under Playwright
// and captures UI screenshots. Reusable: `node scripts/capture-screenshots.mjs`.
import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import electronBinary from 'electron'
import {
  prepareElectronDevArtifacts,
  resolveElectronDevRuntimeOptions,
  resolveElectronDevBackendEnv,
  buildElectronDevEnv,
  electronSidecarPath,
  waitForVite,
  stopProcess,
} from './electron-dev.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// Scratch output — gitignored, never committed.
const OUT_DIR = join(repoRoot, 'screenshots')
mkdirSync(OUT_DIR, { recursive: true })

const log = (m) => console.log(`[capture] ${m}`)

function run(cmd, args, opts = {}) {
  return new Promise((res, rej) => {
    const c = spawn(cmd, args, { cwd: repoRoot, stdio: 'inherit', ...opts })
    c.once('error', rej)
    c.once('exit', (code) => (code === 0 ? res() : rej(new Error(`${cmd} ${args.join(' ')} exited ${code}`))))
  })
}

let vite = null
let electronApp = null
async function cleanup() {
  try { if (electronApp) await electronApp.close() } catch {}
  try { await stopProcess(vite) } catch {}
}

async function shot(page, name) {
  const p = join(OUT_DIR, name)
  await page.screenshot({ path: p })
  log(`saved ${name}`)
}

async function dumpButtons(page, label) {
  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button,[role=button]'))
      .map((b) => (b.getAttribute('aria-label') || b.textContent || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 80),
  )
  log(`buttons[${label}]: ${JSON.stringify(names)}`)
}

async function step(name, fn) {
  log(`verifying ${name}...`)
  try {
    await fn()
    log(`verified ${name}`)
  } catch (e) {
    log(`STEP FAILED [${name}]: ${e.message}`)
    throw e
  }
}

async function main() {
  log('preparing plugin artifacts...')
  await prepareElectronDevArtifacts()
  const runtimeOptions = resolveElectronDevRuntimeOptions()
  log(`starting vite on ${runtimeOptions.rendererUrl}`)
  const viteBin = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'vite.cmd' : 'vite')
  vite = spawn(viteBin, ['--host', '127.0.0.1', '--port', String(runtimeOptions.rendererPort), '--strictPort'], { cwd: repoRoot, stdio: 'inherit' })
  await waitForVite(runtimeOptions.rendererUrl, vite)
  const devBackend = await resolveElectronDevBackendEnv()
  const layout = resolveRustSidecarLayout({ repoRoot })
  const sidecarPath = devBackend.env.OPENFORGE_SIDECAR_PATH ?? electronSidecarPath(devBackend.cargoTargetDir, layout)
  log('building rust sidecar (incremental)...')
  await run('cargo', ['build'], { cwd: layout.backendCrateRootPath, env: devBackend.env })
  log('building electron main...')
  await run('pnpm', ['electron:build'])
  const env = buildElectronDevEnv(devBackend.env, sidecarPath, runtimeOptions)

  log('launching electron via playwright...')
  electronApp = await electron.launch({ executablePath: electronBinary, args: ['.'], cwd: repoRoot, env })
  const page = await electronApp.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  page.setDefaultTimeout(15_000)

  // Give the window a consistent, generous size for clean screenshots.
  await step('resize', async () => {
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) { w.setContentSize(1440, 900); w.center() }
    })
  })

  const captureId = new Date().toISOString().replace(/\D/g, '').slice(0, 14)
  const TASK_PROMPT = `Verify the redesigned board screenshot flow (${captureId})`
  const newTaskAction = page.getByRole('button', { name: 'New task', exact: true })
  const taskCard = page.locator('[data-vim-item]').filter({ hasText: TASK_PROMPT })
  let taskId = null

  // Normalize persisted navigation before capturing anything. The Board action is
  // available independently of whichever task or plugin view was open last.
  await step('board', async () => {
    await page.keyboard.press('Escape')
    await dumpButtons(page, 'launch')
    const boardAction = page.getByRole('button', { name: 'Board', exact: true })
    await boardAction.waitFor({ state: 'visible', timeout: 60_000 })
    await boardAction.click()
    await newTaskAction.waitFor({ state: 'visible' })
    await page.waitForFunction(
      () => Boolean(document.querySelector('header h1')?.textContent?.trim()),
      undefined,
      { timeout: 60_000 },
    )
    const activeProjectName = (await page.locator('header h1').first().textContent())?.trim()
    if (!activeProjectName) throw new Error('Screenshot capture requires an active project')
    await shot(page, '00-initial.png')
    await dumpButtons(page, 'initial')
  })

  await step('create-task', async () => {
    await newTaskAction.click()
    const dialog = page.getByRole('dialog', { name: 'Create task' })
    await dialog.waitFor({ state: 'visible' })
    await dumpButtons(page, 'dialog')

    const prompt = dialog.getByRole('textbox', { name: 'What should the agent do?' })
    await prompt.fill(TASK_PROMPT)
    if (await prompt.inputValue() !== TASK_PROMPT) throw new Error('Create Task prompt did not retain its value')

    await shot(page, '01-create-dialog.png')
    await dialog.getByRole('button', { name: 'Add to backlog', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  })

  await step('backlog-filter', async () => {
    const boardFilters = page.getByRole('group', { name: 'Board filters' })
    const backlogFilter = boardFilters.getByRole('button', { name: /^Backlog\b/ })

    // Command+4 is the canonical Backlog shortcut. Keep the click fallback for
    // non-macOS capture hosts where Playwright maps the modifier differently.
    await page.keyboard.press('Meta+4')
    await page.waitForTimeout(250)
    if (await backlogFilter.getAttribute('aria-pressed') !== 'true') await backlogFilter.click()
    if (await backlogFilter.getAttribute('aria-pressed') !== 'true') throw new Error('Backlog filter did not activate')

    // Persisted label filters can otherwise hide the task created by this run.
    const selectedLabelFilters = page
      .getByRole('group', { name: 'Backlog label filters' })
      .locator('button[aria-pressed="true"]')
    while (await selectedLabelFilters.count()) await selectedLabelFilters.first().click()

    await taskCard.waitFor({ state: 'visible' })
    await shot(page, '02-board-backlog.png')
    await dumpButtons(page, 'board')
  })

  await step('task-inspector', async () => {
    if (await taskCard.getAttribute('data-selected') !== 'true') await taskCard.click()
    const inspector = page.locator('[data-testid="task-inspector-panel"][aria-label^="Task inspector for "]')
    await inspector.waitFor({ state: 'visible' })
    await inspector.getByText(TASK_PROMPT, { exact: true }).waitFor({ state: 'attached' })

    const inspectorLabel = await inspector.getAttribute('aria-label')
    taskId = inspectorLabel?.replace('Task inspector for ', '') ?? null
    if (!taskId) throw new Error('Could not resolve the created task ID from the inspector')
    log(`created task ${taskId}`)

    await shot(page, '03-board-sidepanel.png')
  })

  await step('full-task-detail', async () => {
    await page.getByRole('button', { name: 'Open full view', exact: true }).click()
    await page.getByRole('heading', { name: TASK_PROMPT, exact: true }).waitFor({ state: 'visible' })
    await page.getByText(taskId, { exact: true }).first().waitFor({ state: 'visible' })
    await page.getByRole('button', { name: /back/i }).waitFor({ state: 'visible' })

    await shot(page, '04-task-detail.png')
    await dumpButtons(page, 'detail')
  })

  // Show the title-rename input in action on the detail page.
  await step('rename-input', async () => {
    await page.getByRole('button', { name: 'Rename task', exact: true }).first().click()
    await page.getByRole('textbox', { name: 'Task title' }).waitFor({ state: 'visible' })
    await shot(page, '05-detail-rename-input.png')
    await page.keyboard.press('Escape')
  })

  log('done')
}

main().then(cleanup).catch(async (e) => { console.error(e); await cleanup(); process.exit(1) })
