import { describe, expect, it, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import {
  APP_EVENTS_RECONNECTED_EVENT,
  createTerminalRuntime,
  type TerminalRuntimeEvent,
  type TerminalRuntimeHost,
} from './terminalRuntime'

const terminalMocks = vi.hoisted(() => ({
  failCompatibilityAddon: false,
  failImageAddon: false,
  instances: [] as Array<{
    write: ReturnType<typeof vi.fn>
    reset: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    refresh: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    attachCustomKeyEventHandler: ReturnType<typeof vi.fn>
    cols: number
    rows: number
    options: Record<string, unknown>
  }>,
}))

const webLinkMocks = vi.hoisted(() => ({
  callbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
}))

const imageAddonMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>
    reset: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal() {
    const loadedAddons: Array<{ dispose?: () => void }> = []
    const terminal = {
      write: vi.fn(),
      reset: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(() => {
        for (const addon of loadedAddons) addon.dispose?.()
      }),
      refresh: vi.fn(),
      focus: vi.fn(),
      loadAddon: vi.fn((addon: { activate?: unknown; dispose?: () => void; options?: { iipSupport?: boolean } }) => {
        if (terminalMocks.failImageAddon && addon.options?.iipSupport) {
          throw new Error('image addon unavailable')
        }
        if (terminalMocks.failCompatibilityAddon && addon.activate && !addon.options?.iipSupport) {
          throw new Error('compatibility addon unavailable')
        }
        loadedAddons.push(addon)
      }),
      onData: vi.fn(),
      attachCustomKeyEventHandler: vi.fn(),
      cols: 80,
      rows: 24,
      options: {},
    }
    terminalMocks.instances.push(terminal)
    return terminal
  }),
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn(function FitAddon() {
    return {
      fit: vi.fn(),
      proposeDimensions: vi.fn().mockReturnValue({ cols: 80, rows: 24 }),
      dispose: vi.fn(),
    }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon(callback: (event: MouseEvent, uri: string) => void) {
    webLinkMocks.callbacks.push(callback)
    return { dispose: vi.fn() }
  }),
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(function WebglAddon() {
    return {
      dispose: vi.fn(),
      onContextLoss: vi.fn().mockReturnValue({ dispose: vi.fn() }),
    }
  }),
}))

vi.mock('@xterm/addon-image', () => ({
  ImageAddon: vi.fn(function ImageAddon(options: Record<string, unknown>) {
    const addon = {
      options,
      reset: vi.fn(),
      dispose: vi.fn(),
    }
    imageAddonMocks.instances.push(addon)
    return addon
  }),
}))

interface TestHost extends TerminalRuntimeHost {
  emit<TPayload>(eventName: string, payload: TPayload): void
  setBuffer(taskId: string, buffer: string | null): void
  getListenerCount(eventName: string): number
  deferBufferRead(taskId: string): () => void
  deferListenerRegistration(eventName: string): () => void
  failNextListenerRegistration(eventName: string): void
}

function createDeferredGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

function createHost(): TestHost {
  const listeners = new Map<string, Set<(event: TerminalRuntimeEvent<unknown>) => void>>()
  const buffers = new Map<string, string | null>()
  const bufferReadGates = new Map<string, ReturnType<typeof createDeferredGate>>()
  const listenerRegistrationGates = new Map<string, ReturnType<typeof createDeferredGate>>()
  const listenerRegistrationFailures = new Set<string>()
  const openLink = vi.fn(async () => undefined)

  return {
    themeMode: writable('dark'),
    async listenEvent<TPayload>(eventName: string, handler: (event: TerminalRuntimeEvent<TPayload>) => void) {
      await listenerRegistrationGates.get(eventName)?.promise
      if (listenerRegistrationFailures.delete(eventName)) {
        throw new Error(`listener registration failed: ${eventName}`)
      }
      const current = listeners.get(eventName) ?? new Set()
      current.add(handler as (event: TerminalRuntimeEvent<unknown>) => void)
      listeners.set(eventName, current)
      return () => current.delete(handler as (event: TerminalRuntimeEvent<unknown>) => void)
    },
    async getPtyBuffer(taskId: string) {
      await bufferReadGates.get(taskId)?.promise
      return buffers.get(taskId) ?? null
    },
    async writePty() {},
    async resizePty() {},
    openLink,
    emit<TPayload>(eventName: string, payload: TPayload) {
      for (const listener of listeners.get(eventName) ?? []) {
        listener({ payload })
      }
    },
    setBuffer(taskId: string, buffer: string | null) {
      buffers.set(taskId, buffer)
    },
    deferBufferRead(taskId: string) {
      const gate = createDeferredGate()
      bufferReadGates.set(taskId, gate)
      return () => {
        if (bufferReadGates.get(taskId) === gate) bufferReadGates.delete(taskId)
        gate.release()
      }
    },
    deferListenerRegistration(eventName: string) {
      const gate = createDeferredGate()
      listenerRegistrationGates.set(eventName, gate)
      return () => {
        if (listenerRegistrationGates.get(eventName) === gate) listenerRegistrationGates.delete(eventName)
        gate.release()
      }
    },
    failNextListenerRegistration(eventName: string) {
      listenerRegistrationFailures.add(eventName)
    },
    getListenerCount(eventName: string) {
      return listeners.get(eventName)?.size ?? 0
    },
  }
}

