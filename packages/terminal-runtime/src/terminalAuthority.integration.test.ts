import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeTerminalView,
  createHost,
  resetTerminalRuntimeIntegrationHarness,
} from './terminalRuntime.integrationTestHarness'
import {
  XTERM_AUTHORITATIVE_TERMINAL_CONTRACT,
  createTerminalRuntime,
} from './terminalRuntime'

describe('terminal authority', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('binds the explicit xterm authority contract to one Shell Session Key and PTY instance', async () => {
    const shellSessionKey = 'T-1-shell-0'
    const host = createHost()
    host.getPtyBuffer = async () => ({
      buffer: '$ ',
      isLive: true,
      instanceId: 41,
    })
    const runtime = createTerminalRuntime(host, {
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
    const runtime = createTerminalRuntime(host, {
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
}) // terminal authority
