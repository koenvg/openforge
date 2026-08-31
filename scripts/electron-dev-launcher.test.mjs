import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  buildElectronLaunchArgs,
  createElectronDevLauncher,
  createPlaywrightElectronLaunchAdapter,
} from './electron-dev.mjs'
import { resolveRustSidecarLayout } from './rust-sidecar-layout.mjs'

const testLayout = resolveRustSidecarLayout({
  repoRoot: '/repo/openforge',
  config: {
    backendCrateRoot: 'src-tauri',
    manifestPath: 'src-tauri/Cargo.toml',
    binaryName: 'openforge',
    iconPath: 'src-tauri/icons/icon.icns',
    electronBundleRoot: 'src-tauri/target/release/bundle/electron/macos',
  },
})

function childProcessMock() {
  const events = new EventEmitter()
  return {
    killed: false,
    killSignals: [],
    unrefCalls: 0,
    kill(signal = 'SIGTERM') {
      this.killed = true
      this.killSignals.push(signal)
      return true
    },
    once(event, handler) {
      events.once(event, handler)
      return this
    },
    off(event, handler) {
      events.off(event, handler)
      return this
    },
    emitExit(code = 0, signal = null) {
      events.emit('exit', code, signal)
    },
    unref() {
      this.unrefCalls += 1
    },
  }
}

function runtimeOptions(overrides = {}) {
  return {
    rendererPort: 1431,
    rendererUrl: 'http://127.0.0.1:1431',
    electronDebugPort: null,
    userDataDir: '/tmp/desktop-test/user-data',
    appDataDir: '/tmp/desktop-test/app-data',
    tempRuntimeDirs: [],
    seededAppData: null,
    ...overrides,
  }
}

function launcherDependencies(overrides = {}) {
  return {
    prepareElectronDevArtifacts: vi.fn(async () => undefined),
    assertVitePortAvailable: vi.fn(async () => undefined),
    assertElectronDebugPortAvailable: vi.fn(async () => undefined),
    assertChromiumDebugPortAvailable: vi.fn(async () => undefined),
    resolveElectronDevBackendEnv: vi.fn(async () => ({
      env: { CARGO_TARGET_DIR: '/tmp/cargo-target' },
      cargoTargetDir: '/tmp/cargo-target',
      source: 'test',
    })),
    prepareElectronDevCargoEnv: vi.fn(async env => env),
    waitForVite: vi.fn(async () => undefined),
    waitForExit: vi.fn(async () => undefined),
    resolveRustSidecarLayout: () => testLayout,
    repoRoot: () => '/repo/openforge',
    logger: vi.fn(),
    ...overrides,
  }
}

