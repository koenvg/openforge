import { describe, expect, it, vi, beforeEach } from 'vitest'
import { writable } from 'svelte/store'
import { createTerminalRuntime, type TerminalRuntimeEvent, type TerminalRuntimeHost } from './terminalRuntime'

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

const imageAddonMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>
    reset: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn(function Terminal() {
    const terminal = {
      write: vi.fn(),
      reset: vi.fn(),
      open: vi.fn(),
      dispose: vi.fn(),
      refresh: vi.fn(),
      focus: vi.fn(),
      loadAddon: vi.fn((addon: { activate?: unknown; options?: { iipSupport?: boolean } }) => {
        if (terminalMocks.failImageAddon && addon.options?.iipSupport) {
          throw new Error('image addon unavailable')
        }
        if (terminalMocks.failCompatibilityAddon && addon.activate && !addon.options?.iipSupport) {
          throw new Error('compatibility addon unavailable')
        }
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
    }
  }),
}))

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: vi.fn(function WebLinksAddon() {
    return {}
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
}

function createHost(): TestHost {
  const listeners = new Map<string, Set<(event: TerminalRuntimeEvent<unknown>) => void>>()
  const buffers = new Map<string, string | null>()

  return {
    themeMode: writable('dark'),
    async listenEvent<TPayload>(eventName: string, handler: (event: TerminalRuntimeEvent<TPayload>) => void) {
      const current = listeners.get(eventName) ?? new Set()
      current.add(handler as (event: TerminalRuntimeEvent<unknown>) => void)
      listeners.set(eventName, current)
      return () => current.delete(handler as (event: TerminalRuntimeEvent<unknown>) => void)
    },
    async getPtyBuffer(taskId: string) {
      return buffers.get(taskId) ?? null
    },
    async writePty() {},
    async resizePty() {},
    async openUrl() {},
    emit<TPayload>(eventName: string, payload: TPayload) {
      for (const listener of listeners.get(eventName) ?? []) {
        listener({ payload })
      }
    },
    setBuffer(taskId: string, buffer: string | null) {
      buffers.set(taskId, buffer)
    },
  }
}

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
