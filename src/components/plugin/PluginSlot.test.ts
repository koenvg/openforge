import { render } from '@testing-library/svelte'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import PluginSlot from './PluginSlot.svelte'
import { installedPlugins, enabledPluginIds } from '../../lib/plugin/pluginStore'
import type { PluginEntry, PluginManifest } from '../../lib/plugin/types'

vi.mock('../../lib/plugin/pluginLoader', () => ({
  mountPluginComponent: vi.fn(),
  unmountPluginComponent: vi.fn(),
  getLoadedPlugin: vi.fn()
}))

describe('PluginSlot', () => {
  beforeEach(() => {
    installedPlugins.set(new Map())
    enabledPluginIds.set(new Set())
    vi.clearAllMocks()
  })

  it('renders nothing for empty slot', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    const div = container.querySelector('div')
    expect(div).toBeTruthy()
    expect(div?.children.length).toBe(0)
    expect(div?.getAttribute('data-slot-type')).toBe('views')
  })

  it('renders container with data attributes', () => {
    const { container } = render(PluginSlot, { props: { slotType: 'sidebarPanels', slotId: 'panel-1' } })
    const div = container.querySelector('div')
    expect(div?.getAttribute('data-slot-type')).toBe('sidebarPanels')
    expect(div?.getAttribute('data-slot-id')).toBe('panel-1')
  })

  it('handles slot with no contributions', async () => {
    const manifest: PluginManifest = {
      id: 'test-plugin',
      name: 'Test',
      version: '1.0.0',
      apiVersion: 1,
      description: 'Test plugin',
      permissions: [],
      contributes: {},
      frontend: 'index.js',
      backend: null,
    }

    const entry: PluginEntry = {
      manifest,
      state: 'installed',
      error: null,
    }

    installedPlugins.set(new Map([['test-plugin', entry]]))
    enabledPluginIds.set(new Set(['test-plugin']))

    const { container } = render(PluginSlot, { props: { slotType: 'views' } })
    await new Promise(r => setTimeout(r, 10))
    const div = container.querySelector('div')
    expect(div?.children.length).toBe(0)
  })
})
