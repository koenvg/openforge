import { beforeEach, describe, expect, it } from 'vitest'
import { get } from 'svelte/store'
import { upsertInstalledPlugin } from './pluginInstallState'
import { installedPlugins } from './pluginStore'

describe('pluginInstallState', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
  })

  it('upserts canonical plugin rows without optional source metadata', () => {
    upsertInstalledPlugin({
      id: 'legacy-plugin',
      name: 'Legacy Plugin',
      version: '1.0.0',
      apiVersion: 1,
      description: 'Legacy plugin without package metadata',
      permissions: '["shell"]',
      contributes: '{}',
      frontendEntry: 'index.js',
      backendEntry: null,
      installPath: '/tmp/legacy-plugin',
      isBuiltin: false,
    })

    expect(get(installedPlugins).get('legacy-plugin')).toMatchObject({
      manifest: {
        id: 'legacy-plugin',
        name: 'Legacy Plugin',
        permissions: ['shell'],
      },
      state: 'installed',
      error: null,
      installPath: '/tmp/legacy-plugin',
      isBuiltin: false,
      packageMetadata: null,
    })
  })
})
