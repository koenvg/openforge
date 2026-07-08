import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  getProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  checkOpenCodeInstalled: vi.fn(),
  checkClaudeInstalled: vi.fn(),
  checkCodexInstalled: vi.fn(),
  checkPiInstalled: vi.fn(),
  getAllWhisperModelStatuses: vi.fn(),
}))

vi.mock('./actions', () => ({
  loadActions: vi.fn(),
}))

vi.mock('./boardFilters', () => ({
  loadFocusFilterStates: vi.fn(),
}))

import { loadActions } from './actions'
import { loadFocusFilterStates } from './boardFilters'
import {
  checkClaudeInstalled,
  checkCodexInstalled,
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

describe('settingsConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(loadActions).mockResolvedValue([])
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
    vi.mocked(getAllWhisperModelStatuses).mockResolvedValue([])
  })

  describe('loadProjectSettings', () => {
    it('loads project settings with defaults and related collections', async () => {
      vi.mocked(getProjectConfig)
        .mockResolvedValueOnce('Be careful')
        .mockResolvedValueOnce('## Current summary\nCustom handoff format')
        .mockResolvedValueOnce('opencode')
        .mockResolvedValueOnce('amber')
        .mockResolvedValueOnce('false')

      vi.mocked(loadActions).mockResolvedValue([
        { id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true },
      ])
      vi.mocked(loadFocusFilterStates).mockResolvedValue(['idle'])

      const result = await loadProjectSettings('project-1')

      expect(getProjectConfig).toHaveBeenCalledTimes(5)
      expect(getProjectConfig).toHaveBeenCalledWith('project-1', 'use_worktrees')
      expect(loadActions).toHaveBeenCalledWith('project-1')
      expect(loadFocusFilterStates).toHaveBeenCalledWith('project-1')
      expect(result).toEqual({
        agentInstructions: 'Be careful',
        handoffNotesTemplate: '## Current summary\nCustom handoff format',
        aiProvider: 'opencode',
        projectColor: 'amber',
        useWorktrees: false,
        actions: [{ id: 'a1', name: 'Action', prompt: '', builtin: false, enabled: true }],
        focusFilterStates: ['idle'],
      })
    })

    it('falls back to the current defaults when config values are missing', async () => {
      const result = await loadProjectSettings('project-1')

      expect(result).toEqual({
        agentInstructions: '',
        handoffNotesTemplate: '',
        aiProvider: 'claude-code',
        projectColor: '',
        useWorktrees: true,
        actions: [],
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
        .mockResolvedValueOnce('sk-ant-test')

      const result = await loadGlobalSettings()

      expect(getConfig).toHaveBeenCalledTimes(6)
      expect(getConfig).toHaveBeenCalledWith('anthropic_api_key')
      expect(result).toEqual({
        taskIdPrefix: 'T-',
        githubToken: 'gh-token',
        anthropicApiKey: 'sk-ant-test',
        codeCleanupTasksEnabled: true,
        taskDisplayTitleMetadataUpdatesEnabled: true,
        githubPollInterval: 45,
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
        anthropicApiKey: '',
        codeCleanupTasksEnabled: false,
        taskDisplayTitleMetadataUpdatesEnabled: false,
        githubPollInterval: 60,
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
      })
    })

    it('falls back to disconnected install status when checks fail', async () => {
      vi.mocked(checkOpenCodeInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkClaudeInstalled).mockRejectedValue(new Error('missing'))
      vi.mocked(checkCodexInstalled).mockRejectedValue(new Error('missing'))

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
