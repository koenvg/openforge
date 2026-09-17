import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { listenPluginDesktopEventMock } = vi.hoisted(() => ({
  listenPluginDesktopEventMock: vi.fn(),
}))

vi.mock('../desktopIpc', () => ({
  listenPluginDesktopEvent: listenPluginDesktopEventMock,
}))

import {
  clearPluginHostSubscriptions,
  subscribeToPluginHostEvent,
  waitForPluginHostEventSubscription,
} from './pluginHostEvents'

const pluginId = 'com.openforge.contract-test'

afterEach(() => {
  clearPluginHostSubscriptions(pluginId)
  listenPluginDesktopEventMock.mockReset()
})

describe('plugin desktop event channels', () => {
  it('passes the plugin channel and producer payload through the real subscription path', async () => {
    const unlisten = vi.fn()
    let relay: ((event: { payload: unknown }) => void) | undefined
    listenPluginDesktopEventMock.mockImplementation(async (_eventName, handler) => {
      relay = handler
      return unlisten
    })
    const handler = vi.fn()

    const unsubscribe = subscribeToPluginHostEvent(pluginId, 'plugin:sidecar-exited', handler)

    await vi.waitFor(() => {
      expect(listenPluginDesktopEventMock).toHaveBeenCalledWith(
        'plugin:sidecar-exited',
        expect.any(Function),
      )
    })

    const payload = { code: 0, signal: null, pid: 42, retry_attempts: 0 }
    relay?.({ payload })
    expect(handler).toHaveBeenCalledWith(payload)

    unsubscribe()
    expect(unlisten).toHaveBeenCalledOnce()

    const producerSource = readFileSync(
      resolve(process.cwd(), 'src-tauri/src/plugin_host/lifecycle.rs'),
      'utf8',
    )
    expect(producerSource).toContain('const SIDECAR_EXITED_EVENT: &str = "plugin:sidecar-exited"')
    expect(producerSource).toContain('self.publish_sidecar_event(SIDECAR_EXITED_EVENT, &payload)')
    expect(producerSource).toContain('let payload = SidecarExitPayload {')
  })

  it('keeps a replacement listener subscribed when registration is still pending', async () => {
    const unlisten = vi.fn()
    let relay: ((event: { payload: unknown }) => void) | undefined
    let resolveRegistration!: (unlisten: () => void) => void
    listenPluginDesktopEventMock.mockImplementation((_eventName, handler) => {
      relay = handler
      return new Promise(resolve => { resolveRegistration = resolve })
    })
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()

    const unsubscribeFirst = subscribeToPluginHostEvent(pluginId, 'pty-output-scoped-key', firstHandler)
    unsubscribeFirst()
    const unsubscribeSecond = subscribeToPluginHostEvent(pluginId, 'pty-output-scoped-key', secondHandler)
    resolveRegistration(unlisten)
    await waitForPluginHostEventSubscription('pty-output-scoped-key')

    relay?.({ payload: { data: 'after registration' } })
    expect(firstHandler).not.toHaveBeenCalled()
    expect(secondHandler).toHaveBeenCalledWith({ data: 'after registration' })
    expect(unlisten).not.toHaveBeenCalled()

    unsubscribeSecond()
    expect(unlisten).toHaveBeenCalledOnce()
  })
})
