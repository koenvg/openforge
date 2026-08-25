import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  checkOpenCodeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(),
  checkCodexInstalled: vi.fn(),
  checkGrokInstalled: vi.fn(),
  checkPiInstalled: vi.fn(),
  getAllWhisperModelStatuses: vi.fn(),
}))

vi.mock('./boardFilters', () => ({
  loadFocusFilterStates: vi.fn(),
}))

import { loadFocusFilterStates } from './boardFilters'
import {
  checkClaudeInstalled,
  checkCodexInstalled,
  checkGrokInstalled,
  checkOpenCodeInstalled,
  checkPiInstalled,
  getAllWhisperModelStatuses,
  getConfig,
  getProjectConfig,
} from './ipc'
import {
  loadGlobalSettings,
  loadInstallationStatus,
  loadProjectSettings,
  loadWhisperModelStatuses,
} from './settingsConfig'
import { DEFAULT_PR_WALKTHROUGH_PROMPT } from './prWalkthroughPrompt'

describe('settingsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(loadFocusFilterStates).mockResolvedValue([])
    vi.mocked(checkOpenCodeInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
    })
    vi.mocked(checkClaudeInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
    })
    vi.mocked(checkPiInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
    })
    vi.mocked(checkCodexInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
    })
    vi.mocked(checkGrokInstalled).mockResolvedValue({
      installed: false,
      path: null,
      version: null,
      authenticated: false,
    })
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([])
  })

  describe('loadProjectSettings', () => {
    it('loads project settings with defaults and related collections', async () => {
      vi.mocked(getProjectConfig)
        .mockResolvedValueOnce('Be careful')
        .mockResolvedValueOnce('opencode')
        .mockResolvedValueOnce('false')
        .mockResolvedValueOnce('pnpm dev')

      vi.mocked(loadFocusFilterStates).mockResolvedValue(['idle'])

      const result = await loadProjectSettings('project-1')

      expect(getProjectConfig).toHaveBeenCalledTimes(4)
      expect(getProjectConfig).not.toHaveBeenCalledWith('project-1', 'project_color')
      expect(getProjectConfig).toHaveBeenCalledWith('project-1', 'use_worktrees')
      expect(getProjectConfig).toHaveBeenCalledWith('project-1', 'run_command')
      expect(loadFocusFilterStates).toHaveBeenCalledWith('project-1')
      expect(result).toEqual({
        agentInstructions: 'Be careful',
        aiProvider: 'opencode',
        useWorktrees: false,
        runCommand: 'pnpm dev',
        focusFilterStates: ['idle'],
      })
    })

    it('falls back to the current defaults when config values are missing', async () => {
      const result = await loadProjectSettings('project-1')

      expect(result).toEqual({
        agentInstructions: '',
        aiProvider: 'claude-code',
        useWorktrees: true,
        runCommand: '',
        focusFilterStates: [],
      })
    })
  })

  describe('loadGlobalSettings', () => {
    it('loads global settings and parses boolean and numeric fields', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce('T-')
        .mockResolvedValueOnce('gh-token')
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce('45')
        .mockResolvedValueOnce('false')
        .mockResolvedValueOnce('opencode')
        .mockResolvedValueOnce('Custom walkthrough prompt')
        .mockResolvedValueOnce('true')

      const result = await loadGlobalSettings()

      expect(getConfig).toHaveBeenCalledTimes(9)
      expect(result).toEqual({
        taskIdPrefix: 'T-',
        githubToken: 'gh-token',
        codeCleanupTasksEnabled: true,
        taskDisplayTitleMetadataUpdatesEnabled: true,
        ghosttyTerminalDiagnosticsEnabled: true,
        githubPollInterval: 45,
        useWorktrees: false,
        aiProvider: 'opencode',
        walkthroughPrompt: 'Custom walkthrough prompt',
      })
    })

    it('uses current fallback values when config is empty or invalid', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('not-a-number')

      const result = await loadGlobalSettings()

      expect(result).toEqual({
        taskIdPrefix: '',
        githubToken: '',
        codeCleanupTasksEnabled: false,
        taskDisplayTitleMetadataUpdatesEnabled: false,
        ghosttyTerminalDiagnosticsEnabled: false,
        githubPollInterval: 60,
        useWorktrees: true,
        aiProvider: 'claude-code',
        walkthroughPrompt: DEFAULT_PR_WALKTHROUGH_PROMPT,
      })
    })

    it('clamps persisted GitHub poll interval of 0 seconds to the minimum supported value', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('0')

      const result = await loadGlobalSettings()

      expect(result.githubPollInterval).toBe(15)
    })

    it('clamps persisted GitHub poll interval below the minimum supported value', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('10')

      const result = await loadGlobalSettings()

      expect(result.githubPollInterval).toBe(15)
    })

    it('clamps persisted GitHub poll interval above the maximum supported value', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('301')

      const result = await loadGlobalSettings()

      expect(result.githubPollInterval).toBe(300)
    })

    it('defaults malformed persisted GitHub poll interval strings to the current default', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('45abc')

      const result = await loadGlobalSettings()

      expect(result.githubPollInterval).toBe(60)
    })

    it('defaults decimal persisted GitHub poll interval strings to the current default', async () => {
      vi.mocked(getConfig)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce('45.5')

      const result = await loadGlobalSettings()

      expect(result.githubPollInterval).toBe(60)
    })
  })

  describe('loadGlobalSettings hierarchy keys', () => {
    it('loads the worktree global override', async () => {
      vi.mocked(getConfig).mockImplementation(async (key: string) => {
        const map: Record<string, string> = {
          use_worktrees: 'false',
        }
        return map[key] ?? null
      })

      const result = await loadGlobalSettings()

      expect(result.useWorktrees).toBe(false)
    })

    it('defaults worktrees to enabled and provider to claude-code when unset', async () => {
      const result = await loadGlobalSettings()

      expect(result.useWorktrees).toBe(true)
      expect(result.aiProvider).toBe('claude-code')
    })
  })

  describe('loadInstallationStatus', () => {
    it('loads installation checks and normalizes the result', async () => {
      vi.mocked(checkOpenCodeInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/opencode',
        version: '1.2.3',
      })
      vi.mocked(checkClaudeInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/claude',
        version: '2.3.4',
        authenticated: true,
      })
      vi.mocked(checkCodexInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/codex',
        version: 'codex-cli 0.137.0',
      })
      vi.mocked(checkGrokInstalled).mockResolvedValue({
        installed: true,
        path: '/usr/local/bin/grok',
        version: 'grok-cli 0.1.0',
        authenticated: true,
      })

      const result = await loadInstallationStatus()

      expect(result).toEqual({
        opencodeInstalled: true,
        opencodeVersion: '1.2.3',
        claudeInstalled: true,
        claudeVersion: '2.3.4',
        claudeAuthenticated: true,
        piInstalled: false,
        piVersion: null,
        codexInstalled: true,
        codexVersion: 'codex-cli 0.137.0',
        grokInstalled: true,
        grokVersion: 'grok-cli 0.1.0',
        grokAuthenticated: true,
      })
    })

    it('falls back to disconnected install status when checks fail', async () => {
      vi.mocked(checkOpenCodeInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkClaudeInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkCodexInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkGrokInstalled).mockRejectedValue(new Error('missing'))

      const result = await loadInstallationStatus()

      expect(result).toEqual({
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
      })
    })
  })

  describe('loadWhisperModelStatuses', () => {
    it('returns Whisper model statuses when available', async () => {
      vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([
        {
          size: 'tiny',
          display_name: 'Tiny',
          disk_size_mb: 39,
          ram_usage_mb: 125,
          downloaded: true,
          model_path: '/tmp/tiny.bin',
          model_size_bytes: 39000000,
          model_name: 'ggml-tiny',
          is_active: true,
        },
      ])

      await expect(loadWhisperModelStatuses()).resolves.toEqual([
        {
          size: 'tiny',
          display_name: 'Tiny',
          disk_size_mb: 39,
          ram_usage_mb: 125,
          downloaded: true,
          model_path: '/tmp/tiny.bin',
          model_size_bytes: 39000000,
          model_name: 'ggml-tiny',
          is_active: true,
        },
      ])
    })

    it('returns an empty list when loading model statuses fails', async () => {
      vi.mocked(getAllWhisperModelStatuses).mockRejectedValue(new Error('boom'))

      await expect(loadWhisperModelStatuses()).resolves.toEqual([])
    })
  })
})
