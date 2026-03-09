import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('./ipc', () => ({
  checkClaudeInstalled: vi.fn().mockResolvedValue({ installed: true, path: '/usr/bin/claude', version: '1.0.0', authenticated: true }),
  checkOpenCodeInstalled: vi.fn().mockResolvedValue({ installed: true, path: '/usr/bin/opencode', version: '2.0.0' }),
  getAgentLogs: vi.fn().mockResolvedValue([]),
  getAgents: vi.fn().mockResolvedValue([]),
}))

import {
  getProvider,
  getAllProviders,
  registerProvider,
  _resetForTesting,
  type AIProviderConfig,
} from './providers'
import { checkClaudeInstalled, checkOpenCodeInstalled, getAgentLogs, getAgents } from './ipc'

describe('provider registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetForTesting()
  })

  describe('built-in providers', () => {
    it('registers claude-code by default', () => {
      const provider = getProvider('claude-code')
      expect(provider).toBeDefined()
      expect(provider!.displayName).toBe('Claude Code')
    })

    it('registers opencode by default', () => {
      const provider = getProvider('opencode')
      expect(provider).toBeDefined()
      expect(provider!.displayName).toBe('OpenCode')
    })

    it('getAllProviders returns both built-in providers', () => {
      const all = getAllProviders()
      expect(all).toHaveLength(2)
      const ids = all.map(p => p.id)
      expect(ids).toContain('claude-code')
      expect(ids).toContain('opencode')
    })
  })

  describe('claude-code provider config', () => {
    it('supports permission mode', () => {
      const provider = getProvider('claude-code')!
      expect(provider.supportsPermissionMode).toBe(true)
    })

    it('does not support agent selection', () => {
      const provider = getProvider('claude-code')!
      expect(provider.supportsAgentSelection).toBe(false)
    })

    it('has loadSessionLogs capability', () => {
      const provider = getProvider('claude-code')!
      expect(provider.loadSessionLogs).toBeDefined()
    })

    it('does not have loadAgents capability', () => {
      const provider = getProvider('claude-code')!
      expect(provider.loadAgents).toBeUndefined()
    })

    it('checkInstalled delegates to checkClaudeInstalled', async () => {
      const provider = getProvider('claude-code')!
      const result = await provider.checkInstalled()
      expect(checkClaudeInstalled).toHaveBeenCalled()
      expect(result.installed).toBe(true)
      expect(result.version).toBe('1.0.0')
    })

    it('checkInstalled includes authenticated in extras', async () => {
      const provider = getProvider('claude-code')!
      const result = await provider.checkInstalled()
      expect(result.authenticated).toBe(true)
    })

    it('loadSessionLogs delegates to getAgentLogs', async () => {
      const mockLogs = [{ id: 1, session_id: 's1', timestamp: 1, log_type: 'assistant', content: '{}' }]
      vi.mocked(getAgentLogs).mockResolvedValue(mockLogs)

      const provider = getProvider('claude-code')!
      const logs = await provider.loadSessionLogs!('s1')
      expect(getAgentLogs).toHaveBeenCalledWith('s1')
      expect(logs).toEqual(mockLogs)
    })
  })

  describe('opencode provider config', () => {
    it('does not support permission mode', () => {
      const provider = getProvider('opencode')!
      expect(provider.supportsPermissionMode).toBe(false)
    })

    it('supports agent selection', () => {
      const provider = getProvider('opencode')!
      expect(provider.supportsAgentSelection).toBe(true)
    })

    it('has loadAgents capability', () => {
      const provider = getProvider('opencode')!
      expect(provider.loadAgents).toBeDefined()
    })

    it('does not have loadSessionLogs capability', () => {
      const provider = getProvider('opencode')!
      expect(provider.loadSessionLogs).toBeUndefined()
    })

    it('checkInstalled delegates to checkOpenCodeInstalled', async () => {
      const provider = getProvider('opencode')!
      const result = await provider.checkInstalled()
      expect(checkOpenCodeInstalled).toHaveBeenCalled()
      expect(result.installed).toBe(true)
      expect(result.version).toBe('2.0.0')
    })

    it('loadAgents delegates to getAgents', async () => {
      const mockAgents = [{ name: 'coder' }, { name: 'reviewer' }]
      vi.mocked(getAgents).mockResolvedValue(mockAgents)

      const provider = getProvider('opencode')!
      const agents = await provider.loadAgents!()
      expect(getAgents).toHaveBeenCalled()
      expect(agents).toEqual(mockAgents)
    })
  })

  describe('getProvider', () => {
    it('returns undefined for unknown provider', () => {
      expect(getProvider('nonexistent')).toBeUndefined()
    })
  })

  describe('registerProvider', () => {
    it('adds a new provider to the registry', () => {
      const custom: AIProviderConfig = {
        id: 'aider',
        displayName: 'Aider',
        supportsPermissionMode: false,
        supportsAgentSelection: true,
        checkInstalled: vi.fn().mockResolvedValue({ installed: false, version: null }),
      }
      registerProvider(custom)

      expect(getProvider('aider')).toBe(custom)
      expect(getAllProviders()).toHaveLength(3)
    })

    it('overwrites existing provider with same id', () => {
      const override: AIProviderConfig = {
        id: 'claude-code',
        displayName: 'Claude Code Custom',
        supportsPermissionMode: false,
        supportsAgentSelection: false,
        checkInstalled: vi.fn().mockResolvedValue({ installed: false, version: null }),
      }
      registerProvider(override)

      expect(getProvider('claude-code')!.displayName).toBe('Claude Code Custom')
      expect(getAllProviders()).toHaveLength(2)
    })
  })
})
