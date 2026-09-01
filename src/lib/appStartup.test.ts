import { describe, expect, it, vi } from 'vitest'
import { loadAppStartupData } from './appStartup'

describe('loadAppStartupData', () => {
  it('initializes runtime, loads projects, config, attention, and tasks in startup order', async () => {
    const calls: string[] = []
    const setAppMode = vi.fn((mode: string | null) => calls.push(`set-app-mode:${mode}`))

    await loadAppStartupData({
      initializePluginRuntime: vi.fn(async () => { calls.push('plugins') }),
      initializeTheme: vi.fn(async () => { calls.push('theme') }),
      loadProjects: vi.fn(async () => { calls.push('projects') }),
      getAppMode: vi.fn(async () => { calls.push('mode'); return 'standard' }),
      setAppMode,
      loadProjectAttention: vi.fn(() => { calls.push('attention') }),
      loadTasks: vi.fn(async () => { calls.push('tasks') }),
    })

    expect(calls).toEqual([
      'plugins',
      'theme',
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
      initializeTheme: vi.fn(async () => undefined),
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

  it('waits for app plugin activation before restoring a saved contributed theme', async () => {
    let finishPluginActivation: () => void = () => {}
    const pluginActivation = new Promise<void>((resolve) => {
      finishPluginActivation = resolve
    })
    const initializeTheme = vi.fn(async () => undefined)
    const startup = loadAppStartupData({
      initializePluginRuntime: vi.fn(() => pluginActivation),
      initializeTheme,
      loadProjects: vi.fn(async () => undefined),
      getAppMode: vi.fn(async () => null),
      setAppMode: vi.fn(),
      loadProjectAttention: vi.fn(),
      loadTasks: vi.fn(async () => undefined),
    })

    await Promise.resolve()
    expect(initializeTheme).not.toHaveBeenCalled()

    finishPluginActivation()
    await startup

    expect(initializeTheme).toHaveBeenCalledOnce()
  })
})
