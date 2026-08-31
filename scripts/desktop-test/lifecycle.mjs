import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron, chromium } from 'playwright'
import {
  createElectronDevLauncher,
  createPlaywrightElectronLaunchAdapter,
} from '../electron-dev.mjs'
import {
  allocateLoopbackPort,
  waitForDevTools,
  waitForPlaywrightPage,
} from '../electron-process.mjs'
import { createFixtureRepository, seedFixtureAppData } from './fixture.mjs'
import {
  discoverSidecarForElectron,
  isOpenForgeSidecarCommand,
  readProcessRows,
  readSidecarConnection,
} from './idle-resource-sampler.mjs'

const DEFAULT_TIMEOUT_MS = 30_000

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
}

export function validateReuseEndpoint(value) {
  let endpoint
  try {
    endpoint = new URL(value)
  } catch {
    throw new Error('Reuse endpoint must be a valid URL')
  }
  if (endpoint.protocol !== 'http:') throw new Error('Reuse endpoint must use http')
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)) {
    throw new Error('Reuse endpoint must use a loopback host')
  }
  if (!endpoint.port) throw new Error('Reuse endpoint must include a port')
  if (endpoint.username || endpoint.password) throw new Error('Reuse endpoint must not contain credentials')
  return endpoint.origin
}

export async function probeSidecarEventStream(connection, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${connection.port}/app/events`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok || !response.body) {
    throw new Error(`Sidecar event stream returned HTTP ${response.status}`)
  }
  await response.body.cancel?.().catch(() => {})
  return { available: true, connectedAt: new Date().toISOString() }
}

export async function waitForOwnedSidecarReadiness(options, dependencies = {}) {
  const {
    readProcesses = readProcessRows,
    discoverSidecar = discoverSidecarForElectron,
    readConnection = readSidecarConnection,
    fetchImpl = fetch,
    probeEventStream = (connection) => probeSidecarEventStream(connection, { fetchImpl }),
    nowMs = Date.now,
    sleep = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds)),
  } = dependencies
  const intervalMs = options.intervalMs ?? 100
  const startedAt = nowMs()
  let processIdentity = null
  let connection = null
  let health = null
  let eventStream = null
  let lastReadiness = null
  let lastError = null

  while (nowMs() - startedAt <= options.timeoutMs) {
    try {
      processIdentity ??= discoverSidecar(await readProcesses(), options.electronPid, options.expectedPort ?? null)
      connection ??= await readConnection(processIdentity.pid, processIdentity.command)
      const headers = { Authorization: `Bearer ${connection.token}` }
      if (!health) {
        const healthResponse = await fetchImpl(`http://127.0.0.1:${connection.port}/app/health`, { headers })
        if (!healthResponse.ok) throw new Error(`Sidecar health returned HTTP ${healthResponse.status}`)
        health = await healthResponse.json()
        if (health?.status !== 'ok') throw new Error('Sidecar health did not report status=ok')
      }
      const readinessResponse = await fetchImpl(`http://127.0.0.1:${connection.port}/app/readiness`, { headers })
      if (!readinessResponse.ok) throw new Error(`Sidecar readiness returned HTTP ${readinessResponse.status}`)
      lastReadiness = await readinessResponse.json()
      if (lastReadiness?.status !== 'ok') throw new Error('Sidecar readiness did not report status=ok')
      const phase = lastReadiness.startupResume?.phase ?? 'pending'
      if (phase === 'degraded') {
        const detail = lastReadiness.degraded?.map(item => item.message).filter(Boolean).join('; ') || 'unknown failure'
        throw new Error(`startup resume degraded: ${detail}`)
      }
      if (lastReadiness.events?.available === true && phase === 'complete') {
        eventStream ??= await probeEventStream(connection)
        return {
          process: {
            pid: processIdentity.pid,
            parentPid: processIdentity.parentPid,
            command: processIdentity.command,
          },
          connection: { port: connection.port, token: '[redacted]' },
          health,
          eventStream,
          readiness: lastReadiness,
          startupResumeEventObserved: false,
          durableStartupResumeEvidence: true,
        }
      }
      lastError = null
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('startup resume degraded:')) throw error
      lastError = error
    }
    await sleep(intervalMs)
  }

  if (lastReadiness) {
    throw new Error(`startup readiness timed out after ${options.timeoutMs} ms (last phase: ${lastReadiness.startupResume?.phase ?? 'unknown'})`)
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? 'no Sidecar evidence')
  throw new Error(`startup readiness timed out after ${options.timeoutMs} ms: ${detail}`)
}


