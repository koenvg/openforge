#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { rm as rmPath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from 'node:net'
import { DEFAULT_DEV_BACKEND_PORT, buildElectronSidecarDevEnv, parsePort } from './cargo-target-env.mjs'
import { OPENFORGE_APP_DATA_IDENTIFIER, databaseFilenameForBuildMode } from './data-identity.mjs'
import { captureChildOutput, stopProcess } from './electron-process.mjs'
export { stopProcess } from './electron-process.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'
import { ensureDevPluginArtifacts as defaultEnsureDevPluginArtifacts } from './build-dev-plugin-artifacts.mjs'
import { prepareGhosttyVt as defaultPrepareGhosttyVt } from './prepare-ghostty-vt.mjs'

export const DEFAULT_VITE_PORT = 1420
export const ELECTRON_DEV_SEED_APP_DATA_DIR_ENV = 'OPENFORGE_ELECTRON_DEV_SEED_APP_DATA_DIR'
export const ELECTRON_DEV_SEED_DB_PATH_ENV = 'OPENFORGE_ELECTRON_DEV_SEED_DB_PATH'
export const ELECTRON_DEV_DISABLE_AUTO_SEED_ENV = 'OPENFORGE_ELECTRON_DEV_DISABLE_AUTO_SEED'
export const ELECTRON_DEV_WORKTREE_STATE_DIR = '.openforge-dev'
export const ELECTRON_DEV_WORKTREE_STATE_FILE = 'electron-dev-runtime.json'
const VITE_READY_TIMEOUT_MS = 30_000
const VITE_READY_INTERVAL_MS = 250
const VITE_HOST = '127.0.0.1'
const VITE_PORT = DEFAULT_VITE_PORT
export const ELECTRON_RENDERER_URL = rendererUrlForPort(VITE_PORT)
const BACKEND_PORT_PROBE_LIMIT = 50

function logStep(message) {
  console.log(`[electron-dev] ${message}`)
}

function createScriptFailureReport({ phase, severity, cause, userMessage, remediation, decision }) {
  const causeMessage = cause instanceof Error ? cause.message : String(cause)
  return {
    phase,
    severity,
    cause: { message: causeMessage },
    userMessage,
    remediation,
    decision,
    occurredAt: new Date().toISOString(),
  }
}

async function reportScriptFailure(failureReporter, input) {
  const report = createScriptFailureReport(input)
  if (failureReporter?.reportFailure) {
    await failureReporter.reportFailure(report)
  } else {
    const writer = report.severity === 'warning' ? console.warn : console.error
    writer(`[electron:failure] ${report.severity} ${report.phase}: ${report.userMessage}`)
    writer(`Cause: ${report.cause.message}`)
    writer(`Remediation: ${report.remediation}`)
    writer(`Decision: ${report.decision}`)
  }
  return report.decision
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..')
}

export function rendererUrlForPort(port, host = VITE_HOST) {
  return `http://${host}:${port}`
}

function nonEmptyEnv(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value : null
}

function runtimeDeps(deps = {}) {
  return {
    mkdtempSync,
    tmpdir,
    homedir,
    platform: process.platform,
    repoRoot,
    existsSync,
    copyFileSync,
    mkdirSync,
    readFileSync,
    rmSync,
    writeFileSync,
    ...deps,
  }
}

function worktreeDevRuntimePaths(deps) {
  const stateDir = join(deps.repoRoot(), ELECTRON_DEV_WORKTREE_STATE_DIR)
  return {
    stateDir,
    statePath: join(stateDir, ELECTRON_DEV_WORKTREE_STATE_FILE),
    defaultAppDataDir: join(stateDir, 'sidecar-app-data'),
  }
}

function readWorktreeDevRuntimeState(paths, deps) {
  if (!deps.existsSync(paths.statePath)) return null

  try {
    const parsed = JSON.parse(deps.readFileSync(paths.statePath, 'utf8'))
    return typeof parsed?.appDataDir === 'string' && parsed.appDataDir.trim() !== ''
      ? { appDataDir: parsed.appDataDir }
      : null
  } catch {
    return null
  }
}

