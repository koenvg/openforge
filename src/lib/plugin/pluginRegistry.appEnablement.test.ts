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
} from './pluginRegistryTestSupport'
import { activeProjectId } from '../stores'

const metadata: OpenForgePackageMetadata = {
  id: 'account-usage',
  apiVersion: 1 as const,
  displayName: 'Account Usage',
  description: 'Account usage across OpenForge',
  enablement: 'app' as const,
  frontend: './frontend.js',
  backend: './backend.cjs',
  requires: ['views', 'backend', 'background', 'context', 'appEnablement'],
}

function appPluginRow() {
  return {
    ...makeNormalized('account-usage'),
    frontendEntry: './frontend.js',
    backendEntry: './backend.cjs',
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
    const contextChanges: Array<string | null> = []
    const frontendPlugin = defineFrontendPlugin({
      activate(openforge, context) {
        context.subscriptions.add(openforge.views.register({
          id: 'usage',
          title: 'Account Usage',
          icon: 'chart-column-big',
          placement: 'sidebar',
          component: View,
        }))
        context.subscriptions.add(context.onDidChange((snapshot) => {
          contextChanges.push(snapshot.projectId)
        }))
      },
    })
    installedPlugins.set(new Map([['account-usage', {
      manifest: makeManifest({
        id: 'account-usage',
        frontend: './frontend.js',
        backend: './backend.cjs',
      }),
      packageMetadata: metadata,
      state: 'installed',
      error: null,
    }]]))
    getEnabledAppPluginsMock.mockResolvedValue([appPluginRow()])
    loadPluginFrontendMock.mockResolvedValue({ pluginId: 'account-usage', module: frontendPlugin })

    await registryLoadEnabledForApp()

    let releaseFirstContextUpdate: (() => void) | undefined
    pluginBackendWhenReadyMock.mockImplementation((_pluginId, projectId, forceContextUpdate) => {
      if (projectId === 'project-1' && forceContextUpdate) {
        return new Promise<void>((resolve) => {
          releaseFirstContextUpdate = resolve
        })
      }
      return Promise.resolve()
    })

    activeProjectId.set('project-1')
    const firstProjectTransition = registryLoadEnabledForProject('project-1')
    await vi.waitFor(() => {
      expect(pluginBackendWhenReadyMock).toHaveBeenCalledWith('account-usage', 'project-1', true)
    })

    activeProjectId.set('project-2')
    const secondProjectTransition = registryLoadEnabledForProject('project-2')
    await Promise.resolve()
    expect(pluginBackendWhenReadyMock).not.toHaveBeenCalledWith('account-usage', 'project-2', true)

    releaseFirstContextUpdate?.()
    await Promise.all([firstProjectTransition, secondProjectTransition])

    expect(loadPluginFrontendMock).toHaveBeenCalledTimes(1)
    expect(pluginBackendWhenReadyMock).toHaveBeenCalledTimes(3)
    expect(pluginBackendWhenReadyMock).toHaveBeenLastCalledWith('account-usage', 'project-2', true)
    expect(get(appEnabledPluginIds)).toEqual(new Set(['account-usage']))
    expect(get(runtimeContributionSources).get('account-usage')?.views).toHaveLength(1)
    const renderProps = getPluginRenderProps('account-usage', { projectId: 'project-2' })
    expect(renderProps.context.projectId).toBe('project-2')
    expect(renderProps.api.context.getSnapshot().projectId).toBe('project-2')
    expect(contextChanges).toEqual(['project-1', 'project-2'])

    activeProjectId.set(null)
    await registryLoadEnabledForProject(null)

    expect(pluginBackendWhenReadyMock).toHaveBeenCalledTimes(4)
    expect(pluginBackendWhenReadyMock).toHaveBeenLastCalledWith('account-usage', null, true)
    expect(get(runtimeContributionSources).get('account-usage')?.views).toHaveLength(1)
    expect(contextChanges).toEqual(['project-1', 'project-2', null])

    await disablePluginForApp('account-usage')

    expect(setAppPluginEnabledMock).toHaveBeenCalledWith('account-usage', false)
    expect(pluginBackendDeactivateMock).toHaveBeenCalledTimes(1)
    expect(get(runtimeContributionSources).has('account-usage')).toBe(false)
  })
})