export function createDesktopExecutionPolicy(options = {}) {
  if (options.reuseEndpoint) {
    return Object.freeze({
      mode: 'reuse',
      ownsApp: false,
      ownsData: false,
      ownsProcesses: false,
      playwrightAccess: 'cdp',
      terminalControlAuthorized: options.allowTerminalControl === true,
    })
  }
  return Object.freeze({
    mode: 'isolated',
    ownsApp: true,
    ownsData: true,
    ownsProcesses: true,
    playwrightAccess: options.playwrightElectron === true ? 'electron' : 'cdp',
    terminalControlAuthorized: true,
  })
}

function pathsOverlap(left, right) {
  const leftPath = resolve(left)
  const rightPath = resolve(right)
  return leftPath === rightPath
    || leftPath.startsWith(`${rightPath}/`)
    || rightPath.startsWith(`${leftPath}/`)
}

export function assertSafeIsolatedPaths(paths, configured = {}) {
  if (configured.developerAppDataDir && pathsOverlap(paths.appDataDir, configured.developerAppDataDir)) {
    throw new Error('Isolated app data path overlaps configured developer data')
  }
  if (configured.developerDatabasePath && pathsOverlap(paths.databasePath, configured.developerDatabasePath)) {
    throw new Error('Isolated database path overlaps configured developer database')
  }
  const developerPaths = [configured.developerAppDataDir, configured.developerDatabasePath].filter(Boolean)
  for (const [name, runtimePath] of Object.entries(paths)) {
    if (!runtimePath || name === 'appDataDir' || name === 'databasePath') continue
    if (developerPaths.some(developerPath => pathsOverlap(runtimePath, developerPath))) {
      throw new Error(`Isolated ${name} path overlaps configured developer data`)
    }
  }
}