function resolveWorktreeAppDataDir(deps) {
  const paths = worktreeDevRuntimePaths(deps)
  const stored = readWorktreeDevRuntimeState(paths, deps)
  const appDataDir = stored?.appDataDir ?? paths.defaultAppDataDir

  deps.mkdirSync(paths.stateDir, { recursive: true })
  deps.mkdirSync(appDataDir, { recursive: true })

  if (stored?.appDataDir !== appDataDir) {
    deps.writeFileSync(paths.statePath, `${JSON.stringify({ appDataDir }, null, 2)}\n`)
  }

  return { appDataDir, statePath: paths.statePath }
}

function resolveSeedDatabaseFromAppDataDir(appDataDir, deps) {
  const debugDbPath = join(appDataDir, databaseFilenameForBuildMode('debug'))
  if (deps.existsSync(debugDbPath)) {
    return { sourceDbPath: debugDbPath, sourceBuildMode: 'debug', sourceKind: 'explicit-app-data-dir' }
  }

  throw new Error(`${ELECTRON_DEV_SEED_APP_DATA_DIR_ENV} is set to ${appDataDir}, but ${databaseFilenameForBuildMode('debug')} does not exist there`)
}

function truthyEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function defaultAppDataDir(env, deps) {
  const home = deps.homedir()
  if (deps.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', OPENFORGE_APP_DATA_IDENTIFIER)
  }

  if (deps.platform === 'win32') {
    return join(nonEmptyEnv(env.APPDATA) ?? join(home, 'AppData', 'Roaming'), OPENFORGE_APP_DATA_IDENTIFIER)
  }

  return join(nonEmptyEnv(env.XDG_DATA_HOME) ?? join(home, '.local', 'share'), OPENFORGE_APP_DATA_IDENTIFIER)
}

function resolveAutoSeedDatabase(env, deps) {
  if (truthyEnv(env[ELECTRON_DEV_DISABLE_AUTO_SEED_ENV])) return null

  const appDataDir = defaultAppDataDir(env, deps)
  const debugDbPath = join(appDataDir, databaseFilenameForBuildMode('debug'))
  if (!deps.existsSync(debugDbPath)) return null

  return {
    sourceDbPath: debugDbPath,
    sourceBuildMode: 'debug',
    sourceKind: 'auto-default-app-data',
  }
}

function hasExplicitSeedEnv(env) {
  return nonEmptyEnv(env[ELECTRON_DEV_SEED_DB_PATH_ENV]) !== null || nonEmptyEnv(env[ELECTRON_DEV_SEED_APP_DATA_DIR_ENV]) !== null
}

function resolveSeedDatabase(env, deps) {
  const explicitSeedDbPath = nonEmptyEnv(env[ELECTRON_DEV_SEED_DB_PATH_ENV])
  if (explicitSeedDbPath) {
    const debugDatabaseFilename = databaseFilenameForBuildMode('debug')
    if (basename(explicitSeedDbPath) !== debugDatabaseFilename) {
      throw new Error(`${ELECTRON_DEV_SEED_DB_PATH_ENV} must point to ${debugDatabaseFilename}; production databases are never copied into Electron dev runs`)
    }
    if (!deps.existsSync(explicitSeedDbPath)) {
      throw new Error(`${ELECTRON_DEV_SEED_DB_PATH_ENV} is set to ${explicitSeedDbPath}, but that database file does not exist`)
    }
    return { sourceDbPath: explicitSeedDbPath, sourceBuildMode: 'debug', sourceKind: 'explicit-db-path' }
  }

  const seedAppDataDir = nonEmptyEnv(env[ELECTRON_DEV_SEED_APP_DATA_DIR_ENV])
  if (seedAppDataDir) return resolveSeedDatabaseFromAppDataDir(seedAppDataDir, deps)

  return resolveAutoSeedDatabase(env, deps)
}

function copySqliteCompanionFiles(sourceDbPath, targetDbPath, deps) {
  return ['-wal', '-shm'].flatMap((suffix) => {
    const sourcePath = `${sourceDbPath}${suffix}`
    if (!deps.existsSync(sourcePath)) return []

    const targetPath = `${targetDbPath}${suffix}`
    deps.copyFileSync(sourcePath, targetPath)
    return [{ sourcePath, targetPath }]
  })
}

