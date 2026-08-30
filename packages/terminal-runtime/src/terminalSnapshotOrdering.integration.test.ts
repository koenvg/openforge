import { beforeEach, describe, expect, it, vi } from 'vitest'
import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
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
    expect(view.replaceSnapshot).not.toHaveBeenCalled()

    await attachTestTerminal(runtime, entry)

    expect(view.replaceSnapshot).toHaveBeenCalledOnce()
    expect(view.replaceSnapshot).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('rendered by xterm')),
      compatibilityData: Uint8Array.from(new TextEncoder().encode(compatibilityReplay)),
      ptyInstanceId: 61,
      sequence: 0,
    })
  })

  it('queues live output until authoritative snapshot replacement finishes', async () => {
    const shellSessionKey = 'T-snapshot-barrier-shell-0'
    let finishReplacement!: () => void
    const replacement = new Promise<void>(resolve => { finishReplacement = resolve })
    const view = createFakeTerminalView({
      replaceSnapshot: vi.fn(() => replacement),
    })
    const host = createHost()
    host.setBuffer(shellSessionKey, 'snapshot')
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const entry = await runtime.acquire(shellSessionKey)

    const attachment = attachTestTerminal(runtime, entry)
    await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledOnce())
    host.emit(`pty-model-output-${shellSessionKey}`, {
      data: btoa('live after snapshot'),
      instance_id: 1,
      sequence: 1,
    })

    expect(view.writeLive).not.toHaveBeenCalled()

    finishReplacement()
    await attachment

    expect(view.writeLive).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('live after snapshot')),
      ptyInstanceId: 1,
      sequence: 1,
    })
  })
})
