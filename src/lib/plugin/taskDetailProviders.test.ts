import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  clearProjectConfig,
  getConfig,
  getProjectConfig,
  setConfig,
  setProjectConfig,
} = vi.hoisted(() => ({
  clearProjectConfig: vi.fn(),
  getConfig: vi.fn(),
  getProjectConfig: vi.fn(),
  setConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

vi.mock('../ipc', () => ({
  clearProjectConfig,
  getConfig,
  getProjectConfig,
  setConfig,
  setProjectConfig,
}))

import { clearComponentRegistry, registerRenderableContributionComponent } from './componentRegistry'
import type { ResolvedViewReplacement } from './contributionResolver'
import {
  CORE_TASK_DETAIL_PROVIDER_ID,
  INHERIT_TASK_DETAIL_PROVIDER_ID,
  TASK_DETAIL_PROVIDER_CONFIG_KEY,
  clearTaskDetailProviderIds,
  globalTaskDetailProviderId,
  loadGlobalTaskDetailProviderId,
  loadProjectTaskDetailProviderId,
  projectTaskDetailProviderIds,
  resolveTaskDetailProviderAvailability,
  setGlobalTaskDetailProviderId,
  setProjectTaskDetailProviderId,
} from './taskDetailProviders'

const taskProvider: ResolvedViewReplacement = {
  pluginId: 'planning-plugin',
  contributionId: 'task-workspace',
  qualifiedId: 'planning-plugin.task-workspace',
  target: 'task.detail',
  title: 'Task workspace',
  icon: null,
}

const dashboardProvider: ResolvedViewReplacement = {
  pluginId: 'planning-plugin',
  contributionId: 'dashboard',
  qualifiedId: 'planning-plugin.dashboard',
  target: 'project.dashboard',
  title: 'Planning',
  icon: 'panels-top-left',
}

function registerTaskWorkspace(): void {
  registerRenderableContributionComponent(
    'viewReplacements',
    'planning-plugin:task-workspace',
    vi.fn() as never,
  )
}

describe('task detail provider preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearTaskDetailProviderIds()
    clearComponentRegistry()
    getConfig.mockResolvedValue(null)
    getProjectConfig.mockResolvedValue(null)
    setConfig.mockResolvedValue(undefined)
    setProjectConfig.mockResolvedValue(undefined)
    clearProjectConfig.mockResolvedValue(undefined)
  })

  it('defaults globally to OpenForge and per project to inheritance', () => {
    expect(TASK_DETAIL_PROVIDER_CONFIG_KEY).toBe('task_detail_provider')
    expect(get(globalTaskDetailProviderId)).toBe(CORE_TASK_DETAIL_PROVIDER_ID)
    expect(get(projectTaskDetailProviderIds)).toEqual(new Map())
  })

  it('inherits, overrides, and rejects providers for another target', () => {
    registerTaskWorkspace()
    const pluginEntries = new Map([['planning-plugin', { state: 'active' }]])

    expect(resolveTaskDetailProviderAvailability(
      INHERIT_TASK_DETAIL_PROVIDER_ID,
      taskProvider.qualifiedId,
      [taskProvider, dashboardProvider],
      pluginEntries,
    )).toMatchObject({ configuredId: taskProvider.qualifiedId, provider: taskProvider })

    expect(resolveTaskDetailProviderAvailability(
      CORE_TASK_DETAIL_PROVIDER_ID,
      taskProvider.qualifiedId,
      [taskProvider],
      pluginEntries,
    )).toMatchObject({ configuredId: CORE_TASK_DETAIL_PROVIDER_ID, provider: null })

    expect(resolveTaskDetailProviderAvailability(
      dashboardProvider.qualifiedId,
      CORE_TASK_DETAIL_PROVIDER_ID,
      [dashboardProvider],
      pluginEntries,
    )).toMatchObject({
      configuredId: dashboardProvider.qualifiedId,
      provider: null,
      unavailableReason: 'missing-contribution',
    })
  })

  it('falls back without rewriting unavailable stored providers', async () => {
    getConfig.mockResolvedValue('missing-plugin.task-workspace')
    getProjectConfig.mockResolvedValue('missing-project-plugin.task-workspace')

    await expect(loadGlobalTaskDetailProviderId()).resolves.toBe('missing-plugin.task-workspace')
    await expect(loadProjectTaskDetailProviderId('project-1')).resolves.toBe('missing-project-plugin.task-workspace')

    expect(get(globalTaskDetailProviderId)).toBe('missing-plugin.task-workspace')
    expect(get(projectTaskDetailProviderIds).get('project-1')).toBe('missing-project-plugin.task-workspace')
    expect(setConfig).not.toHaveBeenCalled()
    expect(setProjectConfig).not.toHaveBeenCalled()
  })

  it('persists global, project, and inherited choices through the shared model', async () => {
    await setGlobalTaskDetailProviderId(taskProvider.qualifiedId)
    expect(setConfig).toHaveBeenCalledWith(TASK_DETAIL_PROVIDER_CONFIG_KEY, taskProvider.qualifiedId)

    await setProjectTaskDetailProviderId('project-1', taskProvider.qualifiedId)
    expect(setProjectConfig).toHaveBeenCalledWith(
      'project-1',
      TASK_DETAIL_PROVIDER_CONFIG_KEY,
      taskProvider.qualifiedId,
    )

    await setProjectTaskDetailProviderId('project-1', INHERIT_TASK_DETAIL_PROVIDER_ID)
    expect(clearProjectConfig).toHaveBeenCalledWith('project-1', TASK_DETAIL_PROVIDER_CONFIG_KEY)
  })
})