function seedElectronDevAppData(env, appDataDir, deps) {
  const targetDbPath = join(appDataDir, databaseFilenameForBuildMode('debug'))
  const targetExists = deps.existsSync(targetDbPath)
  const seed = resolveSeedDatabase(env, deps)

  if (targetExists) {
    if (hasExplicitSeedEnv(env)) {
      throw new Error(`Worktree dev database already exists at ${targetDbPath}; delete .openforge-dev/ before reseeding from explicit seed settings`)
    }
    return null
  }

  if (seed === null) return null

  deps.copyFileSync(seed.sourceDbPath, targetDbPath)
  const copiedCompanionFiles = copySqliteCompanionFiles(seed.sourceDbPath, targetDbPath, deps)

  return {
    ...seed,
    targetDbPath,
    copiedCompanionFiles,
  }
}

function cleanupCreatedRuntimeDirsOnError(tempRuntimeDirs, deps) {
  for (const runtimeDir of tempRuntimeDirs) {
    try {
      deps.rmSync(runtimeDir, { recursive: true, force: true })
    } catch {
      // Preserve the original seed failure; best-effort temp cleanup should not hide it.
    }
  }
}

export function resolveElectronDevRuntimeOptions(env = process.env, deps = {}) {
  const resolvedDeps = runtimeDeps(deps)
  const rendererPort = parsePort(env.OPENFORGE_ELECTRON_RENDERER_PORT ?? env.VITE_PORT ?? String(VITE_PORT), 'OPENFORGE_ELECTRON_RENDERER_PORT')
  const electronDebugPort = nonEmptyEnv(env.OPENFORGE_ELECTRON_DEBUG_PORT) === null
    ? null
    : parsePort(env.OPENFORGE_ELECTRON_DEBUG_PORT, 'OPENFORGE_ELECTRON_DEBUG_PORT')
  const tempRoot = resolvedDeps.tmpdir()
  const tempRuntimeDirs = []
  const explicitUserDataDir = nonEmptyEnv(env.OPENFORGE_ELECTRON_USER_DATA_DIR)
  const explicitAppDataDir = nonEmptyEnv(env.OPENFORGE_APP_DATA_DIR)
  const worktreeAppData = explicitAppDataDir ? null : resolveWorktreeAppDataDir(resolvedDeps)
  const userDataDir = explicitUserDataDir ?? resolvedDeps.mkdtempSync(join(tempRoot, 'openforge-electron-user-data-'))
  const appDataDir = explicitAppDataDir ?? worktreeAppData.appDataDir

  if (!explicitUserDataDir) tempRuntimeDirs.push(userDataDir)

  let seededAppData = null
  try {
    seededAppData = explicitAppDataDir
      ? null
      : seedElectronDevAppData(env, appDataDir, resolvedDeps)
  } catch (error) {
    cleanupCreatedRuntimeDirsOnError(tempRuntimeDirs, resolvedDeps)
    throw error
  }

  return {
    rendererPort,
    rendererUrl: rendererUrlForPort(rendererPort),
    electronDebugPort,
    userDataDir,
    appDataDir,
    tempRuntimeDirs,
    seededAppData,
  }
}

export function buildElectronDebugArgs(runtimeOptions) {
  return runtimeOptions.electronDebugPort === null
    ? []
    : [`--inspect=127.0.0.1:${runtimeOptions.electronDebugPort}`]
}

export function buildElectronLaunchArgs(runtimeOptions, options = {}) {
  const chromiumArgs = options.chromiumDebugPort == null
    ? []
    : [
        '--remote-debugging-address=127.0.0.1',
        `--remote-debugging-port=${options.chromiumDebugPort}`,
      ]

  return [
    ...buildElectronDebugArgs(runtimeOptions),
    ...chromiumArgs,
    ...(options.extraArgs ?? []),
  ]
}

