export const OPENFORGE_AI_PROVIDER_IDS = ['claude-code', 'opencode', 'pi', 'codex', 'grok'] as const

export type OpenForgeAiProviderId = (typeof OPENFORGE_AI_PROVIDER_IDS)[number]

/** An OpenForge-supported agent this instance can start a task with. */
export interface InstalledAiProvider {
  id: OpenForgeAiProviderId
  displayName: string
}

export const OPENFORGE_AI_PROVIDERS: readonly InstalledAiProvider[] = Object.freeze([
  { id: 'claude-code', displayName: 'Claude Code' },
  { id: 'opencode', displayName: 'OpenCode' },
  { id: 'pi', displayName: 'Pi Coding Agent' },
  { id: 'codex', displayName: 'Codex' },
  { id: 'grok', displayName: 'Grok' },
])

export function isOpenForgeAiProviderId(value: string): value is OpenForgeAiProviderId {
  return (OPENFORGE_AI_PROVIDER_IDS as readonly string[]).includes(value)
}

export function installedAiProvidersFromFlags(flags: Readonly<Record<OpenForgeAiProviderId, boolean>>): InstalledAiProvider[] {
  return OPENFORGE_AI_PROVIDERS.filter((provider) => flags[provider.id])
}
