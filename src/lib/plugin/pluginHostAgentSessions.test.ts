import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScopedAgentSessionState } from '@openforge-app/plugin-sdk'

const ipc = vi.hoisted(() => ({
  startScopedAgentSession: vi.fn(),
  getScopedAgentSessionStatus: vi.fn(),
  inputScopedAgentSession: vi.fn(),
  abortScopedAgentSession: vi.fn(),
  releaseScopedAgentSession: vi.fn(),
}))
const terminal = vi.hoisted(() => ({ acquire: vi.fn(), attach: vi.fn(), release: vi.fn() }))
const events = vi.hoisted(() => ({ subscribe: vi.fn(), ready: vi.fn() }))

vi.mock('../ipc', () => ipc)
vi.mock('../terminalSessionService', () => ({ scopedAgentTerminalSessions: terminal }))
vi.mock('./pluginHostEvents', () => ({
  subscribeToPluginHostEvent: events.subscribe,
  waitForPluginHostEventSubscription: events.ready,
}))

import { createPluginAgentSessionHostCapabilities } from './pluginHostAgentSessions'

const scope = { namespace: 'review', targetKey: 'PR-42', revision: 'sha-1' }
const running = {
  id: 'sas-1', turnId: 'turn-1', status: 'running' as const, queuePosition: null, queueReason: null,
  acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null,
  createdAt: 1, updatedAt: 2,
}

