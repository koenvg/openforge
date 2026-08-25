import { vi } from 'vitest'
import { writable } from 'svelte/store'
import type { TerminalRuntimeEvent, TerminalRuntimeHost, TerminalView } from './terminalRuntime'
import type { TerminalViewSnapshot } from './terminalRuntimeTypes'

const hoistedTerminalMocks = vi.hoisted(() => ({
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

const hoistedWebLinkMocks = vi.hoisted(() => ({
  callbacks: [] as Array<(event: MouseEvent, uri: string) => void>,
}))

const hoistedImageAddonMocks = vi.hoisted(() => ({
  instances: [] as Array<{
    options: Record<string, unknown>
    reset: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
  }>,
}))

export const terminalMocks = {
  get failCompatibilityAddon() { return hoistedTerminalMocks.failCompatibilityAddon },
  set failCompatibilityAddon(value: boolean) { hoistedTerminalMocks.failCompatibilityAddon = value },
  get failImageAddon() { return hoistedTerminalMocks.failImageAddon },
  set failImageAddon(value: boolean) { hoistedTerminalMocks.failImageAddon = value },
  get instances() { return hoistedTerminalMocks.instances },
}

export const webLinkMocks = {
  get callbacks() { return hoistedWebLinkMocks.callbacks },
}

export const imageAddonMocks = {
  get instances() { return hoistedImageAddonMocks.instances },
}

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
        if (hoistedTerminalMocks.failImageAddon && addon.options?.iipSupport) {
          throw new Error('image addon unavailable')
        }
        if (hoistedTerminalMocks.failCompatibilityAddon && addon.activate && !addon.options?.iipSupport) {
          throw new Error('compatibility addon unavailable')
        }
        loadedAddons.push(addon)
      }),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      attachCustomKeyEventHandler: vi.fn(),
      cols: 80,
      rows: 24,
      options: {},
    }
    hoistedTerminalMocks.instances.push(terminal)
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
    hoistedWebLinkMocks.callbacks.push(callback)
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
    hoistedImageAddonMocks.instances.push(addon)
    return addon
  }),
}))

export interface TestHost extends TerminalRuntimeHost {
  emit<TPayload>(eventName: string, payload: TPayload): void
  setBuffer(taskId: string, buffer: string | null): void
  setTerminalViewSnapshot(taskId: string, snapshot: TerminalViewSnapshot | null): void
  deferTerminalViewSnapshot(taskId: string): () => void
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

export function createHost(): TestHost {
  const listeners = new Map<string, Set<(event: TerminalRuntimeEvent<unknown>) => void>>()
  const buffers = new Map<string, string | null>()
  const bufferReadGates = new Map<string, ReturnType<typeof createDeferredGate>>()
  const terminalViewSnapshots = new Map<string, TerminalViewSnapshot | null>()
  const terminalViewSnapshotGates = new Map<string, ReturnType<typeof createDeferredGate>>()
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
      const buffer = buffers.get(taskId) ?? null
      return { buffer, isLive: buffer !== null }
    },
    async getTerminalViewSnapshot(taskId: string) {
      await terminalViewSnapshotGates.get(taskId)?.promise
      return terminalViewSnapshots.get(taskId) ?? null
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
    setTerminalViewSnapshot(taskId: string, snapshot: TerminalViewSnapshot | null) {
      terminalViewSnapshots.set(taskId, snapshot)
    },
    deferTerminalViewSnapshot(taskId: string) {
      const gate = createDeferredGate()
      terminalViewSnapshotGates.set(taskId, gate)
      return () => {
        if (terminalViewSnapshotGates.get(taskId) === gate) terminalViewSnapshotGates.delete(taskId)
        gate.release()
      }
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

export function createTrackedThemeMode() {
  const themeMode = writable<'light' | 'dark'>('dark')
  let subscriberCount = 0
  const store: NonNullable<TerminalRuntimeHost['themeMode']> = {
    subscribe(run) {
      subscriberCount += 1
      const unsubscribe = themeMode.subscribe(run)
      return () => {
        unsubscribe()
        subscriberCount -= 1
      }
    },
  }

  return { store, getSubscriberCount: () => subscriberCount }
}

export function createFakeTerminalView(overrides: Partial<TerminalView> = {}): TerminalView {
  return {
    geometry: { cols: 80, rows: 24 },
    imageProtocol: null,
    mount: vi.fn(),
    unmount: vi.fn(),
    isMountedIn: vi.fn(() => false),
    bootstrap: vi.fn(),
    writeLive: vi.fn(),
    focus: vi.fn(),
    reset: vi.fn(),
    refresh: vi.fn(),
    fit: vi.fn(() => ({ cols: 80, rows: 24 })),
    onUserInput: vi.fn(() => ({ dispose: vi.fn() })),
    setKeyEventHandler: vi.fn(),
    getSelectionText: vi.fn(() => ''),
    setTheme: vi.fn(),
    onRendererFailure: vi.fn(() => ({ dispose: vi.fn() })),
    dispose: vi.fn(),
    ...overrides,
  }
}

export function resetTerminalRuntimeIntegrationHarness(): void {
  terminalMocks.failCompatibilityAddon = false
  terminalMocks.failImageAddon = false
  terminalMocks.instances.length = 0
  webLinkMocks.callbacks.length = 0
  imageAddonMocks.instances.length = 0
}
