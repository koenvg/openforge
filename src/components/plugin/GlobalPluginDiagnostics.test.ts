import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { writeClipboardText } from '../../lib/ipc'
import { appEnabledPluginIds, enabledPluginIds, error as pluginLoadError } from '../../lib/plugin/pluginStore'
import type { PluginEntry } from '../../lib/plugin/types'
import GlobalPluginDiagnostics from './GlobalPluginDiagnostics.svelte'

vi.mock('../../lib/ipc', () => ({ writeClipboardText: vi.fn() }))

const plugin: PluginEntry = {
  manifest: {
    id: 'com.example.paper', name: 'Paper', version: '1.0.0', apiVersion: 1,
    description: 'Paper themes', permissions: [], frontend: 'index.js', backend: null,
  },
  packageMetadata: {
    id: 'com.example.paper', displayName: 'Paper', apiVersion: 1, description: 'Paper themes',
    frontend: 'index.js', enablement: 'app', requires: ['appEnablement', 'themes'],
  },
  state: 'error', error: 'Theme activation failed', sourceKind: 'local', installPath: '/plugins/paper',
}

beforeEach(() => {
  vi.resetAllMocks()
  appEnabledPluginIds.set(new Set([plugin.manifest.id]))
  enabledPluginIds.set(new Set())
  pluginLoadError.set(null)
})

describe('plugin diagnostics controls', () => {
  it('copies ownership, enablement, source, and failure details without requiring an active project', async () => {
    render(GlobalPluginDiagnostics, { plugin })
    await fireEvent.click(screen.getByRole('button', { name: 'Copy diagnostics: Paper' }))

    const diagnostics = JSON.parse(vi.mocked(writeClipboardText).mock.calls[0][0])
    expect(diagnostics).toMatchObject({
      pluginId: 'com.example.paper', name: 'Paper', enablement: 'app', enabledForApp: true,
      enabledForActiveProject: false, activeProjectId: null, state: 'error',
      error: 'Theme activation failed', sourceKind: 'local', installPath: '/plugins/paper',
    })
  })

  it('reports clipboard failure and clears it when the user retries', async () => {
    vi.mocked(writeClipboardText).mockRejectedValueOnce(new Error('Clipboard unavailable')).mockResolvedValueOnce(undefined)
    const onActionError = vi.fn()
    render(GlobalPluginDiagnostics, { plugin, onActionError })
    const copy = screen.getByRole('button', { name: 'Copy diagnostics: Paper' })
    await fireEvent.click(copy)
    expect(onActionError).toHaveBeenLastCalledWith('Failed to copy diagnostics: Clipboard unavailable')

    await fireEvent.click(copy)
    expect(onActionError).toHaveBeenLastCalledWith(null)
    expect(writeClipboardText).toHaveBeenCalledTimes(2)
  })

  it('does not copy diagnostics while disabled', async () => {
    render(GlobalPluginDiagnostics, { plugin, disabled: true })
    const copy = screen.getByRole('button', { name: 'Copy diagnostics: Paper' }) as HTMLButtonElement
    expect(copy.disabled).toBe(true)
    await fireEvent.click(copy)
    expect(writeClipboardText).not.toHaveBeenCalled()
  })
})
