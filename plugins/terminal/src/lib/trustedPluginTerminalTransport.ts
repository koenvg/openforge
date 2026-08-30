import {
  parsePtySessionKey,
  type TerminalSessionTransportHandlers,
  type TerminalSessionTransportSubscription,
  type TerminalTransport,
  type TerminalTransportDisposable,
} from '@openforge-app/terminal-runtime'

interface TrustedPluginDisposable {
  dispose(): void | Promise<void>
}


interface TrustedPluginPtyExitPayload {
  instance_id: number
}

interface TrustedPluginTerminalModelOutputPayload {
  data: string
  instance_id: number
  start_sequence?: number
  sequence: number
}

interface TrustedPluginTerminalModelDisabledPayload {
  instance_id: number
}

interface TrustedPluginTerminalSnapshot {
  data: string
  compatibilityData?: string
  instanceId: number
  watermark: number
}
interface TrustedPluginPtyBufferState {
  buffer: string | null
  isLive: boolean
  instanceId: number | null
  snapshot?: TrustedPluginTerminalSnapshot | null
}

interface IndexedShellRequest {
  taskId: string
  terminalIndex: number
}

export interface TrustedPluginTerminalPort {
  events: {
    onGlobal<TPayload>(eventName: string, handler: (payload: TPayload) => void): TrustedPluginDisposable
  }
  shell: {
    getBuffer(request: IndexedShellRequest): Promise<TrustedPluginPtyBufferState>
    write(request: IndexedShellRequest & { data: string }): Promise<void>
    resize(request: IndexedShellRequest & { cols: number; rows: number }): Promise<void>
  }
}

function parseIndexedShellSessionKey(shellSessionKey: string): IndexedShellRequest {
  const parsed = parsePtySessionKey(shellSessionKey)
  if (parsed.kind !== 'indexed-shell') {
    throw new Error(`[terminal plugin] Expected indexed terminal key, received: ${shellSessionKey}`)
  }
  return { taskId: parsed.taskId, terminalIndex: parsed.terminalIndex }
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createTrustedPluginTerminalTransport(
  getPort: () => TrustedPluginTerminalPort,
): TerminalTransport {
  const activeSubscriptions = new Set<TerminalTransportDisposable>()
  let disposed = false

  function ensureActive(): void {
    if (disposed) throw new Error('Trusted Plugin TerminalTransport is disposed')
  }

  function track(disposables: TrustedPluginDisposable[]): TerminalTransportDisposable {
    let active = true
    const subscription = {
      dispose() {
        if (!active) return
        active = false
        activeSubscriptions.delete(subscription)
        let disposalError: unknown = null
        for (const disposable of disposables) {
          try {
            void disposable.dispose()
          } catch (error) {
            disposalError ??= error
          }
        }
        if (disposalError) throw disposalError
      },
    }
    activeSubscriptions.add(subscription)
    return subscription
  }

  async function subscribeSession(
    shellSessionKey: string,
    handlers: TerminalSessionTransportHandlers,
  ): Promise<TerminalSessionTransportSubscription> {
    ensureActive()
    parseIndexedShellSessionKey(shellSessionKey)
    const events = getPort().events
    const lifecycleSubscriptions: TrustedPluginDisposable[] = []
    let modelOutputSubscription: TrustedPluginDisposable | null = null
    let active = true
    try {
      lifecycleSubscriptions.push(events.onGlobal<TrustedPluginTerminalModelDisabledPayload>(
        `openforge.pty-model-disabled-${shellSessionKey}`,
        payload => handlers.onModelDisabled({ ptyInstanceId: payload.instance_id }),
      ))
      lifecycleSubscriptions.push(events.onGlobal<TrustedPluginPtyExitPayload>(
        `openforge.pty-exit-${shellSessionKey}`,
        payload => handlers.onExit({ ptyInstanceId: payload.instance_id }),
      ))
      ensureActive()
      const subscription: TerminalSessionTransportSubscription = {
        async setModelOutputEnabled(enabled) {
          ensureActive()
          if (!active) throw new Error('Trusted Plugin terminal session subscription is disposed')
          if (!enabled) {
            void modelOutputSubscription?.dispose()
            modelOutputSubscription = null
            return
          }
          if (modelOutputSubscription) return
          modelOutputSubscription = events.onGlobal<TrustedPluginTerminalModelOutputPayload>(
            `openforge.pty-model-output-${shellSessionKey}`,
            payload => handlers.onModelOutput({
              data: decodeBase64(payload.data),
              ptyInstanceId: payload.instance_id,
              startSequence: payload.start_sequence ?? payload.sequence,
              sequence: payload.sequence,
            }),
          )
        },
        dispose() {
          if (!active) return
          active = false
          activeSubscriptions.delete(subscription)
          void modelOutputSubscription?.dispose()
          modelOutputSubscription = null
          for (const lifecycleSubscription of lifecycleSubscriptions) {
            void lifecycleSubscription.dispose()
          }
        },
      }
      activeSubscriptions.add(subscription)
      return subscription
    } catch (error) {
      for (const lifecycleSubscription of lifecycleSubscriptions) {
        void lifecycleSubscription.dispose()
      }
      throw error
    }
  }

  async function subscribeConnectionRestored(
    handler: Parameters<TerminalTransport['subscribeConnectionRestored']>[0],
  ): Promise<TerminalTransportDisposable> {
    ensureActive()
    const subscription = getPort().events.onGlobal<unknown>(
      'openforge.openforge-app-events-reconnected',
      () => handler(),
    )
    if (disposed) {
      void subscription.dispose()
      throw new Error('Trusted Plugin TerminalTransport is disposed')
    }
    return track([subscription])
  }

  async function readReplay(shellSessionKey: string) {
    ensureActive()
    const replay = await getPort().shell.getBuffer(parseIndexedShellSessionKey(shellSessionKey))
    return {
      historicalData: replay.buffer,
      isLive: replay.isLive,
      ptyInstanceId: replay.instanceId,
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
  }

  async function writeUserInput(shellSessionKey: string, data: string): Promise<void> {
    ensureActive()
    await getPort().shell.write({ ...parseIndexedShellSessionKey(shellSessionKey), data })
  }


  async function resize(shellSessionKey: string, geometry: { cols: number; rows: number }): Promise<void> {
    ensureActive()
    await getPort().shell.resize({
      ...parseIndexedShellSessionKey(shellSessionKey),
      cols: geometry.cols,
      rows: geometry.rows,
    })
  }

  return {
    subscribeSession,
    subscribeConnectionRestored,
    readReplay,
    writeUserInput,
    resize,
    dispose() {
      if (disposed) return
      disposed = true
      let disposalError: unknown = null
      for (const subscription of [...activeSubscriptions]) {
        try {
          subscription.dispose()
        } catch (error) {
          disposalError ??= error
        }
      }
      if (disposalError) throw disposalError
    },
  }
}
