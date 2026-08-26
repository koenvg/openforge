import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createDesktopTerminalTransport } from './desktopTerminalTransport'
import { createTrustedPluginTerminalTransport } from '../../plugins/terminal/src/lib/trustedPluginTerminalTransport'
import {
  createTerminalRuntime,
  type TerminalTransport,
  type TerminalView,
} from '@openforge-app/terminal-runtime'

function createFakeTerminalView(overrides: Partial<TerminalView> = {}): TerminalView {
  return {
    geometry: { cols: 80, rows: 24 },
    imageProtocol: null,
    resizeTarget: document.createElement('div'),
    mount: vi.fn(),
    unmount: vi.fn(),
    isMountedIn: vi.fn(() => false),
    bootstrap: vi.fn(),
    writeLive: vi.fn(),
    drainPresentation: vi.fn(async () => ({
      writeGeneration: 0,
      parsedGeneration: 0,
      renderFrame: 1,
      renderedRows: { start: 0, end: 23 },
      renderer: 'fake',
      presentedAt: 0,
      devicePixelRatio: 1,
      geometry: { cols: 80, rows: 24 },
    })),
    capturePresentation: vi.fn(() => ({
      geometry: { cols: 80, rows: 24 },
      activeBuffer: 'normal' as const,
      cursor: { x: 0, y: 0 },
      selectionText: '',
      lines: [],
    })),
    focus: vi.fn(),
    reset: vi.fn(),
    refresh: vi.fn(),
    fit: vi.fn(() => ({ cols: 80, rows: 24 })),
    onUserInput: vi.fn(() => ({ dispose: vi.fn() })),
    onQueryResponse: vi.fn(() => ({ dispose: vi.fn() })),
    setKeyEventHandler: vi.fn(),
    getSelectionText: vi.fn(() => ''),
    setTheme: vi.fn(),
    onRendererFailure: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    ...overrides,
  }
}

interface AdapterHarness {
  transport: TerminalTransport
  emitOutput(shellSessionKey: string, data: string, ptyInstanceId: number): void
  emitExit(shellSessionKey: string, ptyInstanceId: number): void
  emitConnectionRestored(): void
  setReplay(data: string | null, ptyInstanceId: number | null): void
  expectUserInput(shellSessionKey: string, data: string): void
  expectQueryResponse(shellSessionKey: string, data: string, ptyInstanceId: number): void
  expectResize(shellSessionKey: string, cols: number, rows: number): void
  sessionListenerCount(shellSessionKey: string): number
  connectionListenerCount(): number
  failNextExitSubscription(): void
}

