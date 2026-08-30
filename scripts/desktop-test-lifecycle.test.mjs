import { describe, expect, it, vi } from 'vitest'
import { createDesktopTestLifecycle, createDesktopTestPaths } from './desktop-test/lifecycle.mjs'

const manifest = {
  schemaVersion: 1,
  projectId: 'P-1',
  taskId: 'T-1',
  projectName: 'Desktop Test Project',
  taskTitle: 'Terminal performance fixture',
  repoPath: '/run/repository',
  workspacePath: '/run/repository',
  appDataDir: '/run/app-data',
  databasePath: '/run/app-data/openforge_dev.db',
}

function createHarness({ connectPlaywright = true, retainRuntime = false, repoPath = null, launchError = null } = {}) {
  const page = { screenshot: vi.fn(async () => undefined) }
  const browser = { close: vi.fn(async () => undefined) }
  const launcher = {
    output: vi.fn(() => 'captured child output'),
    shutdown: vi.fn(async () => ({ processes: ['terminated', 'terminated'], runtimeDirs: [] })),
    children: vi.fn(() => ({ vite: {}, electron: {} })),
    start: vi.fn(async function start() {
      if (launchError) throw launchError
      await this.options.beforeElectronLaunch({ sidecarPath: '/cargo/debug/openforge' })
      return launcher
    }),
  }
  const createElectronDevLauncher = vi.fn((options) => {
    launcher.options = options
    return launcher
  })
  const allocateLoopbackPort = vi.fn()
    .mockResolvedValueOnce(1421)
    .mockResolvedValueOnce(9444)
    .mockResolvedValueOnce(17643)
  const createFixtureRepository = vi.fn(async ({ repoPath: suppliedRepoPath }) => ({
    generated: suppliedRepoPath === null,
    repoPath: suppliedRepoPath ?? '/run/repository',
  }))
  const seedFixtureAppData = vi.fn(async () => manifest)
  const writeFile = vi.fn(async () => undefined)
  const rm = vi.fn(async () => undefined)
  const mkdir = vi.fn(async () => undefined)
  const connectOverCDP = vi.fn(async () => browser)
  const waitForDevTools = vi.fn(async () => ({ Browser: 'Chrome/123' }))
  const waitForPlaywrightPage = vi.fn(async () => page)

  const lifecycle = createDesktopTestLifecycle(
    {
      runRoot: '/run',
      outputDir: '/artifacts/run-1',
      connectPlaywright,
      repoPath,
      retainRuntime,
      timeoutMs: 12_000,
    },
    {
      allocateLoopbackPort,
      createFixtureRepository,
      seedFixtureAppData,
      createElectronDevLauncher,
      connectOverCDP,
      waitForDevTools,
      waitForPlaywrightPage,
      writeFile,
      rm,
      mkdir,
    },
  )

  return {
    allocateLoopbackPort,
    browser,
    connectOverCDP,
    createElectronDevLauncher,
    createFixtureRepository,
    launcher,
    lifecycle,
    mkdir,
    page,
    rm,
    seedFixtureAppData,
    waitForDevTools,
    waitForPlaywrightPage,
    writeFile,
  }
}

