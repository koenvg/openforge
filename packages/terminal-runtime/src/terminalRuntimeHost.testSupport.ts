import { writable } from 'svelte/store'
import { vi, type Mock } from 'vitest'
import type {
  TerminalRuntimeEnvironment,
  PoolEntry,
  TerminalRuntime,
  TerminalRuntimeOptions,
  TerminalSessionTransportHandlers,
  TerminalTransport,
} from './terminalRuntime'

interface TestReplaySnapshot {
  instanceId: number
  watermark: number
  data: string
  compatibilityData?: string
}

interface TestReplayState {
  buffer?: string | null
  isLive: boolean
  instanceId?: number | null
  ptyInstanceId?: number | null
  snapshot?: TestReplaySnapshot | null
}

interface RawPtyInstancePayload {
  instance_id?: number
  ptyInstanceId?: number
}


interface RawPtyModelOutputPayload extends RawPtyInstancePayload {
  data: string
  start_sequence?: number
  sequence: number
}

const SESSION_EVENT_PREFIXES = {
  modelOutput: 'pty-model-output-',
  modelDisabled: 'pty-model-disabled-',
  exit: 'pty-exit-',
} as const

function parseSessionEventName(eventName: string): string | undefined {
  const prefix = Object.values(SESSION_EVENT_PREFIXES).find(candidate => eventName.startsWith(candidate))
  return prefix === undefined ? undefined : eventName.slice(prefix.length)
}

interface TestTransport extends TerminalTransport {
  subscribeSession: Mock<TerminalTransport['subscribeSession']>
  subscribeConnectionRestored: Mock<TerminalTransport['subscribeConnectionRestored']>
  readReplay: Mock<TerminalTransport['readReplay']>
  writeUserInput: Mock<TerminalTransport['writeUserInput']>
  resize: Mock<TerminalTransport['resize']>
  dispose: Mock<TerminalTransport['dispose']>
}

export interface ListenerRegistrationFailureSupport {
  throwIfRequested(eventName: string): void
}

interface CreateHostOptions {
  listenerRegistrationFailures?: ListenerRegistrationFailureSupport
}


interface TestSessionRegistration {
  handlers: TerminalSessionTransportHandlers
  modelOutputEnabled: boolean
}
export interface TestHost extends TerminalRuntimeOptions {
  transport: TestTransport
  environment: TerminalRuntimeEnvironment & { openLink: ReturnType<typeof vi.fn> }
  getPtyBuffer(taskId: string): Promise<TestReplayState>
  writePty(taskId: string, data: string): Promise<void>
  resizePty(taskId: string, cols: number, rows: number): Promise<void>
  openLink: ReturnType<typeof vi.fn>
  themeMode: TerminalRuntimeEnvironment['themeMode']
  loggerName: string | undefined
  enableImages: boolean | undefined
  emit<TPayload>(eventName: string, payload: TPayload): void
  setBuffer(shellSessionKey: string, buffer: string | null): void
  getListenerCount(eventName: string): number
  deferBufferRead(shellSessionKey: string): () => void
  deferListenerRegistration(eventName: string): () => void
}

function createDeferredGate(): { promise: Promise<void>; release: () => void } {
  let release!: () => void
  const promise = new Promise<void>(resolve => {
    release = resolve
  })
  return { promise, release }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}


