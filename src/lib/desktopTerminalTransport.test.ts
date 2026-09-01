import { describe, expect, it, vi } from 'vitest'
import { createDesktopTerminalTransport, type DesktopTerminalTransportPort } from './desktopTerminalTransport'

function createPort(): DesktopTerminalTransportPort {
  return {
    listenEvent: vi.fn(async () => () => undefined),
    getPtyBuffer: vi.fn(async () => ({
      buffer: null,
      isLive: true,
      instanceId: 7,
      snapshot: {
        data: btoa('captured authority'),
        instanceId: 7,
        watermark: 12,
      },
    })),
    writePty: vi.fn(async () => undefined),
    resizePty: vi.fn(async () => undefined),
  }
}

describe('desktop terminal authority read seam', () => {
  it('holds a captured Sidecar response before returning it to Terminal Runtime', async () => {
    const port = createPort()
    let releaseCheckpoint!: () => void
    const afterReadReplay = vi.fn(() => new Promise<void>(resolve => { releaseCheckpoint = resolve }))
    const transport = createDesktopTerminalTransport(port, { afterReadReplay })

    let returned = false
    const read = transport.readReplay('T-1-shell-0').then((replay) => {
      returned = true
      return replay
    })
    await vi.waitFor(() => expect(afterReadReplay).toHaveBeenCalledWith('T-1-shell-0', {
      ptyInstanceId: 7,
      watermark: 12,
    }))

    expect(port.getPtyBuffer).toHaveBeenCalledWith('T-1-shell-0')
    expect(returned).toBe(false)

    releaseCheckpoint()
    await expect(read).resolves.toMatchObject({
      isLive: true,
      ptyInstanceId: 7,
      snapshot: { ptyInstanceId: 7, watermark: 12 },
    })
  })

  it('projects model-output lifecycle diagnostics without changing event payloads', async () => {
    const onModelOutput = vi.fn()
    const port = createPort()
    const transport = createDesktopTerminalTransport(port)
    const subscription = await transport.subscribeSession('T-1-shell-0', {
      onModelOutput,
      onModelDisabled: vi.fn(),
      onExit: vi.fn(),
    })

    expect(subscription.snapshot?.()).toEqual({
      desired: false,
      pending: false,
      registered: false,
      disposed: false,
    })
    await subscription.setModelOutputEnabled(true)
    expect(subscription.snapshot?.()).toMatchObject({ desired: true, registered: true })

    const modelListener = vi.mocked(port.listenEvent).mock.calls
      .find(([eventName]) => eventName === 'pty-model-output-T-1-shell-0')?.[1]
    modelListener?.({
      payload: { data: btoa('unchanged'), instance_id: 7, start_sequence: 11, sequence: 12 },
    })
    const delivered = onModelOutput.mock.calls[0]?.[0]
    expect({ ...delivered, data: Array.from(delivered?.data ?? []) }).toEqual({
      data: Array.from(new TextEncoder().encode('unchanged')),
      ptyInstanceId: 7,
      startSequence: 11,
      sequence: 12,
    })

    subscription.dispose()
    expect(subscription.snapshot?.()).toMatchObject({ desired: false, registered: false, disposed: true })
  })

  it('delivers model output when the runtime provides native base64 decoding', async () => {
    const encoded = btoa('native path')
    const originalFromBase64 = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
    const nativeDecoder = vi.fn(() => new TextEncoder().encode('native path'))
    Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: nativeDecoder })
    const atobSpy = vi.spyOn(globalThis, 'atob').mockImplementation(() => {
      throw new Error('legacy base64 decoder should not run')
    })

    try {
      const onModelOutput = vi.fn()
      const port = createPort()
      const transport = createDesktopTerminalTransport(port)
      const subscription = await transport.subscribeSession('T-1-shell-0', {
        onModelOutput,
        onModelDisabled: vi.fn(),
        onExit: vi.fn(),
      })
      await subscription.setModelOutputEnabled(true)

      const modelListener = vi.mocked(port.listenEvent).mock.calls
        .find(([eventName]) => eventName === 'pty-model-output-T-1-shell-0')?.[1]
      modelListener?.({
        payload: { data: encoded, instance_id: 7, sequence: 12 },
      })

      expect(nativeDecoder).toHaveBeenCalledWith(encoded)
      expect(Array.from(onModelOutput.mock.calls[0]?.[0].data ?? [])).toEqual(
        Array.from(new TextEncoder().encode('native path')),
      )
      subscription.dispose()
    } finally {
      atobSpy.mockRestore()
      if (originalFromBase64) {
        Object.defineProperty(Uint8Array, 'fromBase64', originalFromBase64)
      } else {
        delete (Uint8Array as typeof Uint8Array & { fromBase64?: unknown }).fromBase64
      }
    }
  })

  it('delivers binary model output when native base64 decoding is unavailable', async () => {
    const originalFromBase64 = Object.getOwnPropertyDescriptor(Uint8Array, 'fromBase64')
    Object.defineProperty(Uint8Array, 'fromBase64', { configurable: true, value: undefined })

    try {
      const onModelOutput = vi.fn()
      const port = createPort()
      const transport = createDesktopTerminalTransport(port)
      const subscription = await transport.subscribeSession('T-1-shell-0', {
        onModelOutput,
        onModelDisabled: vi.fn(),
        onExit: vi.fn(),
      })
      await subscription.setModelOutputEnabled(true)

      const modelListener = vi.mocked(port.listenEvent).mock.calls
        .find(([eventName]) => eventName === 'pty-model-output-T-1-shell-0')?.[1]
      modelListener?.({
        payload: { data: btoa('\x00\x80\xff'), instance_id: 7, sequence: 12 },
      })

      expect(Array.from(onModelOutput.mock.calls[0]?.[0].data ?? [])).toEqual([0, 128, 255])
      subscription.dispose()
    } finally {
      if (originalFromBase64) {
        Object.defineProperty(Uint8Array, 'fromBase64', originalFromBase64)
      } else {
        delete (Uint8Array as typeof Uint8Array & { fromBase64?: unknown }).fromBase64
      }
    }
  })

  it('returns authority immediately when the E2E checkpoint hook is absent', async () => {
    const transport = createDesktopTerminalTransport(createPort())

    await expect(transport.readReplay('T-1-shell-0')).resolves.toMatchObject({
      ptyInstanceId: 7,
      snapshot: { watermark: 12 },
    })
  })
})
