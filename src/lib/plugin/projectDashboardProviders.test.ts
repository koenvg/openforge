import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getProjectConfig, setProjectConfig } = vi.hoisted(() => ({
  getProjectConfig: vi.fn(),
  setProjectConfig: vi.fn(),
}))

vi.mock('../ipc', () => ({ getProjectConfig, setProjectConfig }))
import {
  CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
  clearProjectDashboardProviderIds,
  loadProjectDashboardProviderId,
  projectDashboardProviderIds,
  setProjectDashboardProviderId,
  parseProjectDashboardProviderId,
  resolveProjectDashboardProvider,
  resolveProjectDashboardProviderAvailability,
} from './projectDashboardProviders'
import type { ResolvedViewReplacement } from './contributionResolver'
import { clearComponentRegistry, registerRenderableContributionComponent } from './componentRegistry'
import { get } from 'svelte/store'

const planningProvider: ResolvedViewReplacement = {
  pluginId: 'planning-plugin',
  contributionId: 'dashboard',
  qualifiedId: 'planning-plugin.dashboard',
  target: 'project.dashboard',
  title: 'Planning',
  icon: 'panels-top-left',
}

describe('project dashboard provider preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProjectDashboardProviderIds()
    clearComponentRegistry()
    getProjectConfig.mockResolvedValue(null)
    setProjectConfig.mockResolvedValue(undefined)
  })

  it('defaults missing and invalid values to the core OpenForge provider', () => {
    expect(PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY).toBe('project_dashboard_provider')
    expect(parseProjectDashboardProviderId(null)).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(parseProjectDashboardProviderId('')).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(parseProjectDashboardProviderId('bad provider')).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
  })

  it('resolves a selected compatible provider without selecting one merely because it exists', () => {
    expect(resolveProjectDashboardProvider(CORE_PROJECT_DASHBOARD_PROVIDER_ID, [planningProvider])).toEqual({
      configuredId: CORE_PROJECT_DASHBOARD_PROVIDER_ID,
      provider: null,
    })
    expect(resolveProjectDashboardProvider(planningProvider.qualifiedId, [planningProvider])).toEqual({
      configuredId: planningProvider.qualifiedId,
      provider: planningProvider,
    })
  })

  it('uses component and plugin runtime availability in the effective provider result', () => {
    const pluginEntries = new Map([['planning-plugin', { state: 'active' }]])

    expect(resolveProjectDashboardProviderAvailability(
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toEqual({
      configuredId: planningProvider.qualifiedId,
      configuredProvider: planningProvider,
      provider: null,
      unavailableReason: 'missing-component',
    })

    registerRenderableContributionComponent(
      'viewReplacements',
      'planning-plugin:dashboard',
      vi.fn() as never,
    )
    expect(resolveProjectDashboardProviderAvailability(
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    ).provider).toBe(planningProvider)

    pluginEntries.set('planning-plugin', { state: 'error' })
    expect(resolveProjectDashboardProviderAvailability(
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    ).unavailableReason).toBe('plugin-error')
  })

  it('falls back to core while retaining a missing or target-mismatched provider id', () => {
    expect(resolveProjectDashboardProvider('missing.dashboard', [planningProvider])).toEqual({
      configuredId: 'missing.dashboard',
      provider: null,
    })
    expect(resolveProjectDashboardProvider(planningProvider.qualifiedId, [
      { ...planningProvider, target: 'task.detail' as never },
    ])).toEqual({
      configuredId: planningProvider.qualifiedId,
      provider: null,
    })
  })

  it('loads and saves the project-owned selection through typed config wrappers', async () => {
    getProjectConfig.mockResolvedValue('planning-plugin.dashboard')
    await expect(loadProjectDashboardProviderId('project-1')).resolves.toBe('planning-plugin.dashboard')
    expect(getProjectConfig).toHaveBeenCalledWith('project-1', PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY)
    expect(get(projectDashboardProviderIds).get('project-1')).toBe('planning-plugin.dashboard')

    await setProjectDashboardProviderId('project-1', CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(setProjectConfig).toHaveBeenCalledWith(
      'project-1',
      PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
      CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    )
    expect(get(projectDashboardProviderIds).get('project-1')).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
  })
})