export async function verifyOpenForgeDevelopmentPage(page) {
  const identity = await page.evaluate(() => ({
    bridgeVersion: globalThis.openforge?.version ?? null,
    e2eEnabled: Boolean(globalThis.__openforgeE2e),
    href: globalThis.location?.href ?? '',
  }))
  let rendererUrl
  try {
    rendererUrl = new URL(identity.href)
  } catch {
    throw new Error('Reuse endpoint does not identify an OpenForge development renderer')
  }
  if (identity.bridgeVersion !== 1 || rendererUrl.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(rendererUrl.hostname)) {
    throw new Error('Reuse endpoint does not identify an OpenForge development renderer')
  }
  const redactedHref = identity.href.replace(/([?&]openforge-e2e-token=)[^&#]*/u, '$1[redacted]')
  return { ...identity, href: redactedHref }
}
export function discoverElectronForRemoteDebugging(rows, debugPort) {
  const flag = `--remote-debugging-port=${debugPort}`
  const sidecars = rows.filter(row => isOpenForgeSidecarCommand(row.command))
  const candidates = rows.filter(row => (
    row.command.includes(flag)
    && !row.command.includes('--type=')
    && sidecars.some(sidecar => sidecar.parentPid === row.pid)
  ))
  if (candidates.length !== 1) {
    throw new Error(`Expected one Electron process for remote-debugging port ${debugPort}, found ${candidates.length}`)
  }
  return candidates[0]
}


export function assertTerminalControlAllowed(policy, rendererIdentity) {
  if (policy.mode === 'reuse' && !policy.terminalControlAuthorized) {
    throw new Error('Terminal mutation in reuse mode requires --allow-terminal-control')
  }
  if (!rendererIdentity.rendererE2eEnabled) {
    throw new Error('E2E controls are unavailable in the attached renderer')
  }
}


export function createDesktopTestPaths({ runRoot, artifactRoot }) {
  if (!runRoot) throw new Error('runRoot is required')
  if (!artifactRoot) throw new Error('artifactRoot is required')
  return {
    runRoot,
    appDataDir: join(runRoot, 'app-data'),
    electronUserDataDir: join(runRoot, 'electron-user-data'),
    fixtureManifestPath: join(runRoot, 'fixture.json'),
    repositoryPath: join(runRoot, 'repository'),
    artifactRoot,
    childLogPath: join(artifactRoot, 'children.log'),
    failureScreenshotPath: join(artifactRoot, 'failure.png'),
    reportPath: join(artifactRoot, 'report.json'),
  }
}

export function createDesktopTestLifecycle(options = {}, deps = {}) {
  const policy = createDesktopExecutionPolicy(options)
  const reuseEndpoint = options.reuseEndpoint ? validateReuseEndpoint(options.reuseEndpoint) : null
  const allocatePort = deps.allocateLoopbackPort ?? allocateLoopbackPort
  const createRepository = deps.createFixtureRepository ?? createFixtureRepository
  const seedAppData = deps.seedFixtureAppData ?? seedFixtureAppData
  const createLauncher = deps.createElectronDevLauncher ?? createElectronDevLauncher
  const electronApi = deps.electronApi ?? _electron
  const createElectronAdapter = deps.createPlaywrightElectronLaunchAdapter ?? createPlaywrightElectronLaunchAdapter
  const awaitDevTools = deps.waitForDevTools ?? waitForDevTools
  const connectOverCDP = deps.connectOverCDP ?? ((endpoint, connectOptions) => chromium.connectOverCDP(endpoint, connectOptions))
  const awaitPage = deps.waitForPlaywrightPage ?? waitForPlaywrightPage
  const awaitSidecarReadiness = deps.waitForOwnedSidecarReadiness ?? waitForOwnedSidecarReadiness
  const readProcesses = deps.readProcessRows ?? readProcessRows
  const makeDir = deps.mkdir ?? mkdir
  const makeTempDir = deps.mkdtemp ?? mkdtemp
  const remove = deps.rm ?? rm
  const write = deps.writeFile ?? writeFile
  const resolveRepositoryRoot = deps.repositoryRoot ?? repositoryRoot

  let startPromise = null
  let shutdownPromise = null
  let context = null
  let runRoot = options.runRoot ?? null
  let paths = null
  let launcher = null
  let browser = null
  let page = null

  async function ensurePaths() {
    if (policy.mode === 'reuse') {
      const artifactRoot = options.outputDir
        ? resolve(options.outputDir)
        : join(resolveRepositoryRoot(), 'artifacts', 'desktop-test', 'reuse')
      paths = {
        runRoot: null,
        appDataDir: null,
        electronUserDataDir: null,
        fixtureManifestPath: null,
        repositoryPath: null,
        artifactRoot,
        childLogPath: join(artifactRoot, 'children.log'),
        failureScreenshotPath: join(artifactRoot, 'failure.png'),
        reportPath: join(artifactRoot, 'report.json'),
      }
      await makeDir(paths.artifactRoot, { recursive: true })
      return paths
    }

    runRoot ??= await makeTempDir(join(tmpdir(), 'openforge-desktop-test-'))
    const artifactRoot = options.outputDir
      ? resolve(options.outputDir)
      : join(resolveRepositoryRoot(), 'artifacts', 'desktop-test', basename(runRoot))
    paths = createDesktopTestPaths({ runRoot, artifactRoot })
    assertSafeIsolatedPaths({
      appDataDir: paths.appDataDir,
      databasePath: join(paths.appDataDir, 'openforge_dev.db'),
      electronUserDataDir: paths.electronUserDataDir,
      repositoryPath: paths.repositoryPath,
    }, {
      developerAppDataDir: options.developerAppDataDir ?? process.env.OPENFORGE_APP_DATA_DIR,
      developerDatabasePath: options.developerDatabasePath ?? process.env.OPENFORGE_DATABASE_PATH,
    })
    await Promise.all([
      makeDir(runRoot, { recursive: true }),
      makeDir(paths.artifactRoot, { recursive: true }),
      makeDir(paths.electronUserDataDir, { recursive: true }),
    ])
    return paths
  }

  async function captureDiagnostics() {
    if (!paths) return
    await makeDir(paths.artifactRoot, { recursive: true }).catch(() => {})
    if (page) {
      await page.screenshot({ path: paths.failureScreenshotPath, fullPage: true }).catch(() => {})
    }
    if (launcher) {
      await write(paths.childLogPath, launcher.output()).catch(() => {})
    }
  }

  function shutdown() {
    shutdownPromise ??= (async () => {
      if (browser) await browser.close().catch(() => {})
      if (launcher) await launcher.shutdown().catch(() => {})
      if (paths && launcher) {
        await write(paths.childLogPath, launcher.output()).catch(() => {})
      }
      if (policy.ownsData && runRoot && !options.retainRuntime) {
        await remove(runRoot, { recursive: true, force: true }).catch(() => {})
      }
    })()
    return shutdownPromise
  }

  function start() {
    startPromise ??= (async () => {
      try {
        const resolvedPaths = await ensurePaths()
        if (policy.mode === 'reuse') {
          const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
          browser = await connectOverCDP(reuseEndpoint, { timeout: timeoutMs })
          page = await awaitPage(browser, { timeoutMs })
          const rendererIdentity = await verifyOpenForgeDevelopmentPage(page)
          let readiness = null
          if (options.requireSidecarReadiness) {
            const chromiumDebugPort = Number(new URL(reuseEndpoint).port)
            const electronProcess = Number.isInteger(options.electronPid)
              ? { pid: options.electronPid }
              : discoverElectronForRemoteDebugging(await readProcesses(), chromiumDebugPort)
            readiness = await awaitSidecarReadiness({
              electronPid: electronProcess.pid,
              timeoutMs,
            })
          }
          context = {
            browser,
            electronApplication: null,
            fixture: null,
            launcher: null,
            page,
            paths: resolvedPaths,
            policy,
            readiness,
            ports: { backendPort: null, chromiumDebugPort: Number(new URL(reuseEndpoint).port), rendererPort: null },
            rendererIdentity,
          }
          return context
        }
        const repository = await createRepository({
          runRoot: resolvedPaths.runRoot,
          repoPath: options.repoPath ?? null,
        })
        const [rendererPort, chromiumDebugPort, backendPort] = await Promise.all([
          allocatePort(),
          allocatePort(),
          allocatePort(),
        ])
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
        let fixtureManifest = null
        launcher = createLauncher({
          captureOutput: true,
          electronLaunchAdapter: policy.playwrightAccess === 'electron'
            ? createElectronAdapter(electronApi)
            : undefined,
          chromiumDebugPort,
          desktopTest: true,
          env: {
            ...process.env,
            OPENFORGE_BACKEND_PORT: String(backendPort),
            OPENFORGE_HTTP_PORT: String(backendPort),
          },
          runtimeOptions: {
            rendererPort,
            rendererUrl: `http://127.0.0.1:${rendererPort}`,
            electronDebugPort: null,
            userDataDir: resolvedPaths.electronUserDataDir,
            appDataDir: resolvedPaths.appDataDir,
            tempRuntimeDirs: [],
            seededAppData: null,
          },
          async beforeElectronLaunch({ sidecarPath }) {
            fixtureManifest = await seedAppData({
              sidecarPath,
              appDataDir: resolvedPaths.appDataDir,
              repoPath: repository.repoPath,
              manifestPath: resolvedPaths.fixtureManifestPath,
            })
          },
        })
        await launcher.start()
        if (!fixtureManifest) throw new Error('Desktop test fixture was not seeded before Electron launch')
        let readiness = null
        if (options.requireSidecarReadiness) {
          const electronPid = launcher.children().electron?.pid
          if (!Number.isInteger(electronPid)) throw new Error('Isolated readiness requires the Electron PID')
          readiness = await awaitSidecarReadiness({
            electronPid,
            expectedPort: backendPort,
            timeoutMs,
          })
        }

        if (policy.playwrightAccess === 'electron') {
          page = launcher.page()
          if (!page) throw new Error('Playwright Electron launch did not provide a renderer page')
        } else {
          await awaitDevTools(chromiumDebugPort, {
            timeoutMs,
            assertRunning() {
              const electron = launcher.children().electron
              if (electron?.exitCode != null || electron?.signalCode != null) {
                throw new Error('Electron exited before its DevTools endpoint became ready')
              }
            },
          })
          if (options.connectPlaywright !== false) {
            const cdpEndpoint = `http://127.0.0.1:${chromiumDebugPort}`
            browser = await connectOverCDP(cdpEndpoint, { timeout: timeoutMs })
            page = await awaitPage(browser, { timeoutMs })
          }
        }
        context = {
          browser,
          electronApplication: launcher.electronApplication?.() ?? null,
          fixture: { repository, manifest: fixtureManifest },
          launcher,
          page,
          paths: resolvedPaths,
          policy,
          readiness,
          ports: { backendPort, chromiumDebugPort, rendererPort },
        }
        return context
      } catch (error) {
        await captureDiagnostics()
        await shutdown()
        throw error
      }
    })()
    return startPromise
  }

  async function runScenario(scenario) {
    const startedContext = await start()
    try {
      return await scenario(startedContext)
    } catch (error) {
      await captureDiagnostics()
      throw error
    } finally {
      await shutdown()
    }
  }

  return {
    start,
    runScenario,
    shutdown,
    getContext: () => context,
    getPaths: () => paths,
  }
}
