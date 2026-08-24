import { describe, expect, it, vi } from 'vitest'
import { handleElectronInvoke } from './backendBridge'
import { sidecarConfig } from './backendBridge.testUtils'

describe('Electron backend bridge shell commands', () => {
  it('keeps open_url shell-owned and does not forward it to the Rust sidecar', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'open_url', payload: { url: 'https://github.com' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal },
    )).resolves.toBeNull()

    expect(openExternal).toHaveBeenCalledWith('https://github.com')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps open_in_editor shell-owned and opens VS Code at the path', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'open_in_editor', payload: { path: '/Users/me/proj' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal },
    )).resolves.toBeNull()

    expect(openExternal).toHaveBeenCalledWith('vscode://file/Users/me/proj')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports whether VS Code handles vscode URLs without involving the sidecar', async () => {
    const fetch = vi.fn()
    const getApplicationNameForProtocol = vi.fn(() => 'Visual Studio Code')

    await expect(handleElectronInvoke(
      { command: 'has_vscode_protocol_handler', payload: null },
      {
        sidecarConfig: sidecarConfig(),
        fetch,
        openExternal: vi.fn(),
        getApplicationNameForProtocol,
      },
    )).resolves.toBe(true)

    expect(getApplicationNameForProtocol).toHaveBeenCalledWith('vscode:')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['', '   '])('reports no VS Code protocol handler for application name %p', async (applicationName) => {
    const getApplicationNameForProtocol = vi.fn(() => applicationName)
    await expect(handleElectronInvoke(
      { command: 'has_vscode_protocol_handler', payload: null },
      { sidecarConfig: sidecarConfig(), fetch: vi.fn(), openExternal: vi.fn(), getApplicationNameForProtocol },
    )).resolves.toBe(false)
    expect(getApplicationNameForProtocol).toHaveBeenCalledWith('vscode:')
  })

  it('keeps quit_app shell-owned so Electron before-quit shutdown cleanup runs', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const quitApp = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'quit_app', payload: null },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, quitApp },
    )).resolves.toBeUndefined()

    expect(quitApp).toHaveBeenCalledTimes(1)
    expect(openExternal).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps clipboard writes shell-owned and does not forward them to the Rust sidecar', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const writeClipboardText = vi.fn(async () => undefined)

    await expect(handleElectronInvoke(
      { command: 'write_clipboard_text', payload: { text: '/repo/T-42' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, writeClipboardText },
    )).resolves.toBeUndefined()

    expect(writeClipboardText).toHaveBeenCalledWith('/repo/T-42')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps developer log snapshots shell-owned and returns the file-backed tail', async () => {
    const fetch = vi.fn()
    const getDeveloperLogSnapshot = vi.fn(() => ({
      entries: [{
        id: 1,
        timestamp: '2026-07-03T12:00:00.000Z',
        level: 'info' as const,
        message: '[electron] ready',
      }],
      logFilePath: '/tmp/openforge.log',
      totalEntries: 1,
    }))

    await expect(handleElectronInvoke(
      { command: 'get_developer_log_snapshot', payload: { limit: 1000 } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), getDeveloperLogSnapshot },
    )).resolves.toEqual({
      entries: [expect.objectContaining({ message: '[electron] ready' })],
      logFilePath: '/tmp/openforge.log',
      totalEntries: 1,
    })

    expect(getDeveloperLogSnapshot).toHaveBeenCalledWith(1000)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps developer logs shell-owned and passes through an explicit log limit', async () => {
    const fetch = vi.fn()
    const getDeveloperLogs = vi.fn(() => [{
      id: 1,
      timestamp: '2026-07-03T12:00:00.000Z',
      level: 'info' as const,
      message: '[electron] ready',
    }])

    await expect(handleElectronInvoke(
      { command: 'get_developer_logs', payload: { limit: 1 } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal: vi.fn(), getDeveloperLogs },
    )).resolves.toEqual([
      expect.objectContaining({ message: '[electron] ready' }),
    ])

    expect(getDeveloperLogs).toHaveBeenCalledWith(1)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('keeps select_directory shell-owned so macOS folder access is granted through Electron', async () => {
    const fetch = vi.fn()
    const openExternal = vi.fn(async () => undefined)
    const selectDirectory = vi.fn(async () => '/Users/koen/Documents/openforge test project')

    await expect(handleElectronInvoke(
      { command: 'select_directory', payload: { defaultPath: '/Users/koen/Documents/openforge test project' } },
      { sidecarConfig: sidecarConfig(), fetch, openExternal, selectDirectory },
    )).resolves.toBe('/Users/koen/Documents/openforge test project')

    expect(selectDirectory).toHaveBeenCalledWith({
      defaultPath: '/Users/koen/Documents/openforge test project',
      buttonLabel: undefined,
      message: undefined,
    })
    expect(fetch).not.toHaveBeenCalled()
  })

})
