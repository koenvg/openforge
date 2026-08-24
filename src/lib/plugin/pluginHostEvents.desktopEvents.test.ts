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
})
