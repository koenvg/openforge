import { beforeEach, describe, expect, it } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { resetTerminalRuntimeMocks } from './terminalRuntimeFeatures.testSupport'
import {
  INLINE_IMAGE_COMPATIBILITY_REPLAY,
  createFakeTerminalView,
} from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal snapshot ordering', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('restores bounded raw compatibility state before the authoritative Ghostty snapshot', async () => {
    const shellSessionKey = 'T-ghostty-shell-0'
    const compatibilityReplay = INLINE_IMAGE_COMPATIBILITY_REPLAY
    const view = createFakeTerminalView()
    const host = createHost()
    host.getPtyBuffer = async () => ({
      buffer: null,
      snapshot: {
        instanceId: 61,
        watermark: 0,
        data: btoa('rendered by xterm'),
        compatibilityData: btoa(compatibilityReplay),
      },
      isLive: true,
      instanceId: 61,
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    const entry = await runtime.acquire(shellSessionKey)

    expect(entry.currentPtyInstance).toBe(61)
    expect(view.bootstrap).toHaveBeenNthCalledWith(
      1,
      Uint8Array.from(new TextEncoder().encode(compatibilityReplay)),
      61,
      0,
    )
    expect(view.bootstrap).toHaveBeenNthCalledWith(
      2,
      Uint8Array.from(new TextEncoder().encode('rendered by xterm')),
      61,
      0,
    )
  })
})
