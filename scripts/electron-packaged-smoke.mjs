#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:net'
import { chromium } from 'playwright'
import { APP_NAME, electronBundlePath } from './electron-package.mjs'

export const DEFAULT_SMOKE_TIMEOUT_MS = 45_000
export const DEFAULT_INVOKE_TIMEOUT_MS = 20_000

function repoRootFromScript() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

function sleep(ms) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, ms))
}

async function pathExists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function waitForExit(child, label) {
  return new Promise((resolvePromise, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new Error(`${label} exited with ${signal ?? `code ${code}`}`))
    })
  })
}

async function runCommand(command, args, options = {}) {
  await waitForExit(spawn(command, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  }), `${command} ${args.join(' ')}`)
}

export function createPackagedSmokeEnv({ baseEnv = process.env, runtimeRoot, backendPort } = {}) {
  if (!runtimeRoot) throw new Error('runtimeRoot is required for packaged smoke env isolation')
  if (!backendPort) throw new Error('backendPort is required for packaged smoke port isolation')
  return {
    ...baseEnv,
    OPENFORGE_APP_DATA_DIR: join(runtimeRoot, 'app-data'),
    OPENFORGE_BACKEND_PORT: String(backendPort),
    OPENFORGE_ELECTRON_USER_DATA_DIR: join(runtimeRoot, 'electron-user-data'),
    ELECTRON_ENABLE_LOGGING: '1',
  }
}

export function packagedAppExecutablePath(appPath, platform = process.platform) {
  if (platform === 'darwin' && appPath.endsWith('.app')) {
    return join(appPath, 'Contents', 'MacOS', APP_NAME)
  }
  return appPath
}

export function formatHealthFailure(result) {
  const rendererUrl = result.url ? `\nRenderer URL: ${result.url}` : ''
  const details = result.message ? `\nDetail: ${result.message}` : ''

  if (result.step === 'preload-exposure') {
    return `Packaged Electron preload did not expose window.openforge. This is the PR #1213 guardrail: the sandbox preload bundle must be self-contained and must not depend on resolving sibling modules at runtime.${rendererUrl}${details}`
  }

  if (result.step === 'invoke-shape') {
    return `Packaged Electron preload exposed window.openforge without an invoke function; renderer backend calls cannot work.${rendererUrl}${details}`
  }

  if (result.step === 'backend-invoke') {
    const bridgeHint = result.bridgeUnavailable
      ? '\nThe error resembles a bridge-unavailable failure, so verify the packaged sandbox preload and contextBridge exposure.'
      : ''
    return `window.openforge.invoke('get_projects') failed in the packaged Electron runtime after the preload bridge was present.${rendererUrl}${details}${bridgeHint}`
  }

  return `Packaged Electron smoke failed during ${result.step ?? 'unknown step'}.${rendererUrl}${details}`
}

export function assertHealthyBridge(result) {
  if (result?.ok === true) return result
  throw new Error(formatHealthFailure(result ?? { ok: false, step: 'unknown', message: 'No health result returned' }))
}

async function allocatePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  const port = typeof address === 'object' && address ? address.port : null
  await new Promise((resolvePromise, reject) => server.close(error => error ? reject(error) : resolvePromise()))
  if (!port) throw new Error('Unable to allocate a DevTools port for packaged Electron smoke')
  return port
}

function captureChildOutput(child, maxBytes = 20_000) {
  const chunks = []
  let total = 0

  function append(prefix, chunk) {
    const text = `${prefix}${chunk.toString()}`
    chunks.push(text)
    total += Buffer.byteLength(text)
    while (total > maxBytes && chunks.length > 1) {
      total -= Buffer.byteLength(chunks.shift())
    }
  }

  child.stdout?.on('data', chunk => append('[stdout] ', chunk))
  child.stderr?.on('data', chunk => append('[stderr] ', chunk))

  return () => chunks.join('')
}

