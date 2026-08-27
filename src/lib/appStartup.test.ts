import { describe, expect, it, vi } from 'vitest'
import { loadAppStartupData } from './appStartup'

describe('loadAppStartupData', () => {
  it('initializes runtime, loads projects, config, attention, and tasks in startup order', async () => {
    const calls: string[] = []
    const setAppMode = vi.fn((mode: string | null) => calls.push(`set-app-mode:${mode}`))

    await loadAppStartupData({
      initializePluginRuntime: vi.fn(async () => { calls.push('plugins') }),
      loadProjects: vi.fn(async () => { calls.push('projects') }),
      getAppMode: vi.fn(async () => { calls.push('mode'); return 'standard' }),
      setAppMode,
      loadProjectAttention: vi.fn(() => { calls.push('attention') }),
      loadTasks: vi.fn(async () => { calls.push('tasks') }),
    })

    expect(calls).toEqual([
      'plugins',
      'projects',
      'mode',
      'set-app-mode:standard',
      'attention',
      'tasks',
    ])
  })

  it('continues startup when optional runtime, mode, or config loads fail', async () => {
    const loadProjects = vi.fn(async () => undefined)
    const loadProjectAttention = vi.fn()
    const loadTasks = vi.fn(async () => undefined)
    const logError = vi.fn()

    await loadAppStartupData({
      initializePluginRuntime: vi.fn(async () => { throw new Error('runtime failed') }),
      loadProjects,
      getAppMode: vi.fn(async () => { throw new Error('mode failed') }),
      setAppMode: vi.fn(),
      loadProjectAttention,
      loadTasks,
      logError,
    })

    expect(loadProjects).toHaveBeenCalledOnce()
    expect(loadProjectAttention).toHaveBeenCalledOnce()
    expect(loadTasks).toHaveBeenCalledOnce()
    expect(logError).toHaveBeenCalledTimes(2)
  })
})
