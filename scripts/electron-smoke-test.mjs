#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'
import { APP_NAME, electronBundlePath } from './electron-package.mjs'

export const DEFAULT_SMOKE_PORT = 17652
export const DEFAULT_ARTIFACTS_DIR = 'test-results/electron-smoke'
const DEFAULT_TIMEOUT_MS = 60_000
const CLI_TIMEOUT_MS = 30_000
const CLI_RETRY_INTERVAL_MS = 500

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function parseSmokeArgs(argv = process.argv.slice(2), env = process.env) {
  const args = [...argv]
  let artifactsDir = env.OPENFORGE_ELECTRON_SMOKE_ARTIFACTS_DIR || DEFAULT_ARTIFACTS_DIR
  let skipBuild = false

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--skip-build') {
      skipBuild = true
      continue
    }
    if (arg === '--artifacts-dir') {
      const value = args[index + 1]
      if (!value) throw new Error('--artifacts-dir requires a path')
      artifactsDir = value
      index += 1
      continue
    }
    if (arg.startsWith('--artifacts-dir=')) {
      artifactsDir = arg.slice('--artifacts-dir='.length)
      continue
    }
    throw new Error(`Unknown electron smoke option: ${arg}`)
  }

  return { skipBuild, artifactsDir }
}

export function smokeBuildSteps({ skipBuild } = {}) {
  return skipBuild ? [] : [{ command: 'pnpm', args: ['electron:package'] }]
}

export function electronAppExecutablePath(appPath = electronBundlePath(), appName = APP_NAME) {
  return join(appPath, 'Contents', 'MacOS', appName)
}

export function openForgeCliBridgePath(appPath = electronBundlePath()) {
  return join(appPath, 'Contents', 'Resources', 'openforge-cli', 'cli.js')
}

export function smokeLaunchEnv({ env = process.env, port = DEFAULT_SMOKE_PORT, userDataDir, appDataDir } = {}) {
  const {
    ELECTRON_RENDERER_URL: _ignoredRendererUrl,
    OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR: _ignoredDisableSidecar,
    OPENFORGE_SIDECAR_PATH: _ignoredSidecarPath,
    ...baseEnv
  } = env

  return {
    ...baseEnv,
    CI: env.CI ?? '1',
    OPENFORGE_BACKEND_PORT: String(port),
    OPENFORGE_HTTP_PORT: String(port),
    OPENFORGE_ELECTRON_SMOKE_TEST: '1',
    ...(userDataDir ? { OPENFORGE_ELECTRON_USER_DATA_DIR: userDataDir } : {}),
    ...(appDataDir ? { OPENFORGE_APP_DATA_DIR: appDataDir } : {}),
  }
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function assertExists(path, label) {
  if (!(await pathExists(path))) {
    throw new Error(`${label} not found at ${path}`)
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function runCommand(command, args, { cwd = repoRoot(), env = process.env, log = () => {} } = {}) {
  return new Promise((resolvePromise, reject) => {
    log(`$ ${command} ${args.join(' ')}`)
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })

    child.stdout?.on('data', chunk => log(chunk.toString().trimEnd()))
    child.stderr?.on('data', chunk => log(chunk.toString().trimEnd()))
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

export async function runCli(command, args, { cwd = repoRoot(), env = process.env, timeoutMs = CLI_TIMEOUT_MS } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const settle = (callback, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      callback(value)
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      settle(reject, new Error(`${command} ${args.join(' ')} timed out after ${timeoutMs}ms`))
    }, timeoutMs)
    timeout.unref?.()

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString()
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.once('error', error => settle(reject, error))
    child.once('exit', (code, signal) => {
      const result = { code, signal, stdout, stderr }
      if (code === 0) {
        settle(resolvePromise, result)
        return
      }
      const error = new Error(`${command} ${args.join(' ')} exited with ${signal ?? `code ${code}`}: ${stderr.trim()}`)
      error.result = result
      settle(reject, error)
    })
  })
}

async function runCliBridgeListProjects({ cliPath, env, timeoutMs = CLI_TIMEOUT_MS, intervalMs = CLI_RETRY_INTERVAL_MS, log }) {
  const startedAt = Date.now()
  let lastError = null

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt))
      const result = await runCli(process.execPath, [cliPath, 'list-projects'], { env, timeoutMs: remainingMs })
      log(`[cli] ${result.stdout.trim()}`)
      const parsed = JSON.parse(result.stdout)
      if (!Array.isArray(parsed)) {
        throw new Error(`list-projects returned non-array JSON: ${result.stdout.trim()}`)
      }
      return parsed
    } catch (error) {
      lastError = error
      await sleep(intervalMs)
    }
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'timed out')
  throw new Error(`OpenForge CLI bridge did not respond to list-projects: ${message}`)
}

