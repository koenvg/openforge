import { describe, expect, it, vi } from 'vitest'
import { validatePluginManifest } from '@openforge/plugin-sdk'
import manifest from '../manifest.json'

const { mockTerminalTaskPane } = vi.hoisted(() => ({
  mockTerminalTaskPane: { name: 'TerminalTaskPaneComponent' },
}))

vi.mock('./TerminalTaskPane.svelte', () => ({
  default: mockTerminalTaskPane,
}))

describe('terminal plugin', () => {
  it('has a valid manifest', () => {
    const errors = validatePluginManifest(manifest)
    expect(errors).toEqual([])
  })

  it('activates task pane and background service implementations', async () => {
    const { activate } = await import('./index')
    const result = await activate({
      pluginId: 'test-plugin',
      invokeHost: async () => null,
      invokeBackend: async () => null,
      onEvent: () => () => {},
      storage: { get: async () => null, set: async () => {} },
    })
    expect(result.contributions.taskPaneTabs).toHaveLength(1)
    expect(result.contributions.taskPaneTabs?.[0]).toMatchObject({
      id: 'terminal',
      component: mockTerminalTaskPane,
    })
    expect(result.contributions.backgroundServices).toHaveLength(1)
    expect(result.contributions.backgroundServices?.[0]?.id).toBe('pty-manager')
  })

  it('deactivates without error', async () => {
    const { deactivate } = await import('./index')
    await expect(deactivate()).resolves.toBeUndefined()
  })
})
