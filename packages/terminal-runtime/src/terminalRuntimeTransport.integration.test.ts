import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createFakeTerminalView,
  resetTerminalRuntimeIntegrationHarness,
} from './terminalRuntime.integrationTestHarness'
import { createTerminalRuntime } from './terminalRuntime'

describe('terminal runtime transport seam', () => {
  beforeEach(resetTerminalRuntimeIntegrationHarness)

  it('acquires a Terminal Session through one named transport subscription', async () => {
    const view = createFakeTerminalView()
    const sessionSubscriptions: Array<{
      shellSessionKey: string
      handlers: {
        onOutput(event: { data: string; ptyInstanceId: number }): void
        onExit(event: { ptyInstanceId: number }): void
      }
    }> = []
    let resolveReplay!: (replay: { data: string; isLive: boolean; ptyInstanceId: number }) => void
    const transport = {
      subscribeSession: vi.fn(async (shellSessionKey, handlers) => {
        sessionSubscriptions.push({ shellSessionKey, handlers })
        return { dispose: vi.fn() }
      }),
      subscribeConnectionRestored: vi.fn(async () => ({ dispose: vi.fn() })),
      readReplay: vi.fn(() => new Promise<{ data: string; isLive: boolean; ptyInstanceId: number }>(
        resolve => { resolveReplay = resolve },
      )),
      writeUserInput: vi.fn(async () => undefined),
      writeQueryResponse: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
      dispose: vi.fn(),
    }
    const runtime = createTerminalRuntime({
      transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })

    const acquisition = runtime.acquire('T-1-shell-0')
    await vi.waitFor(() => expect(transport.readReplay).toHaveBeenCalledOnce())
    sessionSubscriptions[0]?.handlers.onOutput({ data: ' then live', ptyInstanceId: 7 })
    expect(view.writeLive).not.toHaveBeenCalled()

    resolveReplay({ data: 'replay first', isLive: true, ptyInstanceId: 7 })
    const entry = await acquisition

    expect(transport.subscribeSession).toHaveBeenCalledOnce()
    expect(transport.subscribeSession).toHaveBeenCalledWith('T-1-shell-0', expect.any(Object))
    expect(view.bootstrap).toHaveBeenCalledWith('replay first', 7)
    expect(view.writeLive).toHaveBeenCalledWith({ data: ' then live', ptyInstanceId: 7 })
    expect(vi.mocked(view.bootstrap).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(view.writeLive).mock.invocationCallOrder[0])
    expect(entry.currentPtyInstance).toBe(7)
  })
})
