import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OpenForgePackageMetadata } from '@openforge-app/plugin-sdk'

import {
  appEnabledPluginIds,
  defineFrontendPlugin,
  disablePluginForApp,
  get,
  getEnabledAppPluginsMock,
  getPluginRenderProps,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  makeNormalized,
  pluginBackendDeactivateMock,
  pluginBackendWhenReadyMock,
  registryLoadEnabledForApp,
  registryLoadEnabledForProject,
  resetPluginRegistryTestState,
  runtimeContributionSources,
  setAppPluginEnabledMock,
  updateAppPluginContexts,
} from './pluginRegistryTestSupport'
import { activeProjectId } from '../stores'

const metadata: OpenForgePackageMetadata = {
  id: 'account-usage',
  apiVersion: 1 as const,
  displayName: 'Account Usage',
  description: 'Account usage across OpenForge',
  enablement: 'app' as const,
  frontend: './frontend.js',
  backend: './backend.js',
  requires: ['views', 'backend', 'background', 'context', 'appEnablement'],
}

function appPluginRow() {
  return {
    ...makeNormalized('account-usage'),
    frontendEntry: './frontend.js',
    backendEntry: './backend.js',
    packageMetadata: JSON.stringify(metadata),
  }
}

describe('pluginRegistry app enablement', () => {
  beforeEach(() => {
    resetPluginRegistryTestState()
    activeProjectId.set(null)
  })

  it('activates once without a Project, survives Project changes, receives current context, and disposes once', async () => {
    const View = vi.fn() as never
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'usage',
          title: 'Account Usage',
          icon: 'chart-column-big',
          placement: 'sidebar',
          component: View,
        }))
      },
    })
    installedPlugins.set(new Map([['account-usage', {
      manifest: makeManifest({
        id: 'account-usage',
        frontend: './frontend.js',
        backend: './backend.js',
      }),
      packageMetadata: metadata,
      state: 'installed',
      error: null,
    }]]))
    getEnabledAppPluginsMock.mockResolvedValue([appPluginRow()])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'account-usage', module: frontendPlugin })

    await registryLoadEnabledForApp()
    activeProjectId.set('project-1')
    await registryLoadEnabledForProject('project-1')
    activeProjectId.set('project-2')
    await registryLoadEnabledForProject('project-2')
    await updateAppPluginContexts('project-2')

    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledTimes(2)
    expect(pluginBackendWhenReadyMock).toHaveBeenLastCalledWith('account-usage', 'project-2', true)
    expect(get(appEnabledPluginIds)).toEqual(new Set(['account-usage']))
    expect(get(runtimeContributionSources).get('account-usage')?.views).toHaveLength(1)
    const renderProps = getPluginRenderProps('account-usage', { projectId: 'project-2' })
    expect(renderProps.context.projectId).toBe('project-2')
    expect(renderProps.api.context.getSnapshot().projectId).toBe('project-2')

    await disablePluginForApp('account-usage')

    expect(setAppPluginEnabledMock).toHaveBeenCalledWith('account-usage', false)
    expect(pluginBackendDeactivateMock).toHaveBeenCalledTimes(1)
    expect(get(runtimeContributionSources).has('account-usage')).toBe(false)
  })
})
