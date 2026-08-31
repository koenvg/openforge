import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalRuntime } from './terminalRuntime'

function installVisibleAttachmentEnvironment(): void {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0)
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  })
  vi.stubGlobal('IntersectionObserver', class {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds = [0]

    constructor(private readonly callback: IntersectionObserverCallback) {}

    observe(target: Element) {
      this.callback(
        [{ isIntersecting: true, target } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      )
    }

    disconnect() {}
    unobserve() {}
    takeRecords() { return [] }
  })
}

describe('Terminal Runtime coordination contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('issues one generation-bound PTY spawn lease at a time', async () => {
    installVisibleAttachmentEnvironment()
    const host = createHost()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => createFakeTerminalView() })
    const session = await runtime.acquire('T-1-shell-0')
    await runtime.attach(session, document.createElement('div'))

    const first = runtime.beginPtySpawn(session)

    expect(first).toMatchObject({
      generation: 1,
      geometry: { cols: 80, rows: 24 },
      imageProtocol: null,
    })
    expect(runtime.beginPtySpawn(session)).toBeNull()

    first?.cancel()
    first?.cancel()

    const second = runtime.beginPtySpawn(session)
    expect(second?.generation).toBe(2)
  })

  it('keeps the Terminal Geometry Lease with the current visible attachment', async () => {
    installVisibleAttachmentEnvironment()
    const host = createHost()
    let dimensions = { cols: 100, rows: 30 }
    const view = createFakeTerminalView({
      fit: vi.fn(() => dimensions),
      isMountedIn: vi.fn(() => false),
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const session = await runtime.acquire('T-1-shell-0')
    const first = await runtime.attach(session, document.createElement('div'))
    const second = await runtime.attach(session, document.createElement('div'))
    const spawn = runtime.beginPtySpawn(session)
    expect(spawn).not.toBeNull()
    await spawn?.started(1)
    spawn?.cancel()
    host.transport.resize.mockClear()
    dimensions = { cols: 120, rows: 40 }

    await first.refit()
    expect(host.transport.resize).not.toHaveBeenCalled()

    await second.refit()
    expect(host.transport.resize).toHaveBeenCalledWith('T-1-shell-0', { cols: 120, rows: 40 })
  })

  it('exposes read-only diagnostics without exposing the session registry', async () => {
    const host = createHost()
    const view = createFakeTerminalView()
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const session = await runtime.acquire('T-1-shell-0')

    expect(runtime.diagnostics.list()).toEqual(['T-1-shell-0'])
    expect(runtime.diagnostics.observe(session.shellSessionKey)).toMatchObject({
      shellSessionKey: 'T-1-shell-0',
      lifecycle: {
        ptyActive: false,
        shellExited: false,
        currentPtyInstance: null,
      },
      geometry: { cols: 80, rows: 24 },
    })
    expect(runtime.diagnostics.capturePresentation('T-1-shell-0')).toEqual(
      view.capturePresentation(),
    )
    await expect(runtime.diagnostics.drainPresentation('T-1-shell-0')).resolves.toEqual(
      await view.drainPresentation(),
    )
    expect(runtime).not.toHaveProperty('_getPool')
  })
})
