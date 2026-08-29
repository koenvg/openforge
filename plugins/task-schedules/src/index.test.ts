import { describe, expect, it } from 'vitest'
import { OPENFORGE_FRONTEND_PLUGIN_MARKER } from '@openforge-app/plugin-sdk/frontend'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { isOpenForgePackageMetadata } from '@openforge-app/plugin-sdk'
import packageJson from '../package.json'
import plugin from './index'

describe('Task Schedules frontend plugin', () => {
  it('declares trusted built-in plugin metadata with frontend and backend entries', () => {
    expect(isOpenForgePackageMetadata(packageJson.openforge)).toBe(true)
    expect(packageJson.openforge).toMatchObject({
      id: 'com.openforge.task-schedules',
      displayName: 'Task Schedules',
      frontend: './dist/frontend.js',
      backend: './dist/backend.mjs',
    })
    expect(packageJson.openforge.requires).toEqual(expect.arrayContaining(['views', 'backend', 'background', 'commands', 'storage', 'navigation', 'tasks']))
  })

  it('registers the Task Schedules rail view with shortcut metadata for host navigation', async () => {
    const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.task-schedules', projectId: 'P-1' })

    await registry.activateFrontend(plugin)

    expect(plugin[OPENFORGE_FRONTEND_PLUGIN_MARKER]).toBe(true)
    expect(registry.snapshot.views).toMatchObject([
      {
        id: 'schedules',
        qualifiedId: 'com.openforge.task-schedules.schedules',
        title: 'Task Schedules',
        pluginId: 'com.openforge.task-schedules',
        placement: 'rail',
        shortcut: 'Cmd+S',
      },
    ])
  })
})
