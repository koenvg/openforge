import { describe, expect, it, vi } from 'vitest'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime, type TerminalReplay } from './terminalRuntime'

describe('terminal runtime transport seam', () => {
  it('acquires a Terminal Session through one named transport subscription', async () => {
    const view = createFakeTerminalView()
    const sessionSubscriptions: Array<{
      shellSessionKey: string
      handlers: {
        onModelOutput(event: { data: Uint8Array; ptyInstanceId: number; sequence: number }): void
        onExit(event: { ptyInstanceId: number }): void
      }
    }> = []
    let resolveReplay!: (replay: TerminalReplay) => void
    const transport = {
      subscribeSession: vi.fn(async (shellSessionKey, handlers) => {
        sessionSubscriptions.push({ shellSessionKey, handlers })
        return { setModelOutputEnabled: vi.fn(async () => undefined), dispose: vi.fn() }
      }),
      subscribeConnectionRestored: vi.fn(async () => ({ dispose: vi.fn() })),
      readReplay: vi.fn(() => new Promise<TerminalReplay>(resolve => { resolveReplay = resolve })),
      writeUserInput: vi.fn(async () => undefined),
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
    sessionSubscriptions[0]?.handlers.onModelOutput({
      data: Uint8Array.from(new TextEncoder().encode(' then live')),
      ptyInstanceId: 7,
      sequence: 1,
    })
    expect(view.writeLive).not.toHaveBeenCalled()

    resolveReplay({
      historicalData: null,
      isLive: true,
      ptyInstanceId: 7,
      snapshot: {
        data: Uint8Array.from(new TextEncoder().encode('snapshot first')),
        ptyInstanceId: 7,
        watermark: 0,
      },
    })
    await acquisition

    expect(transport.subscribeSession).toHaveBeenCalledOnce()
    expect(transport.subscribeSession).toHaveBeenCalledWith('T-1-shell-0', expect.any(Object))
    expect(view.replaceSnapshot).not.toHaveBeenCalled()
    expect(view.writeLive).not.toHaveBeenCalled()
    expect(runtime.diagnostics.observe('T-1-shell-0')?.lifecycle.currentPtyInstance).toBe(7)
  })
})
