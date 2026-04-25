import { describe, expect, it, vi } from 'vitest'

import { PluginContextImpl } from './context'
import { getViewContributions, isPluginCommandContribution, isPluginViewContribution } from './helpers'
import { MAX_SUPPORTED_API_VERSION, validatePluginManifest } from './index'

describe('Plugin SDK', () => {
  describe('PluginContextImpl', () => {
    function makeContext() {
      return new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => 'host-result'),
        invokeBackend: vi.fn(async () => 'backend-result'),
        onEvent: vi.fn(() => () => {}),
        storageGet: vi.fn(async () => null),
        storageSet: vi.fn(async () => {}),
      })
    }

    it('exposes pluginId', () => {
      const ctx = makeContext()
      expect(ctx.pluginId).toBe('test-plugin')
    })

    it('calls invokeHostFn for invokeHost', async () => {
      const ctx = makeContext()
      const result = await ctx.invokeHost('getTasks', { projectId: 'p1' })
      expect(result).toBe('host-result')
    })

    it('calls invokeBackendFn for invokeBackend', async () => {
      const invokeBackend = vi.fn(async () => 'backend-result')
      const ctx = new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => null),
        invokeBackend,
        onEvent: vi.fn(() => () => {}),
        storageGet: vi.fn(async () => null),
        storageSet: vi.fn(async () => {}),
      })
      const result = await ctx.invokeBackend('myMethod', {})
      expect(result).toBe('backend-result')
      expect(invokeBackend).toHaveBeenCalledWith('myMethod', {})
    })

    it('returns unsubscribe from onEvent', () => {
      const ctx = makeContext()
      const unsub = ctx.onEvent('test', () => {})
      expect(typeof unsub).toBe('function')
    })

    it('storage.get delegates to storageGet', async () => {
      const storageGet = vi.fn(async () => 'stored-value')
      const ctx = new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => null),
        invokeBackend: vi.fn(async () => null),
        onEvent: vi.fn(() => () => {}),
        storageGet,
        storageSet: vi.fn(async () => {}),
      })
      const result = await ctx.storage.get('my-key')
      expect(result).toBe('stored-value')
      expect(storageGet).toHaveBeenCalledWith('my-key')
    })

    it('storage.set delegates to storageSet', async () => {
      const storageSet = vi.fn(async () => {})
      const ctx = new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => null),
        invokeBackend: vi.fn(async () => null),
        onEvent: vi.fn(() => () => {}),
        storageGet: vi.fn(async () => null),
        storageSet,
      })
      await ctx.storage.set('my-key', 'my-value')
      expect(storageSet).toHaveBeenCalledWith('my-key', 'my-value')
    })
  })

  describe('index re-exports', () => {
    it('re-exports plugin helpers from the SDK', () => {
      expect(typeof validatePluginManifest).toBe('function')
      expect(MAX_SUPPORTED_API_VERSION).toBeGreaterThan(0)
    })

    it('validates every supported contribution type from the manifest', () => {
      const errors = validatePluginManifest({
        id: 'com.openforge.demo',
        name: 'Demo Plugin',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Valid demo plugin',
        permissions: [],
        contributes: {
          views: [{ id: 'main', title: 'Main', icon: 'plug', shortcut: 'Cmd+Shift+M' }],
          taskPaneTabs: [{ id: 'activity', title: 'Activity', icon: 'sparkles', order: 10 }],
          sidebarPanels: [{ id: 'inspector', title: 'Inspector', side: 'right', order: 20 }],
          commands: [{ id: 'open-demo', title: 'Open Demo', shortcut: 'Cmd+Shift+O' }],
          settingsSections: [{ id: 'demo-settings', title: 'Demo Settings' }],
          backgroundServices: [{ id: 'sync', name: 'Sync Worker' }],
        },
        frontend: 'dist/index.js',
        backend: null,
      })

      expect(errors).toEqual([])
    })

    it('rejects malformed sidebar panels, commands, and settings sections', () => {
      const errors = validatePluginManifest({
        id: 'com.openforge.demo',
        name: 'Demo Plugin',
        version: '1.0.0',
        apiVersion: 1,
        description: 'Broken demo plugin',
        permissions: [],
        contributes: {
          sidebarPanels: [{ id: 'inspector', title: 'Inspector', side: 'center' }],
          commands: [{ id: 'open-demo', title: 'Open Demo', shortcut: 'not-a-shortcut' }],
          settingsSections: [{ id: '', title: 'Demo Settings' }],
        },
        frontend: 'dist/index.js',
        backend: null,
      })

      expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.sidebarPanels[0].side' }))
      expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.commands[0].shortcut' }))
      expect(errors).toContainEqual(expect.objectContaining({ path: 'contributes.settingsSections[0].id' }))
    })
  })

  describe('helpers', () => {
    it('isPluginViewContribution returns true for valid view', () => {
      expect(isPluginViewContribution({ id: 'v1', title: 'View', icon: 'plug' })).toBe(true)
    })

    it('isPluginViewContribution returns false for invalid', () => {
      expect(isPluginViewContribution(null)).toBe(false)
      expect(isPluginViewContribution({ id: 'v1' })).toBe(false)
    })

    it('isPluginCommandContribution returns true for valid command', () => {
      expect(isPluginCommandContribution({ id: 'c1', title: 'Command' })).toBe(true)
    })

    it('getViewContributions returns empty for undefined', () => {
      expect(getViewContributions(undefined)).toEqual([])
    })
  })
})
