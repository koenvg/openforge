import { describe, expect, it, vi } from 'vitest'
import {
  assertSafeIsolatedPaths,
  assertTerminalControlAllowed,
  createDesktopExecutionPolicy,
  createDesktopTestLifecycle,
  validateReuseEndpoint,
  verifyOpenForgeDevelopmentPage,
} from './lifecycle.mjs'

describe('desktop E2E execution policy', () => {
  it('assigns ownership to isolated mode and denies ownership in reuse mode', () => {
    expect(createDesktopExecutionPolicy({ playwrightElectron: true })).toEqual({
      mode: 'isolated',
      ownsApp: true,
      ownsData: true,
      ownsProcesses: true,
      playwrightAccess: 'electron',
      terminalControlAuthorized: true,
    })
    expect(createDesktopExecutionPolicy({
      reuseEndpoint: 'http://127.0.0.1:9222',
      allowTerminalControl: false,
    })).toEqual({
      mode: 'reuse',
      ownsApp: false,
      ownsData: false,
      ownsProcesses: false,
      playwrightAccess: 'cdp',
      terminalControlAuthorized: false,
    })
  })

  it('rejects isolated paths that overlap configured developer data', () => {
    expect(() => assertSafeIsolatedPaths({
      appDataDir: '/Users/dev/.openforge',
      databasePath: '/Users/dev/.openforge/openforge_dev.db',
      electronUserDataDir: '/tmp/electron',
      repositoryPath: '/tmp/repo',
    }, {
      developerAppDataDir: '/Users/dev/.openforge',
      developerDatabasePath: '/Users/dev/.openforge/openforge_dev.db',
    })).toThrow('Isolated app data path overlaps configured developer data')

    expect(() => assertSafeIsolatedPaths({
      appDataDir: '/tmp/app-data',
      databasePath: '/tmp/app-data/openforge_dev.db',
      electronUserDataDir: '/tmp/electron',
      repositoryPath: '/tmp/repo',
    }, {
      developerAppDataDir: '/Users/dev/.openforge',
      developerDatabasePath: '/Users/dev/.openforge/openforge_dev.db',
    })).not.toThrow()
  })

  it.each([
    ['http://0.0.0.0:9222', 'loopback'],
    ['http://192.168.1.10:9222', 'loopback'],
    ['https://127.0.0.1:9222', 'http'],
    ['not-a-url', 'valid URL'],
  ])('rejects unsafe reuse endpoint %s', (endpoint, expected) => {
    expect(() => validateReuseEndpoint(endpoint)).toThrow(expected)
  })

  it('normalizes explicit loopback reuse endpoints', () => {
    expect(validateReuseEndpoint('http://localhost:9222')).toBe('http://localhost:9222')
    expect(validateReuseEndpoint('http://127.0.0.1:9222/')).toBe('http://127.0.0.1:9222')
  })

  it('verifies an OpenForge development renderer and reports E2E availability', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        bridgeVersion: 1,
        e2eEnabled: true,
        href: 'http://127.0.0.1:1420/?openforge-e2e-token=token',
      })),
    }

    await expect(verifyOpenForgeDevelopmentPage(page)).resolves.toEqual({
      bridgeVersion: 1,
      e2eEnabled: true,
      href: 'http://127.0.0.1:1420/?openforge-e2e-token=[redacted]',
    })

    page.evaluate.mockResolvedValueOnce({ bridgeVersion: null, e2eEnabled: false, href: 'https://example.com/' })
    await expect(verifyOpenForgeDevelopmentPage(page)).rejects.toThrow('does not identify an OpenForge development renderer')
  })

  it('requires both renderer E2E availability and explicit reuse consent for terminal control', () => {
    const observational = createDesktopExecutionPolicy({ reuseEndpoint: 'http://127.0.0.1:9222' })
    expect(() => assertTerminalControlAllowed(observational, { rendererE2eEnabled: true })).toThrow('--allow-terminal-control')

    const authorized = createDesktopExecutionPolicy({
      reuseEndpoint: 'http://127.0.0.1:9222',
      allowTerminalControl: true,
    })
    expect(() => assertTerminalControlAllowed(authorized, { rendererE2eEnabled: false })).toThrow('E2E controls are unavailable')
    expect(() => assertTerminalControlAllowed(authorized, { rendererE2eEnabled: true })).not.toThrow()
  })

  it('attaches and disconnects in reuse mode without seeding, launching, signalling, or deleting', async () => {
    const page = {
      evaluate: vi.fn(async () => ({
        bridgeVersion: 1,
        e2eEnabled: false,
        href: 'http://127.0.0.1:1420/',
      })),
    }
    const browser = { close: vi.fn(async () => undefined) }
    const createFixtureRepository = vi.fn()
    const seedFixtureAppData = vi.fn()
    const createElectronDevLauncher = vi.fn()
    const rm = vi.fn()
    const connectOverCDP = vi.fn(async () => browser)
    const lifecycle = createDesktopTestLifecycle({
      reuseEndpoint: 'http://127.0.0.1:9222',
      outputDir: '/artifacts/reuse',
      timeoutMs: 1_000,
    }, {
      connectOverCDP,
      createFixtureRepository,
      seedFixtureAppData,
      createElectronDevLauncher,
      waitForPlaywrightPage: vi.fn(async () => page),
      mkdir: vi.fn(async () => undefined),
      writeFile: vi.fn(async () => undefined),
      rm,
    })

    const context = await lifecycle.start()
    expect(context.policy.mode).toBe('reuse')
    expect(context.fixture).toBeNull()
    expect(connectOverCDP).toHaveBeenCalledWith('http://127.0.0.1:9222', { timeout: 1_000 })

    await lifecycle.shutdown()

    expect(browser.close).toHaveBeenCalledOnce()
    expect(createFixtureRepository).not.toHaveBeenCalled()
    expect(seedFixtureAppData).not.toHaveBeenCalled()
    expect(createElectronDevLauncher).not.toHaveBeenCalled()
    expect(rm).not.toHaveBeenCalled()
  })
})
