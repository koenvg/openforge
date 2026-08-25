import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  updateProject: vi.fn(),
  setProjectConfig: vi.fn(),
  setConfig: vi.fn(),
}))

vi.mock('./boardFilters', () => ({
  saveFocusFilterStates: vi.fn(),
}))

import { saveFocusFilterStates } from './boardFilters'
import { setConfig, setProjectConfig, updateProject } from './ipc'
import { saveGlobalSettings, saveProjectSettings } from './settingsSaver'

describe('settingsSaver', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(updateProject).mockResolvedValue(undefined)
    vi.mocked(setProjectConfig).mockResolvedValue(undefined)
    vi.mocked(setConfig).mockResolvedValue(undefined)
    vi.mocked(saveFocusFilterStates).mockResolvedValue(undefined)
  })

  it('persists project settings through the existing project config helpers', async () => {
    await saveProjectSettings({
      projectId: 'project-1',
      projectName: 'My Project',
      projectPath: '/tmp/project',
      agentInstructions: 'Do the thing',
      runCommand: 'pnpm dev',
      focusFilterStates: ['idle'],
    })

    expect(updateProject).toHaveBeenCalledWith('project-1', 'My Project', '/tmp/project')
    expect(setProjectConfig).not.toHaveBeenCalledWith('project-1', 'github_default_repo', expect.anything())
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'additional_instructions', 'Do the thing')
    expect(setProjectConfig).not.toHaveBeenCalledWith('project-1', 'project_color', expect.anything())
    expect(setProjectConfig).toHaveBeenCalledWith('project-1', 'run_command', 'pnpm dev')
    expect(saveFocusFilterStates).toHaveBeenCalledWith('project-1', ['idle'])
  })

  it('does not write ai_provider or use_worktrees, which the Configuration card owns via a single write path', async () => {
    await saveProjectSettings({
      projectId: 'project-1',
      projectName: 'My Project',
      projectPath: '/tmp/project',
      agentInstructions: 'Do the thing',
      runCommand: '',
      focusFilterStates: ['idle'],
    })

    expect(setProjectConfig).not.toHaveBeenCalledWith('project-1', 'ai_provider', expect.anything())
    expect(setProjectConfig).not.toHaveBeenCalledWith('project-1', 'use_worktrees', expect.anything())
  })

  it('persists global settings through the existing global config helpers', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      taskDisplayTitleMetadataUpdatesEnabled: true,
      ghosttyTerminalDiagnosticsEnabled: true,
      githubPollInterval: 45,
      useWorktrees: false,
      aiProvider: 'opencode',
    })

    expect(setConfig).toHaveBeenCalledWith('task_id_prefix', 'T-')
    expect(setConfig).toHaveBeenCalledWith('github_token', 'gh-token')
    expect(setConfig).toHaveBeenCalledWith('code_cleanup_tasks_enabled', 'true')
    expect(setConfig).toHaveBeenCalledWith('task_display_title_metadata_updates_enabled', 'true')
    expect(setConfig).toHaveBeenCalledWith('ghostty_terminal_state_enabled', 'true')
    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '45')
    expect(setConfig).toHaveBeenCalledWith('use_worktrees', 'false')
    expect(setConfig).toHaveBeenCalledWith('ai_provider', 'opencode')
  })

  it('persists only supplied global settings', async () => {
    await saveGlobalSettings({ githubToken: 'gh-new' })

    expect(setConfig).toHaveBeenCalledOnce()
    expect(setConfig).toHaveBeenCalledWith('github_token', 'gh-new')
  })

  it('clamps persisted global GitHub poll interval of 0 seconds to the minimum supported value', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      taskDisplayTitleMetadataUpdatesEnabled: false,
      githubPollInterval: 0,
      useWorktrees: true,
      aiProvider: 'claude-code',
    })

    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '15')
  })

  it('clamps persisted global GitHub poll interval below the minimum supported value', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      taskDisplayTitleMetadataUpdatesEnabled: false,
      githubPollInterval: 10,
      useWorktrees: true,
      aiProvider: 'claude-code',
    })

    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '15')
  })

  it('clamps persisted global GitHub poll interval above the maximum supported value', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      taskDisplayTitleMetadataUpdatesEnabled: false,
      githubPollInterval: 301,
      useWorktrees: true,
      aiProvider: 'claude-code',
    })

    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '300')
  })

  it('falls back to the current default when the poll interval payload is not a finite integer', async () => {
    await saveGlobalSettings({
      taskIdPrefix: 'T-',
      githubToken: 'gh-token',
      codeCleanupTasksEnabled: true,
      taskDisplayTitleMetadataUpdatesEnabled: false,
      githubPollInterval: Number.NaN,
      useWorktrees: true,
      aiProvider: 'claude-code',
    })

    expect(setConfig).toHaveBeenCalledWith('github_poll_interval', '60')
  })
})
