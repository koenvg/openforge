import { describe, expect, it } from 'vitest'

import {
  installedAiProvidersFromFlags,
  isOpenForgeAiProviderId,
  OPENFORGE_AI_PROVIDER_IDS,
  OPENFORGE_AI_PROVIDERS,
} from './aiProviders'

describe('installed AI providers', () => {
  it('lists only OpenForge-supported agents that this instance can start', () => {
    const installed = installedAiProvidersFromFlags({
      'claude-code': true,
      opencode: false,
      pi: false,
      codex: false,
      grok: true,
    })

    expect(installed.map((provider) => provider.id)).toEqual(['claude-code', 'grok'])
    expect(installed.every((provider) => OPENFORGE_AI_PROVIDER_IDS.includes(provider.id))).toBe(true)
  })

  it('does not treat an on-disk CLI folder as an installed provider', () => {
    const diskFolders = ['.pi', '.codex', '.opencode']
    const installed = installedAiProvidersFromFlags({
      'claude-code': true,
      opencode: false,
      pi: false,
      codex: false,
      grok: false,
    })

    expect(installed.map((provider) => provider.id)).toEqual(['claude-code'])
    expect(diskFolders.some((folder) => installed.some((provider) => folder.includes(provider.id)))).toBe(false)
  })

  it('rejects ids that are not OpenForge-supported agents', () => {
    expect(isOpenForgeAiProviderId('claude-code')).toBe(true)
    expect(isOpenForgeAiProviderId('gemini')).toBe(false)
    expect(OPENFORGE_AI_PROVIDERS).toHaveLength(OPENFORGE_AI_PROVIDER_IDS.length)
  })
})