async function waitForDevTools(port, childState, output, timeoutMs) {
  const endpoint = `http://127.0.0.1:${port}`
  const deadline = Date.now() + timeoutMs
  let lastError = null

  while (Date.now() < deadline) {
    if (childState.error) {
      throw new Error(`Packaged Electron app failed to launch: ${childState.error.message}.\n${output()}`)
    }

    if (childState.exited) {
      throw new Error(`Packaged Electron app exited before DevTools became available (${childState.signal ?? `code ${childState.code}`}).\n${output()}`)
    }

    try {
      const response = await fetch(`${endpoint}/json/version`)
      if (response.ok) return endpoint
      lastError = new Error(`DevTools returned HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }

    await sleep(250)
  }

  throw new Error(`Timed out waiting for packaged Electron DevTools at ${endpoint}.${lastError ? ` Last error: ${lastError.message}` : ''}\n${output()}`)
}

async function waitForRendererPage(browser, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let blankPage = null

  while (Date.now() < deadline) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (candidate.url().startsWith('devtools://')) continue
        if (candidate.url() !== 'about:blank') return candidate
        blankPage ??= candidate
      }
    }
    await sleep(250)
  }

  if (blankPage) return blankPage
  throw new Error('Timed out waiting for packaged Electron renderer page to appear in DevTools')
}

export async function checkRendererBridge(page, { invokeTimeoutMs = DEFAULT_INVOKE_TIMEOUT_MS } = {}) {
  await page.waitForLoadState('domcontentloaded', { timeout: invokeTimeoutMs }).catch(() => {})
  await page.waitForFunction(() => window.location.href !== 'about:blank', null, { timeout: Math.min(invokeTimeoutMs, 10_000) }).catch(() => {})

  return page.evaluate(async ({ invokeTimeoutMs }) => {
    const bridge = window.openforge
    const url = window.location.href
    if (typeof bridge !== 'object' || bridge === null) {
      return {
        ok: false,
        step: 'preload-exposure',
        message: `window.openforge is ${bridge === null ? 'null' : typeof bridge}`,
        bridgeUnavailable: true,
        url,
      }
    }

    if (typeof bridge.invoke !== 'function') {
      return {
        ok: false,
        step: 'invoke-shape',
        message: `window.openforge.invoke is ${typeof bridge.invoke}`,
        bridgeUnavailable: true,
        url,
      }
    }

    try {
      const timeout = new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error(`get_projects timed out after ${invokeTimeoutMs}ms`)), invokeTimeoutMs)
      })
      const projects = await Promise.race([bridge.invoke('get_projects'), timeout])
      return {
        ok: true,
        step: 'backend-invoke',
        url,
        projectCount: Array.isArray(projects) ? projects.length : null,
        resultType: Array.isArray(projects) ? 'array' : typeof projects,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        ok: false,
        step: 'backend-invoke',
        message,
        bridgeUnavailable: /desktop bridge is unavailable|window\.openforge|openforge.*unavailable|Cannot read properties.*openforge|undefined/i.test(message),
        url,
      }
    }
  }, { invokeTimeoutMs })
}

async function stopChild(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return

  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise))
  child.kill('SIGTERM')
  const stopped = await Promise.race([
    exited.then(() => true),
    sleep(timeoutMs).then(() => false),
  ])
  if (!stopped && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
    await Promise.race([exited, sleep(2_000)])
  }
}

async function closeElectronGracefully(browser, child, timeoutMs = 7_000) {
  if (!browser || child.exitCode !== null || child.signalCode !== null) return

  const exited = new Promise(resolvePromise => child.once('exit', resolvePromise))
  try {
    const session = await browser.newBrowserCDPSession()
    await session.send('Browser.close')
  } catch {
    return
  }

  await Promise.race([
    exited,
    sleep(timeoutMs),
  ])
}

export async function runPackagedElectronSmoke({
  repoRoot = repoRootFromScript(),
  appPath = electronBundlePath(repoRoot),
  packageBeforeLaunch = true,
  timeoutMs = DEFAULT_SMOKE_TIMEOUT_MS,
  invokeTimeoutMs = DEFAULT_INVOKE_TIMEOUT_MS,
  debugPort = null,
  keepRuntimeDirs = false,
} = {}) {
  if (packageBeforeLaunch) {
    await runCommand('pnpm', ['electron:package'], { cwd: repoRoot })
  }

  if (!(await pathExists(appPath))) {
    throw new Error(`Packaged Electron app not found at ${appPath}. Run pnpm electron:package first or omit --skip-package.`)
  }

  const executablePath = packagedAppExecutablePath(appPath)
  if (!(await pathExists(executablePath))) {
    throw new Error(`Packaged Electron executable not found at ${executablePath}`)
  }

  const runtimeRoot = await mkdtemp(join(tmpdir(), 'openforge-packaged-smoke-'))
  const port = debugPort ?? await allocatePort()
  const backendPort = await allocatePort()
  const env = createPackagedSmokeEnv({ runtimeRoot, backendPort })
  const childState = { exited: false, code: null, signal: null, error: null }
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
  ], {
    cwd: repoRoot,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = captureChildOutput(child)
  child.once('error', error => {
    childState.error = error
    childState.exited = true
  })
  child.once('exit', (code, signal) => {
    childState.exited = true
    childState.code = code
    childState.signal = signal
  })

  let browser = null
  try {
    const cdpEndpoint = await waitForDevTools(port, childState, output, timeoutMs)
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs })
    const page = await waitForRendererPage(browser, timeoutMs)
    const result = assertHealthyBridge(await checkRendererBridge(page, { invokeTimeoutMs }))
    console.log(`Packaged Electron smoke passed: window.openforge.invoke('get_projects') returned ${result.resultType}${typeof result.projectCount === 'number' ? ` (${result.projectCount} projects)` : ''}.`)
    return {
      appPath,
      executablePath,
      runtimeRoot,
      debugPort: port,
      health: result,
    }
  } catch (error) {
    const detail = output()
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(detail ? `${message}\n\nPackaged app output:\n${detail}` : message)
  } finally {
    await closeElectronGracefully(browser, child)
    await browser?.close().catch(() => {})
    await stopChild(child)
    if (!keepRuntimeDirs) {
      await rm(runtimeRoot, { recursive: true, force: true })
    } else {
      console.log(`Keeping packaged smoke runtime dirs at ${runtimeRoot}`)
    }
  }
}

function parseArgs(argv) {
  const options = {
    repoRoot: repoRootFromScript(),
    appPath: null,
    packageBeforeLaunch: true,
    timeoutMs: DEFAULT_SMOKE_TIMEOUT_MS,
    invokeTimeoutMs: DEFAULT_INVOKE_TIMEOUT_MS,
    debugPort: null,
    keepRuntimeDirs: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--skip-package') {
      options.packageBeforeLaunch = false
    } else if (arg === '--keep-runtime-dirs') {
      options.keepRuntimeDirs = true
    } else if (arg === '--app') {
      options.appPath = resolve(argv[++index])
    } else if (arg === '--timeout-ms') {
      options.timeoutMs = Number(argv[++index])
    } else if (arg === '--invoke-timeout-ms') {
      options.invokeTimeoutMs = Number(argv[++index])
    } else if (arg === '--debug-port') {
      options.debugPort = Number(argv[++index])
    } else {
      throw new Error(`Unknown argument: ${arg}`)
    }
  }

  for (const [name, value] of [
    ['--timeout-ms', options.timeoutMs],
    ['--invoke-timeout-ms', options.invokeTimeoutMs],
  ]) {
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`${name} must be a positive integer`)
    }
  }

  if (options.debugPort !== null && (!Number.isInteger(options.debugPort) || options.debugPort <= 0 || options.debugPort > 65_535)) {
    throw new Error('--debug-port must be a positive integer port')
  }

  if (!options.appPath) options.appPath = electronBundlePath(options.repoRoot)
  return options
}

async function main() {
  await runPackagedElectronSmoke(parseArgs(process.argv.slice(2)))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
