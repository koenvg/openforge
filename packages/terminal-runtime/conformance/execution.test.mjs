import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'

import { PLAYWRIGHT_IMAGE } from '../../../scripts/playwright-image.mjs'
import {
  assertTerminalPresentationEnvironment,
  browserPhaseNames,
  runTerminalPresentation,
  terminalBaselineIdentity,
} from './execution.mjs'

function createChecks(events) {
  return Object.fromEntries(browserPhaseNames.map(name => [
    name,
    vi.fn(async () => events.push(name)),
  ]))
}

describe('terminal presentation ownership', () => {
  it('accepts only the pinned Linux ARM64 environment for browser-only conformance', () => {
    expect(() => assertTerminalPresentationEnvironment({
      browserOnly: true,
      platform: 'linux',
      architecture: 'arm64',
      image: PLAYWRIGHT_IMAGE,
    })).not.toThrow()
    expect(terminalBaselineIdentity('linux', 'arm64')).toBe('linux-arm64')

    for (const environment of [
      { platform: 'darwin', architecture: 'arm64', image: PLAYWRIGHT_IMAGE },
      { platform: 'linux', architecture: 'x64', image: PLAYWRIGHT_IMAGE },
      { platform: 'linux', architecture: 'arm64', image: undefined },
      { platform: 'linux', architecture: 'arm64', image: 'mcr.microsoft.com/playwright:latest' },
    ]) {
      expect(() => assertTerminalPresentationEnvironment({ browserOnly: true, ...environment }))
        .toThrow('pinned Linux ARM64 container')
    }
  })

  it('keeps the default native command available outside the visual container', () => {
    expect(() => assertTerminalPresentationEnvironment({
      browserOnly: false,
      platform: 'darwin',
      architecture: 'arm64',
      image: undefined,
    })).not.toThrow()
  })

  it('keeps the native local command and exposes an explicit browser-only command', () => {
    const { scripts } = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))

    expect(scripts['terminal:presentation']).toBe('node packages/terminal-runtime/conformance/run.mjs')
    expect(scripts['terminal:presentation:browser']).toBe(
      'node packages/terminal-runtime/conformance/run.mjs --browser-only',
    )
  })

  it('keeps the native PTY assertion and every browser phase in the default mode', async () => {
    const events = []
    const runNative = vi.fn(() => events.push('native-terminal-colour-profile'))

    await runTerminalPresentation({ browserOnly: false, runNative, browserChecks: createChecks(events) })

    expect(runNative).toHaveBeenCalledOnce()
    expect(events).toEqual(['native-terminal-colour-profile', ...browserPhaseNames])
  })

  it('skips only the native PTY assertion in browser-only mode', async () => {
    const events = []
    const runNative = vi.fn()

    await runTerminalPresentation({ browserOnly: true, runNative, browserChecks: createChecks(events) })

    expect(runNative).not.toHaveBeenCalled()
    expect(events).toEqual(browserPhaseNames)
  })

  it('rejects a production plan that omits any required browser phase', async () => {
    const browserChecks = createChecks([])
    delete browserChecks['concurrent-terminal-lifecycle']

    await expect(runTerminalPresentation({ browserOnly: true, runNative: vi.fn(), browserChecks }))
      .rejects.toThrow('Missing terminal presentation browser phase: concurrent-terminal-lifecycle')
  })
})
