#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import {
  allocateLoopbackPort,
  captureChildOutput,
  forceKillProcessTree,
  stopProcess,
  waitForDevTools as waitForDevToolsEndpoint,
  waitForPlaywrightPage,
} from './electron-process.mjs'
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

export function packagedAppSpawnOptions({ repoRoot, env, platform = process.platform } = {}) {
  return {
    cwd: repoRoot,
    env,
    // The packaged sidecar may terminate its inherited process group during shutdown.
    // Isolate the macOS app so that cleanup cannot SIGTERM this smoke runner first.
    detached: platform === 'darwin',
    stdio: ['ignore', 'pipe', 'pipe'],
  }
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

async function waitForPackagedDevTools(port, childState, output, timeoutMs) {
  const endpoint = `http://127.0.0.1:${port}`
  try {
    await waitForDevToolsEndpoint(port, {
      timeoutMs,
      assertRunning() {
        if (childState.error) {
          throw new Error(`Packaged Electron app failed to launch: ${childState.error.message}.`)
        }
        if (childState.exited) {
          throw new Error(`Packaged Electron app exited before DevTools became available (${childState.signal ?? `code ${childState.code}`}).`)
        }
      },
    })
    return endpoint
  } catch (error) {
    throw new Error(`${error instanceof Error ? error.message : String(error)}\n${output()}`)
  }
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

export function forceKillPackagedApp(
  child,
  { platform = process.platform, killProcess = process.kill } = {},
) {
  forceKillProcessTree(child, {
    platform,
    killProcess,
    detached: platform === 'darwin',
  })
}

async function stopChild(child, timeoutMs = 5_000) {
  await stopProcess(child, {
    graceMs: timeoutMs,
    forceKill: forceKillPackagedApp,
    forceWaitMs: 2_000,
  })
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
  const port = debugPort ?? await allocateLoopbackPort()
  const backendPort = await allocateLoopbackPort()
  const env = createPackagedSmokeEnv({ runtimeRoot, backendPort })
  const childState = { exited: false, code: null, signal: null, error: null }
  const child = spawn(executablePath, [
    `--remote-debugging-port=${port}`,
    '--no-first-run',
  ], packagedAppSpawnOptions({ repoRoot, env }))
  const output = captureChildOutput(child, { maxBytes: 20_000 })
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
    const cdpEndpoint = await waitForPackagedDevTools(port, childState, output, timeoutMs)
    browser = await chromium.connectOverCDP(cdpEndpoint, { timeout: timeoutMs })
    const page = await waitForPlaywrightPage(browser, { timeoutMs })
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
