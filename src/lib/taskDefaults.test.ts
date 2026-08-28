import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./ipc', () => ({
  getConfig: vi.fn(),
  getProjectConfig: vi.fn(),
  getResolvedAiProvider: vi.fn(),
}))

import { getConfig, getProjectConfig, getResolvedAiProvider } from './ipc'
import { loadTaskLevelDefaults } from './taskDefaults'

describe('loadTaskLevelDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getConfig).mockResolvedValue(null)
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getResolvedAiProvider).mockResolvedValue('claude-code')
  })

  it('inherits global when the project has no override', async () => {
    vi.mocked(getConfig).mockImplementation(async (key: string) =>
      key === 'task_display_title_metadata_updates_enabled' ? 'true' : null,
    )

    const defaults = await loadTaskLevelDefaults('P-1')

    expect(defaults.taskDisplayTitleUpdatesEnabled).toBe(true)
  })

  it('falls back to hardcoded defaults when neither project nor global is set', async () => {
    const defaults = await loadTaskLevelDefaults('P-1')

    expect(defaults.taskDisplayTitleUpdatesEnabled).toBe(false)
    expect(defaults.useWorktrees).toBe(true)
    expect(defaults.aiProvider).toBe('claude-code')
  })

  it('resolves the provider through the backend resolver', async () => {
    vi.mocked(getResolvedAiProvider).mockResolvedValue('opencode')

    const defaults = await loadTaskLevelDefaults('P-1')

    expect(getResolvedAiProvider).toHaveBeenCalledWith('P-1')
    expect(defaults.aiProvider).toBe('opencode')
  })

  it('uses hardcoded defaults without any project when projectId is null', async () => {
    const defaults = await loadTaskLevelDefaults(null)

    expect(getProjectConfig).not.toHaveBeenCalled()
    expect(getResolvedAiProvider).not.toHaveBeenCalled()
    expect(defaults.aiProvider).toBe('claude-code')
    expect(defaults.useWorktrees).toBe(true)
  })
})
