import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import { createTrustedPluginTerminalTransport } from '../../plugins/terminal/src/lib/trustedPluginTerminalTransport'
import {
  createTerminalRuntime,
  type TerminalTransport,
} from '@openforge-app/terminal-runtime'
import {
  INLINE_IMAGE_COMPATIBILITY_REPLAY,
  createFakeTerminalView,
} from '@openforge-app/terminal-runtime/testUtils'


interface AdapterReplay {
  buffer: string | null
  isLive: boolean
  instanceId: number | null
  snapshot?: { instanceId: number; watermark: number; data: string; compatibilityData?: string }
}

interface AdapterHarness {
  transport: TerminalTransport
  emitModelOutput(shellSessionKey: string, data: string, ptyInstanceId: number, sequence: number): void
  emitExit(shellSessionKey: string, ptyInstanceId: number): void
  emitConnectionRestored(): void
  setGhosttyReplay(data: string, ptyInstanceId: number, watermark: number, compatibilityReplay?: string): void
  expectUserInput(shellSessionKey: string, data: string): void
  expectResize(shellSessionKey: string, cols: number, rows: number): void
  sessionListenerCount(shellSessionKey: string): number
  connectionListenerCount(): number
  failNextExitSubscription(): void
}

function createDesktopHarness(): AdapterHarness {
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  let replay: AdapterReplay = {
    buffer: null,
    isLive: true,
    instanceId: 7,
    snapshot: { instanceId: 7, watermark: 0, data: btoa('desktop replay') },
  }
  let failExitSubscription = false
  const port = {
    listenEvent: vi.fn(async (eventName: string, handler: (event: { payload: unknown }) => void) => {
      if (failExitSubscription && eventName.startsWith('pty-exit-')) {
        failExitSubscription = false
        throw new Error('exit subscription failed')
      }
      listeners.set(eventName, handler)
      return () => listeners.delete(eventName)
    }),
    getPtyBuffer: vi.fn(async () => replay),
    writePty: vi.fn(async () => undefined),
    resizePty: vi.fn(async () => undefined),
  }
  return {
    transport: createDesktopTerminalTransport(port),
    emitModelOutput(shellSessionKey, data, ptyInstanceId, sequence) {
      listeners.get(`pty-model-output-${shellSessionKey}`)?.({
        payload: { data: btoa(data), instance_id: ptyInstanceId, sequence },
      })
    },
    emitExit(shellSessionKey, ptyInstanceId) {
      listeners.get(`pty-exit-${shellSessionKey}`)?.({ payload: { instance_id: ptyInstanceId } })
    },
    emitConnectionRestored() {
      listeners.get('openforge-app-events-reconnected')?.({
        payload: { attempt: 2, reconnectedAt: '2026-08-26T00:00:00Z' },
      })
    },
    setGhosttyReplay(data, ptyInstanceId, watermark, compatibilityReplay) {
      replay = {
        buffer: null,
        isLive: true,
        instanceId: ptyInstanceId,
        snapshot: {
          instanceId: ptyInstanceId,
          watermark,
          data: btoa(data),
          compatibilityData: compatibilityReplay ? btoa(compatibilityReplay) : undefined,
        },
      }
    },
    expectUserInput(shellSessionKey, data) {
      expect(port.writePty).toHaveBeenCalledWith(shellSessionKey, data)
    },
    expectResize(shellSessionKey, cols, rows) {
      expect(port.resizePty).toHaveBeenCalledWith(shellSessionKey, cols, rows)
    },
    sessionListenerCount(shellSessionKey) {
      return Number(listeners.has(`pty-model-output-${shellSessionKey}`))
        + Number(listeners.has(`pty-model-disabled-${shellSessionKey}`))
        + Number(listeners.has(`pty-exit-${shellSessionKey}`))
    },
    connectionListenerCount: () => Number(listeners.has('openforge-app-events-reconnected')),
    failNextExitSubscription() { failExitSubscription = true },
  }
}