async function writeFailureArtifacts({ artifactsDir, logs, page, electronApp, traceStarted }) {
  await mkdir(artifactsDir, { recursive: true })
  await writeFile(join(artifactsDir, 'electron.log'), `${logs.join('\n')}\n`)

  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(artifactsDir, 'failure.png'), fullPage: true }).catch(error => {
      logs.push(`[artifact] screenshot failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  if (electronApp && traceStarted) {
    await electronApp.context().tracing.stop({ path: join(artifactsDir, 'trace.zip') }).catch(error => {
      logs.push(`[artifact] trace failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  await writeFile(join(artifactsDir, 'electron.log'), `${logs.join('\n')}\n`)
}

async function prepareBuild({ skipBuild, root, log }) {
  for (const step of smokeBuildSteps({ skipBuild })) {
    await runCommand(step.command, step.args, { cwd: root, log })
  }
}

export async function runElectronSmokeTest({
  skipBuild = false,
  artifactsDir = DEFAULT_ARTIFACTS_DIR,
  root = repoRoot(),
  port = DEFAULT_SMOKE_PORT,
  launchElectron = electron.launch.bind(electron),
} = {}) {
  if (process.platform !== 'darwin') {
    throw new Error('test:electron-smoke currently supports the packaged macOS Electron app and must run on darwin')
  }

  const absoluteArtifactsDir = resolve(root, artifactsDir)
  const tempRoot = join(tmpdir(), `openforge-electron-smoke-${process.pid}`)
  const userDataDir = join(tempRoot, 'electron-user-data')
  const appDataDir = join(tempRoot, 'sidecar-data')
  const videosDir = join(absoluteArtifactsDir, 'videos')
  const tracesDir = join(absoluteArtifactsDir, 'traces')
  const logs = []
  const log = message => {
    if (!message) return
    const formatted = `[${new Date().toISOString()}] ${message}`
    logs.push(formatted)
    console.log(formatted)
  }

  await rm(absoluteArtifactsDir, { recursive: true, force: true })
  await mkdir(absoluteArtifactsDir, { recursive: true })
  await rm(tempRoot, { recursive: true, force: true })
  await mkdir(userDataDir, { recursive: true })
  await mkdir(appDataDir, { recursive: true })

  let electronApp = null
  let page = null
  let traceStarted = false
  let succeeded = false

  try {
    await prepareBuild({ skipBuild, root, log })

    const appPath = electronBundlePath(root)
    const executablePath = electronAppExecutablePath(appPath)
    const cliPath = openForgeCliBridgePath(appPath)
    await assertExists(executablePath, 'Packaged Electron executable')
    await assertExists(cliPath, 'Bundled OpenForge CLI bridge')

    const env = smokeLaunchEnv({ env: process.env, port, userDataDir, appDataDir })
    log(`[electron] launching ${executablePath}`)
    electronApp = await launchElectron({
      executablePath,
      cwd: root,
      env,
      timeout: DEFAULT_TIMEOUT_MS,
      artifactsDir: absoluteArtifactsDir,
      recordVideo: { dir: videosDir },
      tracesDir,
    })

    electronApp.on('console', async message => {
      const values = []
      for (const arg of message.args()) {
        values.push(await arg.jsonValue().catch(() => arg.toString()))
      }
      log(`[main:${message.type()}] ${values.join(' ')}`)
    })

    const child = electronApp.process()
    child.stdout?.on('data', chunk => log(`[stdout] ${chunk.toString().trimEnd()}`))
    child.stderr?.on('data', chunk => log(`[stderr] ${chunk.toString().trimEnd()}`))

    await electronApp.context().tracing.start({ screenshots: true, snapshots: true })
    traceStarted = true

    page = await electronApp.firstWindow({ timeout: DEFAULT_TIMEOUT_MS })
    page.on('console', message => log(`[renderer:${message.type()}] ${message.text()}`))
    page.on('pageerror', error => log(`[renderer:error] ${error.message}`))

    await page.waitForLoadState('domcontentloaded', { timeout: DEFAULT_TIMEOUT_MS })
    const ready = await page.waitForFunction(() => {
      return document.readyState !== 'loading' && document.body && document.body.children.length > 0
    }, undefined, { timeout: DEFAULT_TIMEOUT_MS })
    await ready.dispose()

    const rendererState = await page.evaluate(() => ({
      readyState: document.readyState,
      title: document.title,
      href: location.href,
      bodyChildCount: document.body.children.length,
    }))
    log(`[renderer] ready ${JSON.stringify(rendererState)}`)

    const projects = await runCliBridgeListProjects({ cliPath, env, log })
    log(`[cli] list-projects returned ${projects.length} projects`)

    await electronApp.context().tracing.stop()
    traceStarted = false
    succeeded = true
    log('[electron] closing app')
    await electronApp.close()
    electronApp = null
    succeeded = true
    return { rendererState, projectCount: projects.length, artifactsDir: absoluteArtifactsDir }
  } catch (error) {
    log(`[failure] ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
    await writeFailureArtifacts({ artifactsDir: absoluteArtifactsDir, logs, page, electronApp, traceStarted })
    throw error
  } finally {
    if (electronApp) {
      await electronApp.close().catch(error => log(`[electron] close failed: ${error instanceof Error ? error.message : String(error)}`))
    }
    if (!succeeded) {
      await mkdir(absoluteArtifactsDir, { recursive: true })
      await writeFile(join(absoluteArtifactsDir, 'electron.log'), `${logs.join('\n')}\n`)
    }
    await rm(tempRoot, { recursive: true, force: true }).catch(() => undefined)
  }
}

async function main() {
  const options = parseSmokeArgs()
  const result = await runElectronSmokeTest(options)
  console.log(`Electron smoke passed: renderer=${result.rendererState.readyState}, projects=${result.projectCount}`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error))
    process.exit(1)
  })
}