describe('terminal runtime acquisition', () => {
  beforeEach(() => {
    terminalMocks.instances.length = 0
    imageAddonMocks.instances.length = 0
    webLinkMocks.callbacks.length = 0
  })

  it('passes the owning Terminal Surface key when a web link is activated', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    await runtime.acquire('T-1-shell-2')
    const event = { preventDefault: vi.fn(), stopPropagation: vi.fn() } as unknown as MouseEvent

    webLinkMocks.callbacks[0]?.(event, 'https://openforge.dev/docs')

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(host.openLink).toHaveBeenCalledWith('T-1-shell-2', 'https://openforge.dev/docs')
  })

  it('deduplicates concurrent acquisitions for one terminal key', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)

    const [first, second] = await Promise.all([
      runtime.acquire('T-1-shell-0'),
      runtime.acquire('T-1-shell-0'),
    ])

    expect(second).toBe(first)
    expect(terminalMocks.instances).toHaveLength(1)
    expect(imageAddonMocks.instances).toHaveLength(1)
    expect(host.getListenerCount('pty-output-T-1-shell-0')).toBe(1)
    expect(host.getListenerCount('pty-exit-T-1-shell-0')).toBe(1)
  })

  it.each(['pty-output', 'pty-exit'] as const)(
    'rolls back allocated resources and retained listeners when %s setup fails, then retries cleanly',
    async (failedEventPrefix) => {
      const terminalKey = 'T-1-shell-0'
      const outputEvent = `pty-output-${terminalKey}`
      const exitEvent = `pty-exit-${terminalKey}`
      const failedEvent = `${failedEventPrefix}-${terminalKey}`
      const host = createHost()
      host.failNextListenerRegistration(failedEvent)
      const runtime = createTerminalRuntime(host)

      await expect(runtime.acquire(terminalKey)).rejects.toThrow(`listener registration failed: ${failedEvent}`)

      expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
      expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
      expect(runtime.hasTerminal(terminalKey)).toBe(false)
      expect(runtime._getPool().has(terminalKey)).toBe(false)
      expect(host.getListenerCount(outputEvent)).toBe(0)
      expect(host.getListenerCount(exitEvent)).toBe(0)
      expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(0)

      const retriedEntry = await runtime.acquire(terminalKey)

      expect(terminalMocks.instances).toHaveLength(2)
      expect(retriedEntry).toBe(runtime._getPool().get(terminalKey))
      expect(host.getListenerCount(outputEvent)).toBe(1)
      expect(host.getListenerCount(exitEvent)).toBe(1)
      expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
    },
  )

  it('reacquires cleanly after release invalidates initialization before pool registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    const resumeBufferRead = host.deferBufferRead(terminalKey)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(getPtyBuffer).toHaveBeenCalledOnce())

    runtime.release(terminalKey)
    resumeBufferRead()
    const currentAcquisition = runtime.acquire(terminalKey)

    const [releasedEntry, currentEntry] = await Promise.all([releasedAcquisition, currentAcquisition])

    expect(releasedEntry).not.toBe(currentEntry)
    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(1)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(1)
  })

  it('releaseAllForTask invalidates a pending acquisition before pool registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const getPtyBuffer = vi.spyOn(host, 'getPtyBuffer')
    const resumeBufferRead = host.deferBufferRead(terminalKey)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(getPtyBuffer).toHaveBeenCalledOnce())

    expect(runtime.releaseAllForTask('T-1')).toBe(1)
    resumeBufferRead()
    await releasedAcquisition

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(0)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(0)
  })

  it('does not publish a released entry after final PTY listener registration', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const listenEvent = vi.spyOn(host, 'listenEvent')
    const resumeExitListenerRegistration = host.deferListenerRegistration(`pty-exit-${terminalKey}`)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => {
      expect(listenEvent).toHaveBeenCalledWith(`pty-exit-${terminalKey}`, expect.any(Function))
    })

    resumeExitListenerRegistration()
    // Let listener registration and retention settle, but release before initializeTerminal resumes.
    await Promise.resolve()
    await Promise.resolve()
    runtime.release(terminalKey)

    const releasedEntry = await releasedAcquisition

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(0)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(0)

    const currentEntry = await runtime.acquire(terminalKey)
    expect(currentEntry).not.toBe(releasedEntry)
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
  })

  it('reacquires cleanly after release invalidates initialization during reconnect setup', async () => {
    const terminalKey = 'T-1-shell-0'
    const host = createHost()
    const resumeReconnectRegistration = host.deferListenerRegistration(APP_EVENTS_RECONNECTED_EVENT)
    const runtime = createTerminalRuntime(host)

    const releasedAcquisition = runtime.acquire(terminalKey)
    await vi.waitFor(() => expect(runtime.hasTerminal(terminalKey)).toBe(true))

    runtime.release(terminalKey)
    const currentAcquisition = runtime.acquire(terminalKey)
    resumeReconnectRegistration()

    const [releasedEntry, currentEntry] = await Promise.all([releasedAcquisition, currentAcquisition])

    expect(releasedEntry).not.toBe(currentEntry)
    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime._getPool().get(terminalKey)).toBe(currentEntry)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
    expect(host.getListenerCount(`pty-output-${terminalKey}`)).toBe(1)
    expect(host.getListenerCount(`pty-exit-${terminalKey}`)).toBe(1)
  })

  it('rolls back the provisional pool entry when reconnect listener setup fails, then retries cleanly', async () => {
    const terminalKey = 'T-1-shell-0'
    const outputEvent = `pty-output-${terminalKey}`
    const exitEvent = `pty-exit-${terminalKey}`
    const host = createHost()
    host.failNextListenerRegistration(APP_EVENTS_RECONNECTED_EVENT)
    const runtime = createTerminalRuntime(host)

    await expect(runtime.acquire(terminalKey)).rejects.toThrow(
      `listener registration failed: ${APP_EVENTS_RECONNECTED_EVENT}`,
    )

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
    expect(runtime.hasTerminal(terminalKey)).toBe(false)
    expect(runtime._getPool().has(terminalKey)).toBe(false)
    expect(host.getListenerCount(outputEvent)).toBe(0)
    expect(host.getListenerCount(exitEvent)).toBe(0)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(0)

    const retriedEntry = await runtime.acquire(terminalKey)

    expect(terminalMocks.instances).toHaveLength(2)
    expect(retriedEntry).toBe(runtime._getPool().get(terminalKey))
    expect(host.getListenerCount(outputEvent)).toBe(1)
    expect(host.getListenerCount(exitEvent)).toBe(1)
    expect(host.getListenerCount(APP_EVENTS_RECONNECTED_EVENT)).toBe(1)
  })
})

