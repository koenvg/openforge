import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { resetTerminalRuntimeMocks } from './terminalRuntimeFeatures.testSupport'
import {
  INLINE_IMAGE_COMPATIBILITY_REPLAY,
  createFakeTerminalView,
} from './terminalView.testUtils'
import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  createTerminalRuntime,
} from './terminalRuntime'

describe('terminal authority', () => {
  beforeEach(resetTerminalRuntimeMocks)

  it('binds the explicit xterm authority contract to one Shell Session Key and PTY instance', async () => {
    const shellSessionKey = 'T-1-shell-0'
    const host = createHost()
    host.getPtyBuffer = async () => ({
      buffer: '$ ',
      isLive: true,
      instanceId: 41,
    })
    const runtime = createTerminalRuntime({
      ...host,
      authority: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
    })

    const entry = await runtime.acquire(shellSessionKey)

    expect(entry.authority).toEqual({
      shellSessionKey,
      ptyInstanceId: 41,
      contract: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
    })
  })

  it('routes one xterm query response through the instance-scoped response boundary', async () => {
    const shellSessionKey = 'T-2-shell-0'
    let onQueryResponse: ((response: { data: string; ptyInstanceId: number | null }) => void) | undefined
    const view = createFakeTerminalView({
      onQueryResponse: vi.fn((listener: (response: { data: string; ptyInstanceId: number | null }) => void) => {
        onQueryResponse = listener
        return { dispose: vi.fn() }
      }),
    })
    const host = createHost()
    host.getPtyBuffer = async () => ({ buffer: '', isLive: true, instanceId: 52 })
    const writeTerminalQueryResponse = vi.fn(async () => undefined)
    host.writeTerminalQueryResponse = writeTerminalQueryResponse
    const runtime = createTerminalRuntime({
      ...host,
      authority: XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
      createTerminalView: () => view,
    })

    await runtime.acquire(shellSessionKey)
    onQueryResponse?.({ data: '\u001b[9;9R', ptyInstanceId: 51 })
    onQueryResponse?.({ data: '\u001b[1;1R', ptyInstanceId: 52 })

    expect(writeTerminalQueryResponse).toHaveBeenCalledOnce()
    expect(writeTerminalQueryResponse).toHaveBeenCalledWith({
      shellSessionKey,
      ptyInstanceId: 52,
      data: '\u001b[1;1R',
    })
  }) // query response routing

  it('restores bounded raw compatibility state before the authoritative Ghostty snapshot', async () => {
    const shellSessionKey = 'T-ghostty-shell-0'
    const compatibilityReplay = INLINE_IMAGE_COMPATIBILITY_REPLAY
    let onQueryResponse: ((response: { data: string; ptyInstanceId: number | null }) => void) | undefined
    const view = createFakeTerminalView({
      onQueryResponse: vi.fn((listener: (response: { data: string; ptyInstanceId: number | null }) => void) => {
        onQueryResponse = listener
        return { dispose: vi.fn() }
      }),
    })
    const host = createHost()
    host.getPtyBuffer = async () => ({
      authority: 'ghostty-authoritative',
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
    const writeTerminalQueryResponse = vi.fn(async () => undefined)
    host.writeTerminalQueryResponse = writeTerminalQueryResponse
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })

    await runtime.acquire(shellSessionKey)
    onQueryResponse?.({ data: '\u001b[1;1R', ptyInstanceId: 61 })

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
    expect(writeTerminalQueryResponse).not.toHaveBeenCalled()
  })
}) // terminal authority
