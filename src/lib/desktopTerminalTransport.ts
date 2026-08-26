import type {
  TerminalQueryResponseWrite,
  TerminalSessionTransportHandlers,
  TerminalTransport,
  TerminalTransportDisposable,
} from '@openforge-app/terminal-runtime'

interface DesktopTerminalEvent<TPayload> {
  payload: TPayload
}

interface DesktopPtyOutputPayload {
  data: string
  instance_id: number
  shell_session_key: string
}

interface DesktopPtyExitPayload {
  instance_id: number
}
export interface DesktopPtyBufferState {
  buffer: string | null
  isLive: boolean
  instanceId: number | null
}

export interface DesktopTerminalTransportPort {
  listenEvent(
    eventName: string,
    handler: (event: DesktopTerminalEvent<unknown>) => void,
  ): Promise<() => void>
  getPtyBuffer(shellSessionKey: string): Promise<DesktopPtyBufferState>
  writePty(shellSessionKey: string, data: string): Promise<void>
  writeTerminalQueryResponse(response: TerminalQueryResponseWrite): Promise<void>
  resizePty(shellSessionKey: string, cols: number, rows: number): Promise<void>
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
  ): Promise<TerminalTransportDisposable> {
    ensureActive()
    const unlistenOutput = await port.listenEvent(
      `pty-output-${shellSessionKey}`,
      (event) => {
        const payload = event.payload as DesktopPtyOutputPayload
        handlers.onOutput({
          data: payload.data,
          ptyInstanceId: payload.instance_id,
        })
      },
    )
    try {
      ensureActive()
      const unlistenExit = await port.listenEvent(
        `pty-exit-${shellSessionKey}`,
        (event) => {
          const payload = event.payload as DesktopPtyExitPayload
          handlers.onExit({ ptyInstanceId: payload.instance_id })
        },
      )
      if (disposed) {
        unlistenExit()
        throw new Error('Desktop TerminalTransport is disposed')
      }
      return track(() => {
        try {
          unlistenOutput()
        } finally {
          unlistenExit()
        }
      })
    } catch (error) {
      unlistenOutput()
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
        data: replay.buffer,
        isLive: replay.isLive,
        ptyInstanceId: replay.instanceId,
      }
    },
    async writeUserInput(shellSessionKey, data) {
      ensureActive()
      await port.writePty(shellSessionKey, data)
    },
    async writeQueryResponse(response) {
      ensureActive()
      await port.writeTerminalQueryResponse(response)
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