export async function attachTestTerminal(runtime: TerminalRuntime, entry: PoolEntry): Promise<void> {
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
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(640)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(480)
  await runtime.attach(entry, document.createElement('div'))
}
export function createHost({ listenerRegistrationFailures }: CreateHostOptions = {}): TestHost {
  const sessionHandlers = new Map<string, Set<TestSessionRegistration>>()
  const connectionRestoredHandlers = new Set<() => void>()
  const buffers = new Map<string, string | null>()
  const bufferReadGates = new Map<string, ReturnType<typeof createDeferredGate>>()
  const listenerRegistrationGates = new Map<string, ReturnType<typeof createDeferredGate>>()
  const openLink = vi.fn(async () => undefined)
  const environment: TestHost['environment'] = {
    openLink,
    themeMode: writable('dark'),
  }
  let host!: TestHost

  async function registerEvent(eventName: string): Promise<void> {
    await listenerRegistrationGates.get(eventName)?.promise
    listenerRegistrationFailures?.throwIfRequested(eventName)
  }

  function dispatchSessionEvent<TRawPayload extends RawPtyInstancePayload, TEvent>(
    eventName: string,
    eventPrefix: string,
    payload: unknown,
    decodeEvent: (rawPayload: TRawPayload, ptyInstanceId: number) => TEvent,
    handleEvent: (handlers: TerminalSessionTransportHandlers, event: TEvent) => void,
  ): boolean {
    if (!eventName.startsWith(eventPrefix)) return false
    const rawPayload = payload as TRawPayload
    const ptyInstanceId = rawPayload.ptyInstanceId ?? rawPayload.instance_id
    if (ptyInstanceId === undefined) return true
    const event = decodeEvent(rawPayload, ptyInstanceId)
    const shellSessionKey = eventName.slice(eventPrefix.length)
    for (const registration of sessionHandlers.get(shellSessionKey) ?? []) {
      if (eventPrefix === SESSION_EVENT_PREFIXES.modelOutput && !registration.modelOutputEnabled) {
        continue
      }
      handleEvent(registration.handlers, event)
    }
    return true
  }

  const transport: TestTransport = {
    subscribeSession: vi.fn(async (shellSessionKey: string, handlers: TerminalSessionTransportHandlers) => {
      await registerEvent(`${SESSION_EVENT_PREFIXES.modelDisabled}${shellSessionKey}`)
      await registerEvent(`${SESSION_EVENT_PREFIXES.exit}${shellSessionKey}`)
      const current = sessionHandlers.get(shellSessionKey) ?? new Set<TestSessionRegistration>()
      const registration: TestSessionRegistration = { handlers, modelOutputEnabled: false }
      current.add(registration)
      sessionHandlers.set(shellSessionKey, current)
      return {
        setModelOutputEnabled: vi.fn(async (enabled: boolean) => {
          if (enabled && !registration.modelOutputEnabled) {
            await registerEvent(`${SESSION_EVENT_PREFIXES.modelOutput}${shellSessionKey}`)
          }
          registration.modelOutputEnabled = enabled
        }),
        dispose: vi.fn(() => current.delete(registration)),
      }
    }),
    subscribeConnectionRestored: vi.fn(async (handler: () => void) => {
      await registerEvent('openforge-app-events-reconnected')
      connectionRestoredHandlers.add(handler)
      return { dispose: vi.fn(() => connectionRestoredHandlers.delete(handler)) }
    }),
    readReplay: vi.fn(async (shellSessionKey: string) => {
      const replay = await host.getPtyBuffer(shellSessionKey)
      return {
        historicalData: replay.buffer ?? null,
        isLive: replay.isLive,
        ptyInstanceId: replay.ptyInstanceId ?? replay.instanceId ?? null,
        snapshot: replay.snapshot
          ? {
              data: decodeBase64(replay.snapshot.data),
              ptyInstanceId: replay.snapshot.instanceId,
              watermark: replay.snapshot.watermark,
              compatibilityData: replay.snapshot.compatibilityData
                ? decodeBase64(replay.snapshot.compatibilityData)
                : undefined,
            }
          : undefined,
      }
    }),
    writeUserInput: vi.fn((shellSessionKey: string, data: string) => host.writePty(shellSessionKey, data)),
    resize: vi.fn((shellSessionKey: string, geometry: { cols: number; rows: number }) => (
      host.resizePty(shellSessionKey, geometry.cols, geometry.rows)
    )),
    dispose: vi.fn(() => {
      sessionHandlers.clear()
      connectionRestoredHandlers.clear()
    }),
  }

  host = {
    transport,
    environment,
    async getPtyBuffer(shellSessionKey: string) {
      await bufferReadGates.get(shellSessionKey)?.promise
      const buffer = buffers.get(shellSessionKey) ?? null
      if (buffer === null) return { buffer: null, isLive: false, instanceId: null }
      return {
        buffer: null,
        isLive: true,
        instanceId: 1,
        snapshot: { instanceId: 1, watermark: 0, data: btoa(buffer) },
      }
    },
    async writePty() {},
    async resizePty() {},
    openLink,
    themeMode: environment.themeMode,
    loggerName: environment.loggerName,
    enableImages: environment.enableImages,
    emit<TPayload>(eventName: string, payload: TPayload) {
      if (eventName === 'openforge-app-events-reconnected') {
        for (const handler of connectionRestoredHandlers) handler()
        return
      }
      if (dispatchSessionEvent(
        eventName,
        SESSION_EVENT_PREFIXES.modelOutput,
        payload,
        (raw: RawPtyModelOutputPayload, ptyInstanceId) => ({
          data: decodeBase64(raw.data),
          ptyInstanceId,
          startSequence: raw.start_sequence ?? raw.sequence,
          sequence: raw.sequence,
        }),
        (handlers, event) => handlers.onModelOutput(event),
      )) return
      if (dispatchSessionEvent(
        eventName,
        SESSION_EVENT_PREFIXES.modelDisabled,
        payload,
        (_raw: RawPtyInstancePayload, ptyInstanceId) => ({ ptyInstanceId }),
        (handlers, event) => handlers.onModelDisabled(event),
      )) return
      dispatchSessionEvent(
        eventName,
        SESSION_EVENT_PREFIXES.exit,
        payload,
        (_raw: RawPtyInstancePayload, ptyInstanceId) => ({ ptyInstanceId }),
        (handlers, event) => handlers.onExit(event),
      )
    },
    setBuffer(shellSessionKey: string, buffer: string | null) {
      buffers.set(shellSessionKey, buffer)
    },
    deferBufferRead(shellSessionKey: string) {
      const gate = createDeferredGate()
      bufferReadGates.set(shellSessionKey, gate)
      return () => {
        if (bufferReadGates.get(shellSessionKey) === gate) bufferReadGates.delete(shellSessionKey)
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
    getListenerCount(eventName: string) {
      if (eventName === 'openforge-app-events-reconnected') return connectionRestoredHandlers.size
      const shellSessionKey = parseSessionEventName(eventName)
      if (shellSessionKey !== undefined) {
        const registrations = sessionHandlers.get(shellSessionKey) ?? new Set<TestSessionRegistration>()
        if (eventName.startsWith(SESSION_EVENT_PREFIXES.modelOutput)) {
          return Array.from(registrations).filter(registration => registration.modelOutputEnabled).length
        }
        return registrations.size
      }
      return 0
    },
  }

  Object.defineProperties(host, {
    themeMode: {
      get: () => environment.themeMode,
      set: value => { environment.themeMode = value },
    },
    loggerName: {
      get: () => environment.loggerName,
      set: value => { environment.loggerName = value },
    },
    enableImages: {
      get: () => environment.enableImages,
      set: value => { environment.enableImages = value },
    },
  })

  return host
}
