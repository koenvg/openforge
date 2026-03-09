import type { AgentInfo, AgentLog } from './types'
import { checkClaudeInstalled, checkOpenCodeInstalled, getAgentLogs, getAgents } from './ipc'

export interface ProviderInstallStatus {
  installed: boolean
  version: string | null
  [key: string]: unknown
}

export interface AIProviderConfig {
  id: string
  displayName: string
  /** Whether this provider supports permission mode selection in task creation */
  supportsPermissionMode: boolean
  /** Whether this provider supports agent selection in task creation */
  supportsAgentSelection: boolean
  /** Check if this provider CLI is installed */
  checkInstalled: () => Promise<ProviderInstallStatus>
  /** Load available agents (only when supportsAgentSelection is true) */
  loadAgents?: () => Promise<AgentInfo[]>
  /** Load session logs for completed sessions */
  loadSessionLogs?: (sessionId: string) => Promise<AgentLog[]>
}

let providers = new Map<string, AIProviderConfig>()

export function registerProvider(config: AIProviderConfig): void {
  providers.set(config.id, config)
}

export function getProvider(id: string): AIProviderConfig | undefined {
  return providers.get(id)
}

export function getAllProviders(): AIProviderConfig[] {
  return Array.from(providers.values())
}

function registerBuiltInProviders(): void {
  registerProvider({
    id: 'claude-code',
    displayName: 'Claude Code',
    supportsPermissionMode: true,
    supportsAgentSelection: false,
    checkInstalled: async () => {
      const result = await checkClaudeInstalled()
      return { installed: result.installed, version: result.version, authenticated: result.authenticated }
    },
    loadSessionLogs: getAgentLogs,
  })

  registerProvider({
    id: 'opencode',
    displayName: 'OpenCode',
    supportsPermissionMode: false,
    supportsAgentSelection: true,
    checkInstalled: async () => {
      const result = await checkOpenCodeInstalled()
      return { installed: result.installed, version: result.version }
    },
    loadAgents: getAgents,
  })
}

/** Reset registry and re-register built-ins. Test-only. */
export function _resetForTesting(): void {
  providers = new Map()
  registerBuiltInProviders()
}

// Auto-register on module load
registerBuiltInProviders()
