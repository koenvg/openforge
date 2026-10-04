import {
  createLiveModelOutputSubscriptionLifecycle,
  decodeTerminalBase64,
  decodeTerminalReplay,
  type TerminalSessionTransportHandlers,
  type TerminalSessionTransportSubscription,
  type TerminalTransport,
  type TerminalTransportDisposable,
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

export type DesktopPtyBufferState = import('@openforge-app/plugin-sdk').PtyBufferState

export interface DesktopTerminalTransportPort {
  listenEvent(
    eventName: string,
    handler: (event: DesktopTerminalEvent<unknown>) => void,
  ): Promise<() => void>
  getPtyBuffer(shellSessionKey: string): Promise<DesktopPtyBufferState>
  writePty(shellSessionKey: string, data: string | Uint8Array): Promise<void>
  resizePty(shellSessionKey: string, cols: number, rows: number, attachment?: Parameters<TerminalTransport['resize']>[2]): Promise<void>
}

export interface DesktopTerminalTransportOptions {
  beforeConnectionRestored?(): Promise<void>
  afterReadReplay?(
    shellSessionKey: string,
    details: { ptyInstanceId: number | null; watermark: number | null },
  ): Promise<void> | undefined
}


export function createDesktopTerminalTransport(
  port: DesktopTerminalTransportPort,
  options: DesktopTerminalTransportOptions = {},
): TerminalTransport {
  const activeSubscriptions = new Set<TerminalTransportDisposable>()
  let disposed = false
  let connectionGeneration = 0

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
    const modelOutputLifecycle = createLiveModelOutputSubscriptionLifecycle({
      register: () => port.listenEvent(`pty-model-output-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopTerminalModelOutputPayload
        handlers.onModelOutput({
          data: decodeTerminalBase64(payload.data),
          ptyInstanceId: payload.instance_id,
          startSequence: payload.start_sequence ?? payload.sequence,
          sequence: payload.sequence,
        })
      }),
      dispose: unlisten => unlisten(),
      disposedErrorMessage: 'Desktop terminal session subscription is disposed',
    })
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
          await modelOutputLifecycle.setEnabled(enabled)
        },
        snapshot() {
          return modelOutputLifecycle.snapshot()
        },
        dispose() {
          if (!active) return
          active = false
          activeSubscriptions.delete(subscription)
          modelOutputLifecycle.dispose()
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
      () => {
        connectionGeneration += 1
        const reconcile = options.beforeConnectionRestored?.()
        if (reconcile) {
          void reconcile.then(() => { if (!disposed) handler() }, error => {
            console.error('[terminal] Controller reconciliation failed:', error)
            if (!disposed) handler()
          })
        } else handler()
      },
    )
    if (disposed) {
      unlisten()
      throw new Error('Desktop TerminalTransport is disposed')
    }
    return track(unlisten)
  }

  return {
    supportsGeometryLease: true,
    subscribeSession,
    subscribeConnectionRestored,
    async readReplay(shellSessionKey) {
      ensureActive()
      const generation = connectionGeneration
      const replay = await port.getPtyBuffer(shellSessionKey)
      const checkpoint = options.afterReadReplay?.(shellSessionKey, {
        ptyInstanceId: replay.snapshot?.instanceId ?? replay.instanceId,
        watermark: replay.snapshot?.watermark ?? null,
      })
      if (checkpoint) await checkpoint
      ensureActive()
      if (generation !== connectionGeneration) throw new Error('Stale terminal replay from a replaced controller')
      return decodeTerminalReplay(replay)
    },
    async writeUserInput(shellSessionKey, data) {
      ensureActive()
      await port.writePty(shellSessionKey, data)
    },
    async resize(shellSessionKey, geometry, attachment) {
      ensureActive()
      if (attachment) await port.resizePty(shellSessionKey, geometry.cols, geometry.rows, attachment)
      else await port.resizePty(shellSessionKey, geometry.cols, geometry.rows)
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
