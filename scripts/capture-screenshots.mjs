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
  try { if (vite && vite.exitCode === null) vite.kill('SIGTERM') } catch {}
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
  try {
    await fn()
  } catch (e) {
    log(`STEP FAILED [${name}]: ${e.message}`)
  }
}

async function main() {
  log('preparing plugin artifacts...')
  await prepareElectronDevArtifacts()
  const runtimeOptions = resolveElectronDevRuntimeOptions()
  log(`starting vite on ${runtimeOptions.rendererUrl}`)
  vite = spawn('pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', String(runtimeOptions.rendererPort), '--strictPort'], { cwd: repoRoot, stdio: 'inherit' })
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

  // Give the window a consistent, generous size for clean screenshots.
  await step('resize', async () => {
    await electronApp.evaluate(async ({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0]
      if (w) { w.setContentSize(1440, 900); w.center() }
    })
  })

  // Let the sidecar come up and the board render.
  await page.waitForTimeout(6000)
  await shot(page, '00-initial.png')
  await dumpButtons(page, 'initial')

  const TASK_PROMPT = 'Refactor the authentication flow to support SSO login'

  // Dismiss any stray modal from a prior state.
  await step('reset', async () => { await page.keyboard.press('Escape'); await page.waitForTimeout(400) })

  await step('create-task', async () => {
    await page.getByRole('button', { name: 'Create new task' }).click()
    await page.waitForTimeout(800)
    await dumpButtons(page, 'dialog')
    const ta = page.locator('textarea').first()
    await ta.click()
    await ta.fill(TASK_PROMPT)
    await page.waitForTimeout(300)
    await shot(page, '01-create-dialog.png')
    await page.getByRole('button', { name: /add to backlog/i }).first().click({ timeout: 5000 })
    await page.waitForTimeout(2000)
  })

  await step('backlog-filter', async () => {
    // Try the keyboard shortcut, then fall back to clicking the Backlog tab.
    await page.keyboard.press('Meta+3')
    await page.waitForTimeout(600)
    try { await page.getByRole('button', { name: /^backlog\b/i }).first().click({ timeout: 2000 }) } catch {}
    await page.waitForTimeout(800)
    await shot(page, '02-board-backlog.png')
    await dumpButtons(page, 'board')
  })

  await step('select-card', async () => {
    await page.getByText(TASK_PROMPT).first().click()
    await page.waitForTimeout(1400)
    await shot(page, '03-board-sidepanel.png')
  })

  await step('open-full-view', async () => {
    await page.getByRole('button', { name: /open full view/i }).click()
    await page.waitForTimeout(2000)
    await shot(page, '04-task-detail.png')
    await dumpButtons(page, 'detail')
  })

  // Show the title-rename input in action on the detail page.
  await step('rename-input', async () => {
    await page.getByRole('button', { name: 'Rename task' }).first().click()
    await page.waitForTimeout(600)
    await shot(page, '05-detail-rename-input.png')
    await page.keyboard.press('Escape')
  })

  log('done')
}

main().then(cleanup).catch(async (e) => { console.error(e); await cleanup(); process.exit(1) })