describe('plugin scoped Agent Session host', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    events.subscribe.mockReturnValue(vi.fn())
    events.ready.mockResolvedValue(undefined)
    ipc.getScopedAgentSessionStatus.mockResolvedValue(running)
    terminal.acquire.mockResolvedValue({ key: 'internal' })
  })

  it('injects plugin ownership into lifecycle IPC calls', async () => {
    ipc.startScopedAgentSession.mockResolvedValue(running)
    const host = createPluginAgentSessionHostCapabilities('com.example.review')
    const request = { scope, projectId: 'P-1', checkoutRevision: 'main', initialInput: 'Review', toolPolicy: 'review-read-only' }

    await host.startScopedAgentSession(request)

    expect(ipc.startScopedAgentSession).toHaveBeenCalledWith('com.example.review', request)
  })

  it('preserves the authentication-unavailable error category from the host', async () => {
    ipc.startScopedAgentSession.mockRejectedValue(new Error(
      'AUTHENTICATION_UNAVAILABLE: Provider authentication is unavailable; authenticate the normal provider first',
    ))
    const host = createPluginAgentSessionHostCapabilities('com.example.review')

    await expect(host.startScopedAgentSession({
      scope,
      projectId: 'P-1',
      checkoutRevision: 'main',
      initialInput: 'Review',
      toolPolicy: 'review-read-only',
    })).rejects.toMatchObject({
      code: 'AUTHENTICATION_UNAVAILABLE',
      message: 'Provider authentication is unavailable; authenticate the normal provider first',
    })
  })

  it('shows queued state before attaching the host terminal', async () => {
    ipc.getScopedAgentSessionStatus.mockResolvedValue({
      ...running, status: 'queued', queuePosition: 1,
      queueReason: 'Waiting for an available scoped Agent Session slot', acceptsInput: false,
    })
    const host = createPluginAgentSessionHostCapabilities('com.example.queue')
    const element = document.createElement('section')

    const mount = await host.mountScopedAgentSessionTerminal(scope, element)

    expect(element.textContent).toContain('Waiting for an available')
    expect(terminal.attach).not.toHaveBeenCalled()
    mount.dispose()
    expect(element.childElementCount).toBe(0)
  })

  it('atomically replaces mounts and makes stale disposables harmless', async () => {
    const firstDetach = vi.fn()
    const secondDetach = vi.fn()
    terminal.attach
      .mockResolvedValueOnce({ detach: firstDetach })
      .mockResolvedValueOnce({ detach: secondDetach })
    const host = createPluginAgentSessionHostCapabilities('com.example.mount')

    const first = await host.mountScopedAgentSessionTerminal(scope, document.createElement('div'))
    const second = await host.mountScopedAgentSessionTerminal(scope, document.createElement('div'))
    first.dispose()

    expect(firstDetach).toHaveBeenCalledTimes(1)
    expect(terminal.release).toHaveBeenCalledTimes(1)
    expect(secondDetach).not.toHaveBeenCalled()
    second.dispose()
    expect(secondDetach).toHaveBeenCalledTimes(1)
  })

  it('keeps only the latest of two concurrently requested mounts', async () => {
    terminal.attach.mockResolvedValue({ detach: vi.fn() })
    const host = createPluginAgentSessionHostCapabilities('com.example.concurrent-mount')
    const firstElement = document.createElement('div')
    const secondElement = document.createElement('div')

    const firstPromise = host.mountScopedAgentSessionTerminal(scope, firstElement)
    const secondPromise = host.mountScopedAgentSessionTerminal(scope, secondElement)
    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(terminal.attach).toHaveBeenCalledOnce()
    expect(firstElement.childElementCount).toBe(0)
    expect(secondElement.childElementCount).toBe(1)
    first.dispose()
    expect(terminal.release).not.toHaveBeenCalled()
    second.dispose()
    expect(terminal.release).toHaveBeenCalledOnce()
  })

  it('detaches for a queued continuation and reattaches when it is promoted', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      return vi.fn()
    })
    const firstDetach = vi.fn()
    terminal.attach
      .mockResolvedValueOnce({ detach: firstDetach })
      .mockResolvedValueOnce({ detach: vi.fn() })
    const host = createPluginAgentSessionHostCapabilities('com.example.continuation')
    const mount = await host.mountScopedAgentSessionTerminal(scope, document.createElement('div'))

    ipc.getScopedAgentSessionStatus.mockResolvedValue({
      ...running, status: 'queued', queuePosition: 1, queueReason: 'Waiting', acceptsInput: false,
    })
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.continuation', ...scope })
    await vi.waitFor(() => expect(firstDetach).toHaveBeenCalledOnce())

    ipc.getScopedAgentSessionStatus.mockResolvedValue(running)
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.continuation', ...scope })
    await vi.waitFor(() => expect(terminal.attach).toHaveBeenCalledTimes(2))
    mount.dispose()
  })

  it('serializes refreshes so stale status cannot replace the latest view', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      return vi.fn()
    })
    const detach = vi.fn()
    terminal.attach.mockResolvedValue({ detach })
    const host = createPluginAgentSessionHostCapabilities('com.example.serial-refresh')
    const mount = await host.mountScopedAgentSessionTerminal(scope, document.createElement('div'))
    await vi.waitFor(() => expect(events.subscribe).toHaveBeenCalledTimes(3))
    const callsBefore = ipc.getScopedAgentSessionStatus.mock.calls.length
    let resolveStale!: (state: ScopedAgentSessionState) => void
    ipc.getScopedAgentSessionStatus
      .mockImplementationOnce(() => new Promise(resolve => { resolveStale = resolve }))
      .mockResolvedValue(running)

    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.serial-refresh', ...scope })
    await vi.waitFor(() => expect(ipc.getScopedAgentSessionStatus.mock.calls.length).toBe(callsBefore + 1))
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.serial-refresh', ...scope })
    resolveStale({
      ...running,
      status: 'queued',
      queuePosition: 1,
      queueReason: 'Waiting',
      acceptsInput: false,
    })

    await vi.waitFor(() => expect(ipc.getScopedAgentSessionStatus.mock.calls.length).toBe(callsBefore + 2))
    expect(detach).not.toHaveBeenCalled()
    mount.dispose()
  })

  it('reruns attachment after changes arrive during a stale acquire', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      return vi.fn()
    })
    let resolveAcquire!: (entry: { key: string }) => void
    terminal.acquire
      .mockImplementationOnce(() => new Promise(resolve => { resolveAcquire = resolve }))
      .mockResolvedValue({ key: 'replacement' })
    terminal.attach.mockResolvedValue({ detach: vi.fn() })
    const host = createPluginAgentSessionHostCapabilities('com.example.acquire-refresh')
    const mountPromise = host.mountScopedAgentSessionTerminal(scope, document.createElement('div'))
    await vi.waitFor(() => expect(terminal.acquire).toHaveBeenCalledOnce())

    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.acquire-refresh', ...scope })
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.acquire-refresh', ...scope })
    resolveAcquire({ key: 'stale' })

    await vi.waitFor(() => expect(terminal.acquire).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(terminal.attach).toHaveBeenCalledOnce())
    const mount = await mountPromise
    expect(terminal.release).toHaveBeenCalledOnce()
    mount.dispose()
  })

  it('tears down a live mount when its session is released', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      return vi.fn()
    })
    const detach = vi.fn()
    terminal.attach.mockResolvedValue({ detach })
    const host = createPluginAgentSessionHostCapabilities('com.example.release')
    const element = document.createElement('div')
    const mount = await host.mountScopedAgentSessionTerminal(scope, element)

    ipc.getScopedAgentSessionStatus.mockResolvedValue(null)
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.release', ...scope })

    await vi.waitFor(() => expect(detach).toHaveBeenCalledOnce())
    expect(terminal.release).toHaveBeenCalledOnce()
    expect(element.childElementCount).toBe(0)
    mount.dispose()
  })

  it('filters invalidations to the exact owner and scope', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      return vi.fn()
    })
    const changed = vi.fn()
    const host = createPluginAgentSessionHostCapabilities('com.example.events')
    const subscription = host.subscribeScopedAgentSessionChanges(scope, changed)

    await vi.waitFor(() => expect(events.subscribe).toHaveBeenCalledTimes(3))
    expect(changed).toHaveBeenCalledWith(scope)
    changed.mockClear()

    const scopedHandler = desktopHandlers.get('scoped-agent-session-changed')
    scopedHandler?.({ pluginId: 'other', ...scope })
    scopedHandler?.({ pluginId: 'com.example.events', ...scope, revision: 'sha-2' })
    scopedHandler?.({ pluginId: 'com.example.events', ...scope })

    expect(changed).toHaveBeenCalledOnce()
    expect(changed).toHaveBeenCalledWith(scope)
    const outputHandler = [...desktopHandlers.entries()].find(([event]) => event.startsWith('pty-output-'))?.[1]
    outputHandler?.({ data: 'output' })
    expect(changed).toHaveBeenCalledTimes(2)
    subscription.dispose()
  })

  it('shares one host observer across subscribers for the same scope', async () => {
    const desktopHandlers = new Map<string, (payload: unknown) => void>()
    const unsubscribers: Array<ReturnType<typeof vi.fn>> = []
    events.subscribe.mockImplementation((_pluginId, event, handler) => {
      desktopHandlers.set(event, handler)
      const unsubscribe = vi.fn()
      unsubscribers.push(unsubscribe)
      return unsubscribe
    })
    const firstHandler = vi.fn()
    const secondHandler = vi.fn()
    const host = createPluginAgentSessionHostCapabilities('com.example.shared')

    const first = host.subscribeScopedAgentSessionChanges(scope, firstHandler)
    const second = host.subscribeScopedAgentSessionChanges(scope, secondHandler)
    await vi.waitFor(() => expect(events.subscribe).toHaveBeenCalledTimes(3))
    expect(firstHandler).toHaveBeenCalledOnce()
    expect(secondHandler).toHaveBeenCalledOnce()
    firstHandler.mockClear()
    secondHandler.mockClear()
    desktopHandlers.get('scoped-agent-session-changed')?.({ pluginId: 'com.example.shared', ...scope })
    expect(firstHandler).toHaveBeenCalledOnce()
    expect(secondHandler).toHaveBeenCalledOnce()

    first.dispose()
    expect(unsubscribers.every(unsubscribe => unsubscribe.mock.calls.length === 0)).toBe(true)
    second.dispose()
    expect(unsubscribers.every(unsubscribe => unsubscribe.mock.calls.length === 1)).toBe(true)
  })

  it('covers output lost while keyed event listener registration is pending', async () => {
    let resolveRegistration!: () => void
    const registration = new Promise<void>(resolve => { resolveRegistration = resolve })
    events.ready.mockImplementation(event => event.startsWith('pty-') ? registration : Promise.resolve())
    const changed = vi.fn()
    const host = createPluginAgentSessionHostCapabilities('com.example.setup-output')

    const subscription = host.subscribeScopedAgentSessionChanges(scope, changed)
    await vi.waitFor(() => expect(events.ready).toHaveBeenCalledTimes(2))
    expect(changed).not.toHaveBeenCalled()
    // Output emitted by main during this window is not delivered to the renderer.
    resolveRegistration()

    await vi.waitFor(() => expect(changed).toHaveBeenCalled())
    expect(changed.mock.calls.every(([event]) => JSON.stringify(event) === JSON.stringify(scope))).toBe(true)
    subscription.dispose()
  })
})
