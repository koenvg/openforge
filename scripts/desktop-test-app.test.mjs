import { describe, expect, it, vi } from 'vitest'
import { parseDesktopTestAppOptions, runDesktopTestApp } from './desktop-test-app.mjs'

describe('headed desktop test app command', () => {
  it('parses repository, retention, and artifact options', () => {
    expect(parseDesktopTestAppOptions([
      '--',
      '--repository=/fixtures/repo',
      '--output=/artifacts/manual',
      '--retain',
    ])).toEqual({
      repoPath: '/fixtures/repo',
      outputDir: '/artifacts/manual',
      retainRuntime: true,
    })
  })


  it('uses cleanup defaults and rejects unknown or empty options', () => {
    expect(parseDesktopTestAppOptions([])).toEqual({})
    expect(() => parseDesktopTestAppOptions(['--unknown'])).toThrow('Unknown desktop test option')
    expect(() => parseDesktopTestAppOptions(['--repository='])).toThrow('--repository requires a value')
  })
  it('keeps the shared isolated lifecycle open until Electron exits and then cleans up', async () => {
    const waitForExit = vi.fn(async () => undefined)
    const lifecycle = {
      start: vi.fn(async () => ({
        fixture: { repository: { repoPath: '/run/repository', generated: true } },
        launcher: { waitForExit },
        paths: { runRoot: '/run', artifactRoot: '/artifacts/manual' },
      })),
      shutdown: vi.fn(async () => undefined),
    }
    const createLifecycle = vi.fn(() => lifecycle)
    const log = vi.fn()

    await runDesktopTestApp({ retainRuntime: true }, { createLifecycle, log })

    expect(createLifecycle).toHaveBeenCalledWith({ retainRuntime: true, connectPlaywright: false })
    expect(waitForExit).toHaveBeenCalledOnce()
    expect(lifecycle.shutdown).toHaveBeenCalledOnce()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('/run/repository'))
    expect(log).toHaveBeenCalledWith(expect.stringContaining('/run'))
  })

  it('rejects an invalid supplied repository and still performs cleanup', async () => {
    const lifecycle = {
      start: vi.fn(async () => { throw new Error('repository does not exist') }),
      shutdown: vi.fn(async () => undefined),
    }
    await expect(runDesktopTestApp(
      { repoPath: '/missing' },
      { createLifecycle: () => lifecycle, log: vi.fn() },
    )).rejects.toThrow('repository does not exist')
    expect(lifecycle.shutdown).toHaveBeenCalledOnce()
  })
})
