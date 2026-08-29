import { beforeEach, describe, expect, it } from 'vitest'
import {
  activatePluginLoaderMock,
  enabledPluginIds,
  executePluginCommand,
  get,
  installedPlugins,
  loadPluginFrontendMock,
  makeManifest,
  pluginInvokeMock,
  resetPluginRegistryTestState,
} from './pluginRegistryTestSupport'

describe('pluginRegistry command execution', () => {
  beforeEach(resetPluginRegistryTestState)

  it('does not synthesize backend command handlers from legacy manifest contributions', async () => {
    const manifest = makeManifest({ frontend: null, backend: 'backend.cjs' })
    installedPlugins.set(new Map([['backend-plugin', { manifest: { ...manifest, id: 'backend-plugin' }, state: 'installed', error: null }]]))
    enabledPluginIds.set(new Set(['backend-plugin']))
    pluginInvokeMock.mockResolvedValue({ echoed: true })

    await expect(executePluginCommand('backend-plugin', 'echo', { message: 'hello' })).resolves.toBe(false)

    expect(loadPluginFrontendMock).not.toHaveBeenCalled()
    expect(activatePluginLoaderMock).not.toHaveBeenCalled()
    expect(pluginInvokeMock).not.toHaveBeenCalled()
    expect(get(installedPlugins).get('backend-plugin')?.state).toBe('active')
  })
})