describe('terminal runtime shell output lifecycle', () => {
  beforeEach(() => {
    terminalMocks.instances.length = 0
    imageAddonMocks.instances.length = 0
  })

  it('reports no output for a newly acquired shell without backend buffer', async () => {
    const runtime = createTerminalRuntime(createHost())

    await runtime.acquire('T-1-shell-0')

    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)
  })

  it('reports output when a non-empty backend buffer is replayed', async () => {
    const host = createHost()
    host.setBuffer('T-1-shell-0', 'ready prompt')
    const runtime = createTerminalRuntime(host)

    await runtime.acquire('T-1-shell-0')

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      hasOutput: true,
    })
  })

  it('transitions to output observed on current live PTY output and ignores stale output', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')
    const lifecycleUpdates: unknown[] = []
    runtime.subscribeShellLifecycle('T-1-shell-0', (state) => lifecycleUpdates.push(state))

    runtime.markShellPtyStarted(entry, 7)
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-output-T-1-shell-0', { data: 'stale', instance_id: 8 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(false)

    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 7 })

    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)
    expect(lifecycleUpdates.at(-1)).toMatchObject({ hasOutput: true, currentPtyInstance: 7 })
  })

  it('preserves output observed while a fresh shell spawn is pending', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    runtime.markPtySpawnPending(entry)
    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)

    runtime.markShellPtyStarted(entry, 1)

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 1,
      hasOutput: true,
    })
  })

  it('resets output observed when a fresh shell instance starts', async () => {
    const host = createHost()
    const runtime = createTerminalRuntime(host)
    const entry = await runtime.acquire('T-1-shell-0')

    runtime.markShellPtyStarted(entry, 1)
    host.emit('pty-output-T-1-shell-0', { data: '$ ', instance_id: 1 })
    expect(runtime.getShellLifecycleState('T-1-shell-0').hasOutput).toBe(true)

    runtime.markPtySpawnPending(entry)
    runtime.markShellPtyStarted(entry, 2)

    expect(runtime.getShellLifecycleState('T-1-shell-0')).toMatchObject({
      ptyActive: true,
      currentPtyInstance: 2,
      hasOutput: false,
    })
  })
})