describe('importable Electron development launcher', () => {
  it('builds separate loopback inspector and Chromium DevTools arguments', () => {
    const options = { electronDebugPort: 9333 }
    expect(buildElectronLaunchArgs(options)).toEqual(['--inspect=127.0.0.1:9333'])
    expect(buildElectronLaunchArgs(options, {
      chromiumDebugPort: 9444,
      extraArgs: ['--no-first-run'],
    })).toEqual([
      '--inspect=127.0.0.1:9333',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9444',
      '--no-first-run',
    ])
  })

  it('starts an isolated runtime, captures output, and shuts down once', async () => {
    const spawned = []
    const cleanup = vi.fn(async () => ({ processes: ['terminated', 'terminated'], runtimeDirs: [] }))
    const spawnCommand = vi.fn((command, args, options = {}) => {
      const child = childProcessMock()
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      Object.assign(child, { command, args, options })
      spawned.push(child)
      queueMicrotask(() => child.stdout.emit('data', Buffer.from(`${command} ready\n`)))
      return child
    })
    const launcher = createElectronDevLauncher(
      { runtimeOptions: runtimeOptions(), chromiumDebugPort: 9444, captureOutput: true },
      launcherDependencies({ spawnCommand, cleanupDevProcesses: cleanup }),
    )

    await launcher.start()

    expect(spawned.map(child => [child.command, child.args])).toEqual([
      ['pnpm', ['exec', 'vite', '--host', '127.0.0.1', '--port', '1431', '--strictPort']],
      ['cargo', ['build']],
      ['pnpm', ['electron:build']],
      ['pnpm', ['exec', 'electron', '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=9444', '.']],
    ])
    expect(spawned[3].options.env).toMatchObject({
      OPENFORGE_APP_DATA_DIR: '/tmp/desktop-test/app-data',
      OPENFORGE_ELECTRON_USER_DATA_DIR: '/tmp/desktop-test/user-data',
      OPENFORGE_SIDECAR_PATH: '/tmp/cargo-target/debug/openforge',
    })
    await Promise.resolve()
    expect(launcher.output()).toContain('pnpm ready')
    const firstShutdown = launcher.shutdown()
    expect(launcher.shutdown()).toBe(firstShutdown)
    await expect(firstShutdown).resolves.toEqual({ processes: ['terminated', 'terminated'], runtimeDirs: [] })
    expect(cleanup).toHaveBeenCalledOnce()
  })
  it('translates an E2E launch into a matching Vite flag, tokenized renderer URL, and Sidecar flag', async () => {
    const spawned = []
    const spawnCommand = vi.fn((command, args, options = {}) => {
      const child = Object.assign(childProcessMock(), { command, args, options })
      spawned.push(child)
      return child
    })
    const launcher = createElectronDevLauncher(
      {
        runtimeOptions: runtimeOptions(),
        desktopTest: true,
        e2eToken: 'fixed-run-token',
      },
      launcherDependencies({ spawnCommand }),
    )

    await launcher.start()

    expect(launcher.runtimeOptions.rendererUrl).toBe(
      'http://127.0.0.1:1431/?openforge-e2e-token=fixed-run-token',
    )
    expect(spawned[0].options.env).toMatchObject({
      VITE_OPENFORGE_E2E: '1',
      VITE_OPENFORGE_E2E_TOKEN: 'fixed-run-token',
    })
    expect(spawned[3].options.env).toMatchObject({
      OPENFORGE_E2E: '1',
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:1431/?openforge-e2e-token=fixed-run-token',
    })

    await launcher.shutdown()
  })


  it('cleans the runtime when readiness fails before Electron launch', async () => {
    const cleanup = vi.fn(async () => ({ processes: ['terminated'], runtimeDirs: ['removed'] }))
    const spawnCommand = vi.fn(() => childProcessMock())
    const launcher = createElectronDevLauncher(
      { runtimeOptions: runtimeOptions({ tempRuntimeDirs: ['/tmp/desktop-test/user-data'] }) },
      launcherDependencies({
        waitForVite: vi.fn(async () => { throw new Error('renderer unavailable') }),
        spawnCommand,
        cleanupDevProcesses: cleanup,
      }),
    )

    await expect(launcher.start()).rejects.toThrow('renderer unavailable')
    expect(spawnCommand).toHaveBeenCalledOnce()
    expect(cleanup).toHaveBeenCalledOnce()
    expect(launcher.children().electron).toBeNull()
  })

  it('launches Electron through an injected adapter and closes it before process cleanup', async () => {
    const order = []
    const electronProcess = childProcessMock()
    electronProcess.pid = 404
    electronProcess.stdout = new EventEmitter()
    electronProcess.stderr = new EventEmitter()
    const application = { name: 'playwright-electron' }
    const page = { url: () => 'http://127.0.0.1:1431/' }
    const electronLaunchAdapter = {
      launch: vi.fn(async launchOptions => ({
        application,
        page,
        process: electronProcess,
        close: vi.fn(async () => { order.push('electron-close') }),
        waitForExit: vi.fn(async () => { order.push('electron-exit') }),
        launchOptions,
      })),
    }
    const spawned = []
    const spawnCommand = vi.fn((command, args, options = {}) => {
      const child = childProcessMock()
      Object.assign(child, { command, args, options })
      child.stdout = new EventEmitter()
      child.stderr = new EventEmitter()
      spawned.push(child)
      return child
    })
    const cleanup = vi.fn(async () => {
      order.push('process-cleanup')
      return { processes: ['terminated'], runtimeDirs: ['removed'] }
    })
    const launcher = createElectronDevLauncher(
      {
        runtimeOptions: runtimeOptions(),
        captureOutput: true,
        electronLaunchAdapter,
        electronArgs: ['--no-first-run'],
      },
      launcherDependencies({ spawnCommand, cleanupDevProcesses: cleanup }),
    )

    await launcher.start()

    expect(spawned.map(child => child.command)).toEqual(['pnpm', 'cargo', 'pnpm'])
    expect(electronLaunchAdapter.launch).toHaveBeenCalledWith(expect.objectContaining({
      args: ['--no-first-run', '.'],
      env: expect.objectContaining({
        OPENFORGE_APP_DATA_DIR: '/tmp/desktop-test/app-data',
        OPENFORGE_ELECTRON_USER_DATA_DIR: '/tmp/desktop-test/user-data',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    }))
    expect(launcher.children().electron).toBe(electronProcess)
    expect(launcher.electronApplication()).toBe(application)
    expect(launcher.page()).toBe(page)
    expect(electronProcess.pid).toBe(404)

    await launcher.waitForExit()
    await launcher.shutdown()

    expect(order).toEqual(['electron-exit', 'electron-close', 'process-cleanup'])
    expect(cleanup).toHaveBeenCalledOnce()
    expect(launcher.output()).toBe('')
  })

  it('normalizes Playwright Electron application lifecycle and renderer access', async () => {
    const process = childProcessMock()
    process.pid = 505
    const page = { url: () => 'http://127.0.0.1:1431/' }
    const application = {
      close: vi.fn(async () => undefined),
      firstWindow: vi.fn(async () => page),
      process: vi.fn(() => process),
      waitForEvent: vi.fn(async event => event),
    }
    const electronApi = { launch: vi.fn(async () => application) }
    const adapter = createPlaywrightElectronLaunchAdapter(electronApi)

    const handle = await adapter.launch({
      args: ['--inspect=127.0.0.1:9333', '.'],
      env: { ELECTRON_RENDERER_URL: 'http://127.0.0.1:1431/' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    expect(electronApi.launch).toHaveBeenCalledWith({
      args: ['--inspect=127.0.0.1:9333', '.'],
      env: { ELECTRON_RENDERER_URL: 'http://127.0.0.1:1431/' },
    })
    expect(handle.process).toBe(process)
    expect(handle.application).toBe(application)
    expect(handle.page).toBe(page)
    await handle.waitForExit()
    expect(application.waitForEvent).toHaveBeenCalledWith('close')
    await handle.close()
    expect(application.close).toHaveBeenCalledOnce()
  })

  it('uses the explicit Chromium debugging environment port on the normal development path', async () => {
    const spawned = []
    const spawnCommand = vi.fn((command, args, options = {}) => {
      const child = childProcessMock()
      Object.assign(child, { command, args, options })
      spawned.push(child)
      return child
    })
    const launcher = createElectronDevLauncher(
      {
        runtimeOptions: runtimeOptions(),
        env: { OPENFORGE_CHROMIUM_DEBUG_PORT: '9555' },
      },
      launcherDependencies({
        spawnCommand,
        cleanupDevProcesses: vi.fn(async () => ({ processes: [], runtimeDirs: [] })),
      }),
    )

    await launcher.start()

    expect(spawned.at(-1).args).toEqual([
      'exec',
      'electron',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=9555',
      '.',
    ])
    await launcher.shutdown()
  })
})
