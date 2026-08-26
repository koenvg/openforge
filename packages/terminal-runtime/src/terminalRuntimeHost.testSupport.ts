import { writable } from 'svelte/store'
import { vi, type Mock } from 'vitest'
import type {
  TerminalRuntimeEnvironment,
  TerminalRuntimeOptions,
  TerminalSessionTransportHandlers,
  TerminalTransport,
} from './terminalRuntime'

interface TestReplaySnapshot {
  instanceId: number
  watermark: number
  data: string
}

interface TestReplayState {
  authority?: 'xterm-authoritative' | 'ghostty-authoritative'
  buffer?: string | null
  data?: string | null
  isLive: boolean
  instanceId?: number | null
  ptyInstanceId?: number | null
  snapshot?: TestReplaySnapshot | null
}

interface TestTransport extends TerminalTransport {
  subscribeSession: Mock<TerminalTransport['subscribeSession']>
  subscribeConnectionRestored: Mock<TerminalTransport['subscribeConnectionRestored']>
  readReplay: Mock<TerminalTransport['readReplay']>
  writeUserInput: Mock<TerminalTransport['writeUserInput']>
  writeQueryResponse: Mock<TerminalTransport['writeQueryResponse']>
  resize: Mock<TerminalTransport['resize']>
  dispose: Mock<TerminalTransport['dispose']>
}

export interface ListenerRegistrationFailureSupport {
  throwIfRequested(eventName: string): void
}

interface CreateHostOptions {
  listenerRegistrationFailures?: ListenerRegistrationFailureSupport
}

export interface TestHost extends TerminalRuntimeOptions {
  transport: TestTransport
  environment: TerminalRuntimeEnvironment & { openLink: ReturnType<typeof vi.fn> }
  getPtyBuffer(taskId: string): Promise<TestReplayState>
  writePty(taskId: string, data: string): Promise<void>
  writeTerminalQueryResponse(response: unknown): Promise<void>
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

export function createHost({ listenerRegistrationFailures }: CreateHostOptions = {}): TestHost {
  const sessionHandlers = new Map<string, Set<TerminalSessionTransportHandlers>>()
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

  const transport: TestTransport = {
    subscribeSession: vi.fn(async (shellSessionKey: string, handlers: TerminalSessionTransportHandlers) => {
      await registerEvent(`pty-output-${shellSessionKey}`)
      await registerEvent(`pty-model-output-${shellSessionKey}`)
      await registerEvent(`pty-model-disabled-${shellSessionKey}`)
      await registerEvent(`pty-exit-${shellSessionKey}`)
      const current = sessionHandlers.get(shellSessionKey) ?? new Set()
      current.add(handlers)
      sessionHandlers.set(shellSessionKey, current)
      return { dispose: vi.fn(() => current.delete(handlers)) }
    }),
    subscribeConnectionRestored: vi.fn(async (handler: () => void) => {
      await registerEvent('openforge-app-events-reconnected')
      connectionRestoredHandlers.add(handler)
      return { dispose: vi.fn(() => connectionRestoredHandlers.delete(handler)) }
    }),
    readReplay: vi.fn(async (shellSessionKey: string) => {
      const replay = await host.getPtyBuffer(shellSessionKey)
      return {
        authority: replay.authority,
        data: replay.data ?? replay.buffer ?? null,
        isLive: replay.isLive,
        ptyInstanceId: replay.ptyInstanceId ?? replay.instanceId ?? null,
        snapshot: replay.snapshot
          ? {
              data: decodeBase64(replay.snapshot.data),
              ptyInstanceId: replay.snapshot.instanceId,
              watermark: replay.snapshot.watermark,
            }
          : undefined,
      }
    }),
    writeUserInput: vi.fn((shellSessionKey: string, data: string) => host.writePty(shellSessionKey, data)),
    writeQueryResponse: vi.fn(response => host.writeTerminalQueryResponse(response)),
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
      return { buffer, isLive: buffer !== null, instanceId: null }
    },
    async writePty() {},
    async writeTerminalQueryResponse() {},
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
      const outputPrefix = 'pty-output-'
      if (eventName.startsWith(outputPrefix)) {
        const raw = payload as { data: string; instance_id?: number; ptyInstanceId?: number }
        const ptyInstanceId = raw.ptyInstanceId ?? raw.instance_id
        if (ptyInstanceId === undefined) return
        for (const handlers of sessionHandlers.get(eventName.slice(outputPrefix.length)) ?? []) {
          handlers.onOutput({ data: raw.data, ptyInstanceId })
        }
        return
      }
      const modelOutputPrefix = 'pty-model-output-'
      if (eventName.startsWith(modelOutputPrefix)) {
        const raw = payload as { data: string; instance_id?: number; ptyInstanceId?: number; sequence: number }
        const ptyInstanceId = raw.ptyInstanceId ?? raw.instance_id
        if (ptyInstanceId === undefined) return
        for (const handlers of sessionHandlers.get(eventName.slice(modelOutputPrefix.length)) ?? []) {
          handlers.onModelOutput({ data: decodeBase64(raw.data), ptyInstanceId, sequence: raw.sequence })
        }
        return
      }
      const modelDisabledPrefix = 'pty-model-disabled-'
      if (eventName.startsWith(modelDisabledPrefix)) {
        const raw = payload as { instance_id?: number; ptyInstanceId?: number }
        const ptyInstanceId = raw.ptyInstanceId ?? raw.instance_id
        if (ptyInstanceId === undefined) return
        for (const handlers of sessionHandlers.get(eventName.slice(modelDisabledPrefix.length)) ?? []) {
          handlers.onModelDisabled({ ptyInstanceId })
        }
        return
      }
      const exitPrefix = 'pty-exit-'
      if (eventName.startsWith(exitPrefix)) {
        const raw = payload as { instance_id?: number; ptyInstanceId?: number }
        const ptyInstanceId = raw.ptyInstanceId ?? raw.instance_id
        if (ptyInstanceId === undefined) return
        for (const handlers of sessionHandlers.get(eventName.slice(exitPrefix.length)) ?? []) {
          handlers.onExit({ ptyInstanceId })
        }
      }
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
      if (eventName.startsWith('pty-output-')) {
        return sessionHandlers.get(eventName.slice('pty-output-'.length))?.size ?? 0
      }
      if (eventName.startsWith('pty-exit-')) {
        return sessionHandlers.get(eventName.slice('pty-exit-'.length))?.size ?? 0
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
