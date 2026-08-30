import type {
  TerminalSessionTransportHandlers,
  TerminalSessionTransportSubscription,
  TerminalTransport,
  TerminalTransportDisposable,
} from '@openforge-app/terminal-runtime'

interface DesktopTerminalEvent<TPayload> {
  payload: TPayload
}


interface DesktopPtyExitPayload {
  instance_id: number
}

interface DesktopTerminalModelOutputPayload {
  data: string
  instance_id: number
  start_sequence?: number
  sequence: number
}

interface DesktopTerminalModelDisabledPayload {
  instance_id: number
}

interface DesktopTerminalSnapshot {
  data: string
  compatibilityData?: string
  instanceId: number
  watermark: number
}
export interface DesktopPtyBufferState {
  buffer: string | null
  isLive: boolean
  instanceId: number | null
  snapshot?: DesktopTerminalSnapshot
}

export interface DesktopTerminalTransportPort {
  listenEvent(
    eventName: string,
    handler: (event: DesktopTerminalEvent<unknown>) => void,
  ): Promise<() => void>
  getPtyBuffer(shellSessionKey: string): Promise<DesktopPtyBufferState>
  writePty(shellSessionKey: string, data: string): Promise<void>
  resizePty(shellSessionKey: string, cols: number, rows: number): Promise<void>
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export function createDesktopTerminalTransport(
  port: DesktopTerminalTransportPort,
): TerminalTransport {
  const activeSubscriptions = new Set<TerminalTransportDisposable>()
  let disposed = false

  function ensureActive(): void {
    if (disposed) throw new Error('Desktop TerminalTransport is disposed')
  }

  function track(disposeSubscription: () => void): TerminalTransportDisposable {
    let active = true
    const subscription = {
      dispose() {
        if (!active) return
        active = false
        activeSubscriptions.delete(subscription)
        disposeSubscription()
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
    const lifecycleUnlisteners: Array<() => void> = []
    let modelOutputUnlisten: (() => void) | null = null
    let modelOutputRegistration: Promise<void> | null = null
    let modelOutputDesired = false
    let active = true
    try {
      lifecycleUnlisteners.push(await port.listenEvent(`pty-model-disabled-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopTerminalModelDisabledPayload
        handlers.onModelDisabled({ ptyInstanceId: payload.instance_id })
      }))
      lifecycleUnlisteners.push(await port.listenEvent(`pty-exit-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopPtyExitPayload
        handlers.onExit({ ptyInstanceId: payload.instance_id })
      }))
      ensureActive()
      const subscription: TerminalSessionTransportSubscription = {
        async setModelOutputEnabled(enabled) {
          ensureActive()
          if (!active) throw new Error('Desktop terminal session subscription is disposed')
          modelOutputDesired = enabled
          if (!enabled) {
            modelOutputUnlisten?.()
            modelOutputUnlisten = null
            await modelOutputRegistration
            return
          }
          if (modelOutputUnlisten) return
          if (modelOutputRegistration) return modelOutputRegistration

          const registration = port.listenEvent(`pty-model-output-${shellSessionKey}`, (event) => {
            const payload = event.payload as DesktopTerminalModelOutputPayload
            handlers.onModelOutput({
              data: decodeBase64(payload.data),
              ptyInstanceId: payload.instance_id,
              startSequence: payload.start_sequence ?? payload.sequence,
              sequence: payload.sequence,
            })
          }).then((unlisten) => {
            if (!active || disposed || !modelOutputDesired) {
              unlisten()
              return
            }
            modelOutputUnlisten = unlisten
          })
          modelOutputRegistration = registration
          try {
            await registration
          } finally {
            if (modelOutputRegistration === registration) modelOutputRegistration = null
          }
        },
        dispose() {
          if (!active) return
          active = false
          activeSubscriptions.delete(subscription)
          modelOutputDesired = false
          modelOutputUnlisten?.()
          modelOutputUnlisten = null
          for (const unlisten of lifecycleUnlisteners.reverse()) unlisten()
        },
      }
      activeSubscriptions.add(subscription)
      return subscription
    } catch (error) {
      for (const unlisten of lifecycleUnlisteners.reverse()) unlisten()
      throw error
    }
  }

  async function subscribeConnectionRestored(
    handler: Parameters<TerminalTransport['subscribeConnectionRestored']>[0],
  ): Promise<TerminalTransportDisposable> {
    ensureActive()
    const unlisten = await port.listenEvent(
      'openforge-app-events-reconnected',
      () => handler(),
    )
    if (disposed) {
      unlisten()
      throw new Error('Desktop TerminalTransport is disposed')
    }
    return track(unlisten)
  }

  return {
    subscribeSession,
    subscribeConnectionRestored,
    async readReplay(shellSessionKey) {
      ensureActive()
      const replay = await port.getPtyBuffer(shellSessionKey)
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
    },
    async writeUserInput(shellSessionKey, data) {
      ensureActive()
      await port.writePty(shellSessionKey, data)
    },
    async resize(shellSessionKey, geometry) {
      ensureActive()
      await port.resizePty(shellSessionKey, geometry.cols, geometry.rows)
    },
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