function createTrustedPluginHarness(): AdapterHarness {
  const listeners = new Map<string, (payload: unknown) => void>()
  let replay: AdapterReplay = {
    buffer: null,
    isLive: true,
    instanceId: 7,
    snapshot: { instanceId: 7, watermark: 0, data: btoa('plugin replay') },
  }
  let failExitSubscription = false
  const port = {
    events: {
      onGlobal<TPayload>(eventName: string, handler: (payload: TPayload) => void) {
        if (failExitSubscription && eventName.includes('.pty-exit-')) {
          failExitSubscription = false
          throw new Error('exit subscription failed')
        }
        listeners.set(eventName, handler as (payload: unknown) => void)
        return { dispose: vi.fn(() => { listeners.delete(eventName) }) }
      },
    },
    shell: {
      getBuffer: vi.fn(async () => replay),
      write: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
    },
  }
  return {
    transport: createTrustedPluginTerminalTransport(() => port),
    emitModelOutput(shellSessionKey, data, ptyInstanceId, sequence) {
      listeners.get(`openforge.pty-model-output-${shellSessionKey}`)?.({
        data: btoa(data),
        instance_id: ptyInstanceId,
        sequence,
      })
    },
    emitExit(shellSessionKey, ptyInstanceId) {
      listeners.get(`openforge.pty-exit-${shellSessionKey}`)?.({ instance_id: ptyInstanceId })
    },
    emitConnectionRestored() {
      listeners.get('openforge.openforge-app-events-reconnected')?.({
        attempt: 2,
        reconnectedAt: '2026-08-26T00:00:00Z',
      })
    },
    setGhosttyReplay(data, ptyInstanceId, watermark, compatibilityReplay) {
      replay = {
        buffer: null,
        isLive: true,
        instanceId: ptyInstanceId,
        snapshot: {
          instanceId: ptyInstanceId,
          watermark,
          data: btoa(data),
          compatibilityData: compatibilityReplay ? btoa(compatibilityReplay) : undefined,
        },
      }
    },
    expectUserInput(_shellSessionKey, data) {
      expect(port.shell.write).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2, data })
    },
    expectResize(_shellSessionKey, cols, rows) {
      expect(port.shell.resize).toHaveBeenCalledWith({
        taskId: 'T-1',
        terminalIndex: 2,
        cols,
        rows,
      })
    },
    sessionListenerCount(shellSessionKey) {
      return Number(listeners.has(`openforge.pty-model-output-${shellSessionKey}`))
        + Number(listeners.has(`openforge.pty-model-disabled-${shellSessionKey}`))
        + Number(listeners.has(`openforge.pty-exit-${shellSessionKey}`))
    },
    connectionListenerCount: () => Number(
      listeners.has('openforge.openforge-app-events-reconnected'),
    ),
    failNextExitSubscription() { failExitSubscription = true },
  }
}

function stubAttachmentObservers(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = [0]
  })
}

describe('desktop TerminalTransport async registration', () => {
  it('releases a model-output listener that finishes registering after transport disposal', async () => {
    let resolveModelOutputRegistration!: (unlisten: () => void) => void
    const modelOutputUnlisten = vi.fn()
    const port = {
      listenEvent: vi.fn((
        eventName: string,
        _handler: (event: { payload: unknown }) => void,
      ): Promise<() => void> => {
        if (eventName.startsWith('pty-model-output-')) {
          return new Promise(resolve => { resolveModelOutputRegistration = resolve })
        }
        return Promise.resolve(vi.fn())
      }),
      getPtyBuffer: vi.fn(async () => ({ buffer: null, isLive: true, instanceId: 7 })),
      writePty: vi.fn(async () => undefined),
      resizePty: vi.fn(async () => undefined),
    }
    const transport = createDesktopTerminalTransport(port)
    const subscription = await transport.subscribeSession('T-1-shell-2', {
      onModelOutput: vi.fn(),
      onModelDisabled: vi.fn(),
      onExit: vi.fn(),
    })

    const enabling = subscription.setModelOutputEnabled(true)
    transport.dispose()
    resolveModelOutputRegistration(modelOutputUnlisten)

    await enabling
    expect(modelOutputUnlisten).toHaveBeenCalledOnce()
  })
})

