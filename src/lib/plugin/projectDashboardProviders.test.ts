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
  CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
  PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
  clearProjectDashboardProviderIds,
  globalProjectDashboardProviderId,
  loadGlobalProjectDashboardProviderId,
  loadProjectDashboardProviderId,
  parseGlobalProjectDashboardProviderId,
  parseProjectDashboardProviderId,
  projectDashboardProviderIds,
  resolveProjectDashboardProviderAvailability,
  setGlobalProjectDashboardProviderId,
  setProjectDashboardProviderId,
} from './projectDashboardProviders'

const planningProvider: ResolvedViewReplacement = {
  pluginId: 'planning-plugin',
  contributionId: 'dashboard',
  qualifiedId: 'planning-plugin.dashboard',
  target: 'project.dashboard',
  title: 'Planning',
  icon: 'panels-top-left',
}

function registerPlanningDashboard(): void {
  registerRenderableContributionComponent(
    'viewReplacements',
    'planning-plugin:dashboard',
    vi.fn() as never,
  )
}

describe('project dashboard provider preferences', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearProjectDashboardProviderIds()
    clearComponentRegistry()
    getConfig.mockResolvedValue(null)
    getProjectConfig.mockResolvedValue(null)
    setConfig.mockResolvedValue(undefined)
    setProjectConfig.mockResolvedValue(undefined)
    clearProjectConfig.mockResolvedValue(undefined)
  })

  it('defaults the app to OpenForge and projects to inheritance', () => {
    expect(PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY).toBe('project_dashboard_provider')
    expect(parseGlobalProjectDashboardProviderId(null)).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(parseProjectDashboardProviderId(null)).toBe(INHERIT_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(parseGlobalProjectDashboardProviderId('bad provider')).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(parseProjectDashboardProviderId('bad provider')).toBe(INHERIT_PROJECT_DASHBOARD_PROVIDER_ID)
  })

  it('applies the project override before the global default', () => {
    registerPlanningDashboard()
    const pluginEntries = new Map([['planning-plugin', { state: 'active' }]])

    expect(resolveProjectDashboardProviderAvailability(
      CORE_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toMatchObject({
      projectPreferenceId: CORE_PROJECT_DASHBOARD_PROVIDER_ID,
      configuredId: CORE_PROJECT_DASHBOARD_PROVIDER_ID,
      provider: null,
      unavailableReason: null,
    })

    expect(resolveProjectDashboardProviderAvailability(
      INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toMatchObject({
      projectPreferenceId: INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      configuredId: planningProvider.qualifiedId,
      provider: planningProvider,
      unavailableReason: null,
    })
  })

  it('falls back to OpenForge until the configured contribution is active and renderable', () => {
    const pluginEntries = new Map<string, { state: string }>()

    expect(resolveProjectDashboardProviderAvailability(
      INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [],
      pluginEntries,
    )).toMatchObject({
      configuredId: planningProvider.qualifiedId,
      provider: null,
      unavailableReason: 'missing-contribution',
    })

    expect(resolveProjectDashboardProviderAvailability(
      INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toMatchObject({
      configuredProvider: planningProvider,
      provider: null,
      unavailableReason: 'inactive-plugin',
    })

    pluginEntries.set('planning-plugin', { state: 'active' })
    expect(resolveProjectDashboardProviderAvailability(
      INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toMatchObject({ provider: null, unavailableReason: 'missing-component' })

    registerPlanningDashboard()
    expect(resolveProjectDashboardProviderAvailability(
      INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
      planningProvider.qualifiedId,
      [planningProvider],
      pluginEntries,
    )).toMatchObject({ provider: planningProvider, unavailableReason: null })
  })

  it('loads and saves the global default through typed config wrappers', async () => {
    getConfig.mockResolvedValue(planningProvider.qualifiedId)

    await expect(loadGlobalProjectDashboardProviderId()).resolves.toBe(planningProvider.qualifiedId)
    expect(getConfig).toHaveBeenCalledWith(PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY)
    expect(get(globalProjectDashboardProviderId)).toBe(planningProvider.qualifiedId)

    await setGlobalProjectDashboardProviderId(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(setConfig).toHaveBeenCalledWith(
      PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
      CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    )
    expect(get(globalProjectDashboardProviderId)).toBe(CORE_PROJECT_DASHBOARD_PROVIDER_ID)
  })

  it('persists qualified project overrides and clears only the inheriting project override', async () => {
    projectDashboardProviderIds.set(new Map([['project-2', planningProvider.qualifiedId]]))

    await setProjectDashboardProviderId('project-1', planningProvider.qualifiedId)
    expect(setProjectConfig).toHaveBeenCalledWith(
      'project-1',
      PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY,
      planningProvider.qualifiedId,
    )

    await setProjectDashboardProviderId('project-1', INHERIT_PROJECT_DASHBOARD_PROVIDER_ID)
    expect(clearProjectConfig).toHaveBeenCalledWith('project-1', PROJECT_DASHBOARD_PROVIDER_CONFIG_KEY)
    expect(get(projectDashboardProviderIds)).toEqual(new Map([
      ['project-2', planningProvider.qualifiedId],
      ['project-1', INHERIT_PROJECT_DASHBOARD_PROVIDER_ID],
    ]))
  })

  it('retains unavailable stored identities without rewriting them', async () => {
    getConfig.mockResolvedValue('missing-plugin.dashboard')
    getProjectConfig.mockResolvedValue('missing-project-plugin.dashboard')

    await expect(loadGlobalProjectDashboardProviderId()).resolves.toBe('missing-plugin.dashboard')
    await expect(loadProjectDashboardProviderId('project-1')).resolves.toBe('missing-project-plugin.dashboard')

    expect(get(globalProjectDashboardProviderId)).toBe('missing-plugin.dashboard')
    expect(get(projectDashboardProviderIds).get('project-1')).toBe('missing-project-plugin.dashboard')
    expect(setConfig).not.toHaveBeenCalled()
    expect(setProjectConfig).not.toHaveBeenCalled()
    expect(clearProjectConfig).not.toHaveBeenCalled()
  })
})
