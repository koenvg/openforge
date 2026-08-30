import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createElectronDevLauncher } from '../electron-dev.mjs'
import {
  allocateLoopbackPort,
  waitForDevTools,
  waitForPlaywrightPage,
} from '../electron-process.mjs'
import { createFixtureRepository, seedFixtureAppData } from './fixture.mjs'

const DEFAULT_TIMEOUT_MS = 30_000

function repositoryRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '../..')
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
  const allocatePort = deps.allocateLoopbackPort ?? allocateLoopbackPort
  const createRepository = deps.createFixtureRepository ?? createFixtureRepository
  const seedAppData = deps.seedFixtureAppData ?? seedFixtureAppData
  const createLauncher = deps.createElectronDevLauncher ?? createElectronDevLauncher
  const awaitDevTools = deps.waitForDevTools ?? waitForDevTools
  const connectOverCDP = deps.connectOverCDP ?? ((endpoint, connectOptions) => chromium.connectOverCDP(endpoint, connectOptions))
  const awaitPage = deps.waitForPlaywrightPage ?? waitForPlaywrightPage
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
    runRoot ??= await makeTempDir(join(tmpdir(), 'openforge-desktop-test-'))
    const artifactRoot = options.outputDir
      ? resolve(options.outputDir)
      : join(resolveRepositoryRoot(), 'artifacts', 'desktop-test', basename(runRoot))
    paths = createDesktopTestPaths({ runRoot, artifactRoot })
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
      if (runRoot && !options.retainRuntime) {
        await remove(runRoot, { recursive: true, force: true }).catch(() => {})
      }
    })()
    return shutdownPromise
  }

  function start() {
    startPromise ??= (async () => {
      try {
        const resolvedPaths = await ensurePaths()
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
        context = {
          browser,
          fixture: { repository, manifest: fixtureManifest },
          launcher,
          page,
          paths: resolvedPaths,
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
