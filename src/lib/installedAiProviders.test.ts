import { describe, expect, it, vi } from 'vitest'
import { installedAiProvidersFromStatus } from './installedAiProviders'
import type { InstallationStatus } from './settingsConfig'

vi.mock('./ipc', () => ({
  checkOpenCodeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(),
  checkCodexInstalled: vi.fn(),
  checkGrokInstalled: vi.fn(),
  checkPiInstalled: vi.fn(),
}))

function status(overrides: Partial<InstallationStatus> = {}): InstallationStatus {
  return {
    opencodeInstalled: false,
    opencodeVersion: null,
    claudeInstalled: false,
    claudeVersion: null,
    claudeAuthenticated: false,
    piInstalled: false,
    piVersion: null,
    codexInstalled: false,
    codexVersion: null,
    grokInstalled: false,
    grokVersion: null,
    grokAuthenticated: false,
    ...overrides,
  }
}

describe('installedAiProvidersFromStatus', () => {
  it('returns only OpenForge-supported agents this instance can start', () => {
    expect(installedAiProvidersFromStatus(status({
      claudeInstalled: true,
      grokInstalled: true,
    })).map((provider) => provider.id)).toEqual(['claude-code', 'grok'])
  })

  it('does not treat an on-disk CLI folder as an installed provider', () => {
    const installed = installedAiProvidersFromStatus(status({ claudeInstalled: true }))

    expect(installed.map((provider) => provider.id)).toEqual(['claude-code'])
    expect(installed.some((provider) => provider.id === 'pi')).toBe(false)
  })
})
