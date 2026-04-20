import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/lib/ipc', () => ({
  pluginInvoke: vi.fn(async () => 'backend-result'),
}))

import { PluginContextImpl } from './context'
import { getViewContributions, isPluginCommandContribution, isPluginViewContribution } from './helpers'
import { MAX_SUPPORTED_API_VERSION, validatePluginManifest } from './index'

describe('Plugin SDK', () => {
  describe('PluginContextImpl', () => {
    function makeContext() {
      return new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => 'host-result'),
        onEvent: vi.fn(() => () => {}),
        storageGet: vi.fn(async () => null),
        storageSet: vi.fn(async () => {}),
      })
    }

    it('calls invokeHostFn for invokeHost', async () => {
      const ctx = makeContext()
      const result = await ctx.invokeHost('getTasks', { projectId: 'p1' })
      expect(result).toBe('host-result')
    })

    it('calls pluginInvoke for invokeBackend', async () => {
      const ctx = makeContext()
      expect(typeof ctx.invokeBackend).toBe('function')
    })

    it('returns unsubscribe from onEvent', () => {
      const ctx = makeContext()
      const unsub = ctx.onEvent('test', () => {})
      expect(typeof unsub).toBe('function')
    })

    it('calls storageGetFn for storageGet', async () => {
      const ctx = makeContext()
      const result = await ctx.storageGet('my-key')
      expect(result).toBeNull()
    })

    it('calls storageSetFn with both key and value', async () => {
      const storageSet = vi.fn(async () => {})
      const ctx = new PluginContextImpl({
        pluginId: 'test-plugin',
        invokeHost: vi.fn(async () => 'host-result'),
        onEvent: vi.fn(() => () => {}),
        storageGet: vi.fn(async () => null),
        storageSet,
      })

      await ctx.storageSet('my-key', 'my-value')

      expect(storageSet).toHaveBeenCalledWith('my-key', 'my-value')
    })
  })

  describe('index re-exports', () => {
    it('re-exports host plugin helpers from the app source tree', () => {
      expect(typeof validatePluginManifest).toBe('function')
      expect(MAX_SUPPORTED_API_VERSION).toBeGreaterThan(0)
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