function createDesktopHarness(): AdapterHarness {
  const listeners = new Map<string, (event: { payload: unknown }) => void>()
  let replay = { buffer: 'desktop replay' as string | null, isLive: true, instanceId: 7 as number | null }
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
    writeTerminalQueryResponse: vi.fn(async () => undefined),
    resizePty: vi.fn(async () => undefined),
  }
  return {
    transport: createDesktopTerminalTransport(port),
    emitOutput(shellSessionKey, data, ptyInstanceId) {
      listeners.get(`pty-output-${shellSessionKey}`)?.({
        payload: { task_id: 'ignored', data, instance_id: ptyInstanceId },
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
    setReplay(data, ptyInstanceId) {
      replay = { buffer: data, isLive: ptyInstanceId !== null, instanceId: ptyInstanceId }
    },
    expectUserInput(shellSessionKey, data) {
      expect(port.writePty).toHaveBeenCalledWith(shellSessionKey, data)
      expect(port.writeTerminalQueryResponse).not.toHaveBeenCalledWith(
        expect.objectContaining({ data }),
      )
    },
    expectQueryResponse(shellSessionKey, data, ptyInstanceId) {
      expect(port.writeTerminalQueryResponse).toHaveBeenCalledWith({
        shellSessionKey,
        data,
        ptyInstanceId,
      })
    },
    expectResize(shellSessionKey, cols, rows) {
      expect(port.resizePty).toHaveBeenCalledWith(shellSessionKey, cols, rows)
    },
    sessionListenerCount(shellSessionKey) {
      return Number(listeners.has(`pty-output-${shellSessionKey}`))
        + Number(listeners.has(`pty-exit-${shellSessionKey}`))
    },
    connectionListenerCount: () => Number(listeners.has('openforge-app-events-reconnected')),
    failNextExitSubscription() { failExitSubscription = true },
  }
}

function createTrustedPluginHarness(): AdapterHarness {
  const listeners = new Map<string, (payload: unknown) => void>()
  let replay = { buffer: 'plugin replay' as string | null, isLive: true, instanceId: 7 as number | null }
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
      writeTerminalQueryResponse: vi.fn(async () => undefined),
      resize: vi.fn(async () => undefined),
    },
  }
  return {
    transport: createTrustedPluginTerminalTransport(() => port),
    emitOutput(shellSessionKey, data, ptyInstanceId) {
      listeners.get(`openforge.pty-output-${shellSessionKey}`)?.({
        task_id: 'ignored',
        data,
        instance_id: ptyInstanceId,
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
    setReplay(data, ptyInstanceId) {
      replay = { buffer: data, isLive: ptyInstanceId !== null, instanceId: ptyInstanceId }
    },
    expectUserInput(_shellSessionKey, data) {
      expect(port.shell.write).toHaveBeenCalledWith({ taskId: 'T-1', terminalIndex: 2, data })
      expect(port.shell.writeTerminalQueryResponse).not.toHaveBeenCalledWith(
        expect.objectContaining({ data }),
      )
    },
    expectQueryResponse(_shellSessionKey, data, ptyInstanceId) {
      expect(port.shell.writeTerminalQueryResponse).toHaveBeenCalledWith({
        taskId: 'T-1',
        terminalIndex: 2,
        data,
        ptyInstanceId,
      })
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
      return Number(listeners.has(`openforge.pty-output-${shellSessionKey}`))
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

describe.each([
  ['desktop', createDesktopHarness],
  ['Trusted Plugin', createTrustedPluginHarness],
] as const)('%s TerminalTransport adapter', (_name, createHarness) => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes replay, live output, and PTY exit at the Terminal Runtime seam', async () => {
    const harness = createHarness()
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })

    const entry = await runtime.acquire('T-1-shell-2')
    harness.emitOutput('T-1-shell-2', 'live output', 7)
    harness.emitExit('T-1-shell-2', 6)

    expect(view.bootstrap).toHaveBeenCalledWith(expect.stringContaining('replay'), 7)
    expect(view.writeLive).toHaveBeenCalledWith({ data: 'live output', ptyInstanceId: 7 })
    expect(entry.ptyActive).toBe(true)

    harness.emitExit('T-1-shell-2', 7)
    expect(entry.ptyActive).toBe(false)
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

  it('keeps user input separate from instance-scoped query responses', async () => {
    const harness = createHarness()
    let onUserInput: ((data: string) => void) | undefined
    let onQueryResponse: ((response: { data: string; ptyInstanceId: number | null }) => void) | undefined
    const view = createFakeTerminalView({
      onUserInput: vi.fn((listener) => {
        onUserInput = listener
        return { dispose: vi.fn() }
      }),
      onQueryResponse: vi.fn((listener) => {
        onQueryResponse = listener
        return { dispose: vi.fn() }
      }),
    })
    const runtime = createTerminalRuntime({
      transport: harness.transport,
      environment: { openLink: vi.fn(async () => undefined) },
      createTerminalView: () => view,
    })
    await runtime.acquire('T-1-shell-2')

    onUserInput?.('typed input')
    onQueryResponse?.({ data: '\u001b[1;1R', ptyInstanceId: 7 })
    await vi.waitFor(() => {
      harness.expectUserInput('T-1-shell-2', 'typed input')
      harness.expectQueryResponse('T-1-shell-2', '\u001b[1;1R', 7)
    })
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
    harness.setReplay('reconnected replay', 7)
    harness.emitConnectionRestored()
    await vi.waitFor(() => {
      expect(view.bootstrap).toHaveBeenLastCalledWith('reconnected replay', 7)
    })

    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(2)
    expect(harness.connectionListenerCount()).toBe(1)
    runtime.release('T-1-shell-2')
    expect(harness.sessionListenerCount('T-1-shell-2')).toBe(0)
    expect(harness.connectionListenerCount()).toBe(0)

    runtime.dispose()
    expect(disposeTransport).toHaveBeenCalledOnce()
  })
})