describe.each([
  ['desktop', createDesktopHarness],
  ['Trusted Plugin', createTrustedPluginHarness],
] as const)('%s TerminalTransport adapter', (_name, createHarness) => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })


  it('normalizes Ghostty snapshots and sequenced model output at the Terminal Runtime seam', async () => {
    stubAttachmentObservers()
    const harness = createHarness()
    const compatibilityReplay = INLINE_IMAGE_COMPATIBILITY_REPLAY
    harness.setGhosttyReplay('ghostty snapshot', 9, 3, compatibilityReplay)
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })

    const entry = await runtime.acquire('T-1-shell-2')
    await runtime.attach(entry, document.createElement('div'))
    harness.emitModelOutput('T-1-shell-2', 'model output', 9, 4)

    expect(view.replaceSnapshot).toHaveBeenCalledOnce()
    expect(view.replaceSnapshot).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('ghostty snapshot')),
      compatibilityData: Uint8Array.from(new TextEncoder().encode(compatibilityReplay)),
      ptyInstanceId: 9,
      sequence: 0,
    })
    expect(view.writeLive).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('model output')),
      ptyInstanceId: 9,
      sequence: 1,
    })
    expect(entry.currentPtyInstance).toBe(9)
    expect(entry.terminalModelSequence).toBe(4)
  })

  it('pauses live model output while detached and restores it after reattachment', async () => {
    stubAttachmentObservers()
    const harness = createHarness()
    const view = createFakeTerminalView()
    const writeLive = vi.spyOn(view, 'writeLive')
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })
    const entry = await runtime.acquire('T-1-shell-2')
    const firstContainer = document.createElement('div')
    const secondContainer = document.createElement('div')

    await runtime.attach(entry, firstContainer)
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(3)

    runtime.detach(entry)
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(2)
    const writesBeforeDetachedOutput = writeLive.mock.calls.length
    harness.emitModelOutput('T-1-shell-2', 'detached output', 7, 1)
    expect(writeLive).toHaveBeenCalledTimes(writesBeforeDetachedOutput)

    await runtime.attach(entry, secondContainer)
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(3)
    harness.emitModelOutput('T-1-shell-2', 'reattached output', 7, 1)
    expect(writeLive).toHaveBeenLastCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('reattached output')),
      ptyInstanceId: 7,
      sequence: 1,
    })

    runtime.dispose()
  })

  it('rolls back a partially registered session subscription and retries cleanly', async () => {
    const harness = createHarness()
    const failedView = createFakeTerminalView()
    const retryView = createFakeTerminalView()
    const views = [failedView, retryView]
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => views.shift() ?? createFakeTerminalView(),
    })
    harness.failNextExitSubscription()

    await expect(runtime.acquire('T-1-shell-2')).rejects.toThrow('exit subscription failed')

    expect(failedView.dispose).toHaveBeenCalledOnce()
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(0)
    await expect(runtime.acquire('T-1-shell-2')).resolves.toBeDefined()
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(2)
    runtime.dispose()
  })


  it('routes geometry, reconnect replay, session release, and runtime disposal', async () => {
    stubAttachmentObservers()
    const harness = createHarness()
    const disposeTransport = vi.spyOn(harness.transport, 'dispose')
    const renderHost = document.createElement('div')
    const view = Object.assign(createFakeTerminalView({
      mount: vi.fn((container: HTMLElement) => container.appendChild(renderHost)),
      unmount: vi.fn(() => renderHost.remove()),
      isMountedIn: vi.fn((container: HTMLElement) => renderHost.parentNode === container),
      fit: vi.fn(() => ({ cols: 80, rows: 24 })),
    }), { resizeTarget: renderHost })
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })
    const entry = await runtime.acquire('T-1-shell-2')
    await runtime.attach(entry, document.createElement('div'))

    harness.expectResize('T-1-shell-2', 80, 24)
    harness.setGhosttyReplay('reconnected replay', 7, 0)
    harness.emitConnectionRestored()
    await vi.waitFor(() => {
      expect(view.replaceSnapshot).toHaveBeenLastCalledWith({
        data: Uint8Array.from(new TextEncoder().encode('reconnected replay')),
        compatibilityData: undefined,
        ptyInstanceId: 7,
        sequence: 0,
      })
    })

    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(3)
    expect(harness.connectionListenerCount()).toBe(1)
    runtime.release('T-1-shell-2')
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(0)
    expect(harness.connectionListenerCount()).toBe(0)

    runtime.dispose()
    expect(disposeTransport).toHaveBeenCalledOnce()
  })
})