export function isPortOpen(host = VITE_HOST, port = VITE_PORT, timeoutMs = 500) {
  return new Promise((resolvePromise) => {
    const socket = connect({ host, port })
    const finish = (open) => {
      socket.destroy()
      resolvePromise(open)
    }

    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

export async function prepareElectronDevArtifacts(deps = {}) {
  const ensureDevPluginArtifacts = deps.ensureDevPluginArtifacts ?? defaultEnsureDevPluginArtifacts
  await ensureDevPluginArtifacts()
}

export async function prepareElectronDevCargoEnv(cargoEnv, deps = {}) {
  const prepareGhosttyVt = deps.prepareGhosttyVt ?? defaultPrepareGhosttyVt
  const logger = deps.logger ?? (message => logStep(message))
  const ghosttyEnv = await prepareGhosttyVt({ logger })
  return { ...cargoEnv, ...ghosttyEnv }
}

export async function assertVitePortAvailable(portOrDeps = VITE_PORT, deps = { isPortOpen }) {
  const port = typeof portOrDeps === 'number' ? portOrDeps : VITE_PORT
  const portDeps = typeof portOrDeps === 'number' ? deps : portOrDeps
  if (await portDeps.isPortOpen(VITE_HOST, port)) {
    const message = `Port ${port} is already in use. Stop the existing dev server before running pnpm electron:dev so Electron does not attach to an untrusted renderer.`
    await reportScriptFailure(portDeps.failureReporter, {
      phase: 'dev:port-check',
      severity: 'error',
      cause: message,
      userMessage: 'A required development port is already in use.',
      remediation: 'Stop the conflicting process or choose a free port before launching Electron dev mode.',
      decision: 'quit',
    })
    throw new Error(message)
  }
}

export async function assertBackendPortAvailable(port = Number(process.env.OPENFORGE_BACKEND_PORT ?? DEFAULT_DEV_BACKEND_PORT), deps = { isPortOpen }) {
  if (await deps.isPortOpen(VITE_HOST, port)) {
    const message = `Port ${port} is already in use. Stop the existing OpenForge sidecar/Electron process before running pnpm electron:dev, or set OPENFORGE_BACKEND_PORT to a free port.`
    await reportScriptFailure(deps.failureReporter, {
      phase: 'dev:port-check',
      severity: 'error',
      cause: message,
      userMessage: 'A required development port is already in use.',
      remediation: 'Stop the conflicting OpenForge sidecar/Electron process or set OPENFORGE_BACKEND_PORT to a free port.',
      decision: 'quit',
    })
    throw new Error(message)
  }
}

export async function assertElectronDebugPortAvailable(port, deps = { isPortOpen }) {
  if (port === null) return
  if (await deps.isPortOpen(VITE_HOST, port)) {
    const message = `Electron debug port ${port} is already in use. Stop the existing debugger target or set OPENFORGE_ELECTRON_DEBUG_PORT to a free port.`
    await reportScriptFailure(deps.failureReporter, {
      phase: 'dev:port-check',
      severity: 'error',
      cause: message,
      userMessage: 'A required development port is already in use.',
      remediation: 'Stop the existing debugger target or set OPENFORGE_ELECTRON_DEBUG_PORT to a free port.',
      decision: 'quit',
    })
    throw new Error(message)
  }
}

export async function assertChromiumDebugPortAvailable(port, deps = { isPortOpen }) {
  if (port == null) return
  if (await deps.isPortOpen(VITE_HOST, port)) {
    const message = `Electron Chromium debug port ${port} is already in use.`
    await reportScriptFailure(deps.failureReporter, {
      phase: 'dev:port-check',
      severity: 'error',
      cause: message,
      userMessage: 'A required development port is already in use.',
      remediation: 'Stop the existing Chromium debugger target or choose a free port.',
      decision: 'quit',
    })
    throw new Error(message)
  }
}

async function findAvailableBackendPort(startPort, deps = { isPortOpen }) {
  for (let offset = 0; offset < BACKEND_PORT_PROBE_LIMIT; offset += 1) {
    const port = startPort + offset
    if (!await deps.isPortOpen(VITE_HOST, port)) return port
  }

  throw new Error(`No free OpenForge backend port found from ${startPort} through ${startPort + BACKEND_PORT_PROBE_LIMIT - 1}. Set OPENFORGE_BACKEND_PORT to a free port.`)
}

export async function resolveElectronDevBackendEnv(options = {}, deps = { isPortOpen }) {
  const baseEnv = options.env ?? process.env
  const result = buildElectronSidecarDevEnv({ ...options, env: baseEnv })
  const backendPort = parsePort(result.env.OPENFORGE_BACKEND_PORT, 'OPENFORGE_BACKEND_PORT')

  const defaultDevBackendPort = String(DEFAULT_DEV_BACKEND_PORT)
  const hasExplicitBackendPort = result.env.OPENFORGE_BACKEND_PORT !== defaultDevBackendPort
  if (hasExplicitBackendPort) {
    await assertBackendPortAvailable(backendPort, deps)
    return result
  }

  const selectedPort = await findAvailableBackendPort(backendPort, deps)
  if (selectedPort === backendPort) return result

  const selectedPortString = String(selectedPort)
  return {
    ...result,
    env: {
      ...result.env,
      OPENFORGE_BACKEND_PORT: selectedPortString,
      OPENFORGE_HTTP_PORT: result.env.OPENFORGE_HTTP_PORT !== defaultDevBackendPort
        ? result.env.OPENFORGE_HTTP_PORT
        : selectedPortString,
    },
  }
}

export function electronSidecarPath(cargoTargetDir, rustSidecarLayout = resolveRustSidecarLayout({ repoRoot: repoRoot() })) {
  return rustSidecarLayout.debugSidecarBinaryPath({ cargoTargetDir })
}

export function buildElectronDevEnv(baseEnv = process.env, sidecarPath = baseEnv.OPENFORGE_SIDECAR_PATH, runtimeOptions = {}) {
  const env = {
    ...baseEnv,
    ELECTRON_RENDERER_URL: runtimeOptions.rendererUrl ?? ELECTRON_RENDERER_URL,
  }

  if (runtimeOptions.userDataDir) {
    env.OPENFORGE_ELECTRON_USER_DATA_DIR = runtimeOptions.userDataDir
  }

  if (runtimeOptions.appDataDir) {
    env.OPENFORGE_APP_DATA_DIR = runtimeOptions.appDataDir
  }

  if (sidecarPath) {
    env.OPENFORGE_SIDECAR_PATH = sidecarPath
    env.OPENFORGE_ELECTRON_SIDECAR = '1'
    delete env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR
  } else {
    env.OPENFORGE_ELECTRON_DEV_DISABLE_SIDECAR = '1'
  }

  return env
}

function spawnCommand(command, args, options = {}) {
  const detached = options.detached ?? process.platform !== 'win32'
  const child = spawn(command, args, {
    cwd: repoRoot(),
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
    detached,
  })
  child.openforgeDetached = detached
  return child
}

function waitForExit(child, label) {
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

export async function waitForVite(url = ELECTRON_RENDERER_URL, viteProcess = null) {
  const startedAt = Date.now()
  let lastError = null
  let viteExit = null
  const onExit = (code, signal) => {
    viteExit = signal ?? `code ${code}`
  }
  viteProcess?.once('exit', onExit)

  try {
    while (Date.now() - startedAt < VITE_READY_TIMEOUT_MS) {
      if (viteExit !== null) {
        throw new Error(`Vite dev server exited before becoming ready (${viteExit})`)
      }

      try {
        const response = await fetch(url)
        if (response.ok) return
        lastError = new Error(`HTTP ${response.status}`)
      } catch (error) {
        lastError = error
      }

      await new Promise(resolvePromise => setTimeout(resolvePromise, VITE_READY_INTERVAL_MS))
    }
  } finally {
    viteProcess?.off?.('exit', onExit)
  }

  const message = lastError instanceof Error ? lastError.message : String(lastError ?? 'timeout')
  throw new Error(`Vite dev server did not become ready at ${url}: ${message}`)
}

async function cleanupRuntimeDirs(runtimeOptions = {}, options = {}) {
  const tempRuntimeDirs = runtimeOptions.tempRuntimeDirs ?? []
  const removeDir = options.rm ?? rmPath
  const logger = options.logger ?? console

  return Promise.all(tempRuntimeDirs.map(async (runtimeDir) => {
    try {
      await removeDir(runtimeDir, { recursive: true, force: true })
      return 'removed'
    } catch (error) {
      logger.warn?.(`[electron-dev] Failed to remove temp runtime directory ${runtimeDir}: ${error instanceof Error ? error.message : String(error)}`)
      return 'failed'
    }
  }))
}

export async function cleanupDevProcesses(children, options = {}) {
  const stopTasks = [children.vite, children.electron]
    .filter(Boolean)
    .map(child => stopProcess(child, options))

  const processes = await Promise.all(stopTasks)
  const runtimeDirs = await cleanupRuntimeDirs(options.runtimeOptions, options)

  return { processes, runtimeDirs }
}

export class DevScriptCleanupAdapter {
  constructor(children, options = {}) {
    this.name = 'dev-script-cleanup'
    this.children = children
    this.options = options
    this.cleanupPromise = null
  }

  shutdown() {
    this.cleanupPromise ??= cleanupDevProcesses(
      typeof this.children === 'function' ? this.children() : this.children,
      this.options,
    )
    return this.cleanupPromise
  }
}


export function createElectronDevLauncher(options = {}, deps = {}) {
  const configuredRuntimeOptions = options.runtimeOptions ?? (deps.resolveElectronDevRuntimeOptions ?? resolveElectronDevRuntimeOptions)(
    options.env ?? process.env,
    options.runtimeOptionDeps,
  )
  const runtimeOptions = options.desktopTest
    ? {
        ...configuredRuntimeOptions,
        rendererUrl: (() => {
          const rendererUrl = new URL(configuredRuntimeOptions.rendererUrl)
          rendererUrl.searchParams.set('openforge-desktop-test', '1')
          return rendererUrl.toString()
        })(),
      }
    : configuredRuntimeOptions
  const childrenState = { vite: null, electron: null }
  const maxOutputBytes = options.maxOutputBytes ?? 1_000_000
  const outputCaptures = []
  let startPromise = null
  let shutdownPromise = null
  let shutdownRequested = false
  let electronExit = null

  const prepareArtifacts = deps.prepareElectronDevArtifacts ?? prepareElectronDevArtifacts
  const checkVitePort = deps.assertVitePortAvailable ?? assertVitePortAvailable
  const checkElectronDebugPort = deps.assertElectronDebugPortAvailable ?? assertElectronDebugPortAvailable
  const checkChromiumDebugPort = deps.assertChromiumDebugPortAvailable ?? assertChromiumDebugPortAvailable
  const resolveBackendEnv = deps.resolveElectronDevBackendEnv ?? resolveElectronDevBackendEnv
  const prepareCargoEnv = deps.prepareElectronDevCargoEnv ?? prepareElectronDevCargoEnv
  const resolveSidecarLayout = deps.resolveRustSidecarLayout ?? resolveRustSidecarLayout
  const spawnChild = deps.spawnCommand ?? spawnCommand
  const awaitVite = deps.waitForVite ?? waitForVite
  const awaitExit = deps.waitForExit ?? waitForExit
  const cleanup = deps.cleanupDevProcesses ?? cleanupDevProcesses
  const resolveRepoRoot = deps.repoRoot ?? repoRoot
  const log = deps.logger ?? logStep

  const trackOutput = (child) => {
    if (options.captureOutput) {
      outputCaptures.push(captureChildOutput(child, { maxBytes: maxOutputBytes }))
    }
  }
  const assertNotShuttingDown = () => {
    if (shutdownRequested) throw new Error('Electron dev launcher was stopped during startup')
  }

  const shutdown = () => {
    shutdownRequested = true
    shutdownPromise ??= cleanup(childrenState, {
      runtimeOptions,
      ...(options.cleanupOptions ?? {}),
    })
    return shutdownPromise
  }

  const start = () => {
    startPromise ??= (async () => {
      try {
        if (runtimeOptions.seededAppData) {
          log(`Seeded isolated sidecar app data from ${runtimeOptions.seededAppData.sourceDbPath} to ${runtimeOptions.seededAppData.targetDbPath}.`)
        }
        log('Preparing plugin backend artifacts for Electron dev ...')
        await prepareArtifacts()
        assertNotShuttingDown()

        log(`Starting Vite dev server on ${runtimeOptions.rendererUrl} ...`)
        await checkVitePort(runtimeOptions.rendererPort)
        await checkElectronDebugPort(runtimeOptions.electronDebugPort)
        await checkChromiumDebugPort(options.chromiumDebugPort)
        assertNotShuttingDown()

        const rustSidecarLayout = resolveSidecarLayout({ repoRoot: resolveRepoRoot() })
        const { env: baseCargoEnv, cargoTargetDir, source } = await resolveBackendEnv({
          cwd: resolveRepoRoot(),
          env: options.env ?? process.env,
          rustSidecarLayout,
        })
        log('Preparing pinned Ghostty dependencies for the Rust sidecar ...')
        const cargoEnv = await prepareCargoEnv(baseCargoEnv)
        assertNotShuttingDown()

        const childStdio = options.captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
        childrenState.vite = spawnChild(
          'pnpm',
          ['exec', 'vite', '--host', VITE_HOST, '--port', String(runtimeOptions.rendererPort), '--strictPort'],
          { env: baseCargoEnv, stdio: childStdio },
        )
        trackOutput(childrenState.vite, 'vite')
        log('Waiting for Vite readiness ...')
        await awaitVite(runtimeOptions.rendererUrl, childrenState.vite)
        assertNotShuttingDown()

        const sidecarPath = cargoEnv.OPENFORGE_SIDECAR_PATH ?? electronSidecarPath(cargoTargetDir, rustSidecarLayout)
        log(`Vite is ready; building Rust sidecar (${source} target dir: ${cargoTargetDir}) ...`)
        const cargoBuild = spawnChild('cargo', ['build'], {
          cwd: rustSidecarLayout.backendCrateRootPath,
          env: cargoEnv,
          stdio: childStdio,
        })
        trackOutput(cargoBuild, 'cargo')
        await awaitExit(cargoBuild, 'cargo build')
        assertNotShuttingDown()

        log('Building Electron main process ...')
        const electronBuild = spawnChild('pnpm', ['electron:build'], { stdio: childStdio })
        trackOutput(electronBuild, 'electron-build')
        await awaitExit(electronBuild, 'electron:build')
        assertNotShuttingDown()
        await options.beforeElectronLaunch?.({
          cargoEnv,
          runtimeOptions,
          rustSidecarLayout,
          sidecarPath,
        })
        assertNotShuttingDown()

        log('Launching Electron with Rust sidecar. Close the Electron window to stop this command.')
        childrenState.electron = spawnChild(
          'pnpm',
          ['exec', 'electron', ...buildElectronLaunchArgs(runtimeOptions, {
            chromiumDebugPort: options.chromiumDebugPort,
            extraArgs: options.electronArgs,
          }), '.'],
          {
            env: buildElectronDevEnv(cargoEnv, sidecarPath, runtimeOptions),
            stdio: childStdio,
          },
        )
        trackOutput(childrenState.electron, 'electron')
        electronExit = () => awaitExit(childrenState.electron, 'electron')
        return launcher
      } catch (error) {
        await shutdown()
        throw error
      }
    })()
    return startPromise
  }

  const launcher = {
    runtimeOptions,
    start,
    shutdown,
    children: () => ({ ...childrenState }),
    output: () => outputCaptures.map(readOutput => readOutput()).join(''),
    async waitForExit() {
      await start()
      if (!electronExit) throw new Error('Electron did not launch')
      return electronExit()
    },
  }

  return launcher
}

export async function launchElectronDev(options = {}, deps = {}) {
  const launcher = createElectronDevLauncher(options, deps)
  await launcher.start()
  return launcher
}

export function installElectronDevSignalHandlers(launcher, target = process) {
  const handlers = new Map([
    ['SIGINT', () => void launcher.shutdown().finally(() => target.exit(130))],
    ['SIGTERM', () => void launcher.shutdown().finally(() => target.exit(143))],
  ])
  for (const [signal, handler] of handlers) target.once(signal, handler)

  return () => {
    for (const [signal, handler] of handlers) target.off(signal, handler)
  }
}

export async function main() {
  const launcher = createElectronDevLauncher()
  const removeSignalHandlers = installElectronDevSignalHandlers(launcher)
  try {
    await launcher.start()
    await launcher.waitForExit()
    logStep('Electron exited; stopping Vite ...')
  } finally {
    removeSignalHandlers()
    await launcher.shutdown()
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