describe('desktop test lifecycle', () => {
  it('derives isolated runtime and durable artifact paths', () => {
    expect(createDesktopTestPaths({ runRoot: '/tmp/run-1', artifactRoot: '/repo/artifacts/run-1' })).toEqual({
      runRoot: '/tmp/run-1',
      appDataDir: '/tmp/run-1/app-data',
      electronUserDataDir: '/tmp/run-1/electron-user-data',
      fixtureManifestPath: '/tmp/run-1/fixture.json',
      repositoryPath: '/tmp/run-1/repository',
      artifactRoot: '/repo/artifacts/run-1',
      childLogPath: '/repo/artifacts/run-1/children.log',
      failureScreenshotPath: '/repo/artifacts/run-1/failure.png',
      reportPath: '/repo/artifacts/run-1/report.json',
    })
  })

  it.each([
    { suppliedRepo: null, expectedRepo: '/run/repository', generated: true },
    { suppliedRepo: '/repos/existing', expectedRepo: '/repos/existing', generated: false },
  ])('seeds and launches against an isolated $generated repository fixture', async ({ suppliedRepo, expectedRepo, generated }) => {
    const harness = createHarness({ repoPath: suppliedRepo })

    const context = await harness.lifecycle.start()

    expect(harness.createFixtureRepository).toHaveBeenCalledWith(expect.objectContaining({
      runRoot: '/run',
      repoPath: suppliedRepo,
    }))
    expect(harness.seedFixtureAppData).toHaveBeenCalledWith(expect.objectContaining({
      sidecarPath: '/cargo/debug/openforge',
      appDataDir: '/run/app-data',
      repoPath: expectedRepo,
      manifestPath: '/run/fixture.json',
    }))
    expect(context.fixture.repository).toEqual({ generated, repoPath: expectedRepo })
    expect(context.fixture.manifest).toEqual(manifest)
    expect(harness.allocateLoopbackPort).toHaveBeenCalledTimes(3)
    expect(harness.createElectronDevLauncher).toHaveBeenCalledWith(expect.objectContaining({
      captureOutput: true,
      chromiumDebugPort: 9444,
      desktopTest: true,
      runtimeOptions: expect.objectContaining({
        rendererPort: 1421,
        appDataDir: '/run/app-data',
        userDataDir: '/run/electron-user-data',
        tempRuntimeDirs: [],
      }),
      env: expect.objectContaining({ OPENFORGE_BACKEND_PORT: '17643' }),
    }))
    expect(harness.waitForDevTools).toHaveBeenCalledWith(9444, expect.objectContaining({ timeoutMs: 12_000 }))
    expect(harness.connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9444', { timeout: 12_000 })
    expect(harness.waitForPlaywrightPage).toHaveBeenCalledWith(harness.browser, { timeoutMs: 12_000 })
    expect(context.page).toBe(harness.page)

    const firstShutdown = harness.lifecycle.shutdown()
    const repeatedShutdown = harness.lifecycle.shutdown()
    expect(repeatedShutdown).toBe(firstShutdown)
    await firstShutdown
    expect(harness.browser.close).toHaveBeenCalledOnce()
    expect(harness.launcher.shutdown).toHaveBeenCalledOnce()
    expect(harness.writeFile).toHaveBeenCalledWith('/artifacts/run-1/children.log', 'captured child output')
    expect(harness.rm).toHaveBeenCalledWith('/run', { recursive: true, force: true })
  })

  it('can keep the headed manual app open without attaching a Playwright client', async () => {
    const harness = createHarness({ connectPlaywright: false })
    const context = await harness.lifecycle.start()
    expect(harness.waitForDevTools).toHaveBeenCalledOnce()
    expect(harness.connectOverCDP).not.toHaveBeenCalled()
    expect(harness.waitForPlaywrightPage).not.toHaveBeenCalled()
    expect(context.page).toBeNull()
    await harness.lifecycle.shutdown()
  })

  it('retains runtime data when requested', async () => {
    const harness = createHarness({ retainRuntime: true })
    await harness.lifecycle.start()
    await harness.lifecycle.shutdown()
    expect(harness.rm).not.toHaveBeenCalled()
  })

  it('captures diagnostics and cleans up after launch and scenario failures', async () => {
    const launchFailure = createHarness({ launchError: new Error('launch failed') })
    await expect(launchFailure.lifecycle.start()).rejects.toThrow('launch failed')
    expect(launchFailure.launcher.shutdown).toHaveBeenCalledOnce()
    expect(launchFailure.writeFile).toHaveBeenCalledWith('/artifacts/run-1/children.log', 'captured child output')
    expect(launchFailure.rm).toHaveBeenCalledWith('/run', { recursive: true, force: true })

    const scenarioFailure = createHarness()
    await scenarioFailure.lifecycle.start()
    await expect(scenarioFailure.lifecycle.runScenario(async () => {
      throw new Error('scenario failed')
    })).rejects.toThrow('scenario failed')
    expect(scenarioFailure.page.screenshot).toHaveBeenCalledWith({ path: '/artifacts/run-1/failure.png', fullPage: true })
    expect(scenarioFailure.launcher.shutdown).toHaveBeenCalledOnce()
    expect(scenarioFailure.rm).toHaveBeenCalledWith('/run', { recursive: true, force: true })
  })
})
