import { afterEach, describe, expect, it, vi } from 'vitest'
import { createTerminalRuntime } from './terminalRuntime'
import { attachTestTerminal, createHost } from './terminalRuntimeHost.testSupport'
import { createFakeTerminalView } from './terminalView.testUtils'
import { createTerminalSessionService } from './terminalSessionService'

const clients = [
  { label: 'agent terminal', ownerId: 'agent', shellSessionKey: 'T-agent' },
  { label: 'regular plugin terminal', ownerId: 'terminal-plugin', shellSessionKey: 'T-regular-shell-0' },
] as const

describe('Terminal Session client contract', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it.each(clients)('$label uses the shared bootstrap, reconnect, PTY replacement, input, and disposal contract', async ({ ownerId, shellSessionKey }) => {
    const host = createHost()
    const writePty = vi.spyOn(host, 'writePty')
    let buffer = 'bootstrap'
    let instanceId = 1
    host.getPtyBuffer = vi.fn(async () => ({
      buffer: null,
      isLive: true,
      instanceId,
      snapshot: { instanceId, watermark: 0, data: btoa(buffer) },
    }))
    const inputListeners: Array<(data: string) => void> = []
    const view = createFakeTerminalView({
      onUserInput: vi.fn((listener: (data: string) => void) => {
        inputListeners.push(listener)
        return { dispose: vi.fn() }
      }),
    })
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const service = createTerminalSessionService(runtime)
    const client = service.createClient(ownerId)

    const entry = await client.acquire(shellSessionKey)
    await attachTestTerminal(runtime, entry)

    expect(view.replaceSnapshot).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('bootstrap')),
      compatibilityData: undefined,
      ptyInstanceId: 1,
      sequence: 0,
    })

    inputListeners[0]?.('typed')
    expect(writePty).toHaveBeenCalledWith(shellSessionKey, 'typed')

    buffer = 'reconnected'
    host.emit('openforge-app-events-reconnected', { attempt: 1, reconnectedAt: 'now' })
    await vi.waitFor(() => expect(view.replaceSnapshot).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('reconnected')),
      compatibilityData: undefined,
      ptyInstanceId: 1,
      sequence: 0,
    }))

    instanceId = 2
    await client.markShellPtyStarted(entry, 2)
    host.emit(`pty-model-output-${shellSessionKey}`, { data: btoa('stale'), instance_id: 1, sequence: 1 })
    host.emit(`pty-model-output-${shellSessionKey}`, { data: btoa('current'), instance_id: 2, sequence: 1 })

    expect(view.writeLive).toHaveBeenCalledTimes(1)
    expect(view.writeLive).toHaveBeenCalledWith({
      data: Uint8Array.from(new TextEncoder().encode('current')),
      ptyInstanceId: 2,
      sequence: 1,
    })

    client.release(shellSessionKey)

    expect(view.dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(shellSessionKey)).toBe(false)
  })

  it.each(clients)('$label uses generation-checked attach, detach, reattach, and resize routing', async ({ ownerId, shellSessionKey }) => {
    let mountedIn: HTMLElement | null = null
    const renderElement = document.createElement('div')
    const view = Object.assign(createFakeTerminalView({
      mount: vi.fn((container: HTMLElement) => {
        mountedIn = container
        container.appendChild(renderElement)
      }),
      unmount: vi.fn(() => {
        mountedIn = null
        renderElement.remove()
      }),
      isMountedIn: vi.fn((container: HTMLElement) => mountedIn === container),
      fit: vi.fn(() => ({ cols: 100, rows: 30 })),
    }), { resizeTarget: renderElement })
    Object.defineProperty(view, 'geometry', { get: () => ({ cols: 100, rows: 30 }) })
    const host = createHost()
    const resizePty = vi.spyOn(host, 'resizePty')
    const runtime = createTerminalRuntime({ ...host, createTerminalView: () => view })
    const client = createTerminalSessionService(runtime).createClient(ownerId)

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

    const entry = await client.acquire(shellSessionKey)
    client.markShellPtyStarted(entry, 1)
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    const firstAttachment = await client.attach(entry, firstHost)
    const secondAttachment = await client.attach(entry, secondHost)

    firstAttachment.detach()
    expect(view.isMountedIn(secondHost)).toBe(true)
    expect(resizePty).toHaveBeenCalledWith(shellSessionKey, 100, 30)

    secondAttachment.detach()
    expect(entry.attached).toBe(false)

    const reattached = await client.attach(entry, firstHost)
    expect(view.isMountedIn(firstHost)).toBe(true)
    reattached.detach()
  })
})