describe('terminal runtime inline image lifecycle', () => {
  beforeEach(() => {
    terminalMocks.instances.length = 0
    terminalMocks.failCompatibilityAddon = false
    terminalMocks.failImageAddon = false
    imageAddonMocks.instances.length = 0
  })

  it('loads bounded iTerm image support before advertising the protocol', async () => {
    const runtime = createTerminalRuntime(createHost())

    const entry = await runtime.acquire('T-1')

    expect(imageAddonMocks.instances).toHaveLength(1)
    expect(imageAddonMocks.instances[0].options).toMatchObject({
      pixelLimit: 12_000_000,
      storageLimit: 32,
      iipSizeLimit: 6 * 1024 * 1024,
      iipSupport: true,
      sixelSupport: false,
      showPlaceholder: true,
    })
    expect(runtime.getTerminalImageProtocol(entry)).toBe('iterm2')
  })

  it('keeps the fallback protocol when image rendering is disabled', async () => {
    const host = createHost()
    host.enableImages = false
    const runtime = createTerminalRuntime(host)

    const entry = await runtime.acquire('T-1')

    expect(imageAddonMocks.instances).toHaveLength(0)
    expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
  })

  it('does not advertise image support when the addon cannot initialize', async () => {
    terminalMocks.failImageAddon = true
    const runtime = createTerminalRuntime(createHost())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const entry = await runtime.acquire('T-1')

    expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
    expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('disposes image rendering when compatibility validation cannot initialize', async () => {
    terminalMocks.failCompatibilityAddon = true
    const runtime = createTerminalRuntime(createHost())
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const entry = await runtime.acquire('T-1')

    expect(runtime.getTerminalImageProtocol(entry)).toBeNull()
    expect(imageAddonMocks.instances[0].dispose).toHaveBeenCalledOnce()
    warn.mockRestore()
  })

  it('resets retained images on reconnect and disposes them with the terminal', async () => {
    const host = createHost()
    host.setBuffer('T-1', 'before')
    const runtime = createTerminalRuntime(host)
    await runtime.acquire('T-1')
    host.setBuffer('T-1', 'after')

    host.emit('openforge-app-events-reconnected', {})
    await vi.waitFor(() => expect(imageAddonMocks.instances[0].reset).toHaveBeenCalled())

    runtime.release('T-1')

    expect(terminalMocks.instances[0].dispose).toHaveBeenCalledOnce()
  })
})
