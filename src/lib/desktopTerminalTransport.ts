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

interface DesktopTerminalModelOutputPayload {
  data: string
  instance_id: number
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
  authority?: 'xterm-authoritative' | 'ghostty-authoritative'
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
  writeTerminalQueryResponse(response: TerminalQueryResponseWrite): Promise<void>
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
  ): Promise<TerminalTransportDisposable> {
    ensureActive()
    const unlisteners: Array<() => void> = []
    try {
      unlisteners.push(await port.listenEvent(`pty-output-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopPtyOutputPayload
        handlers.onOutput({ data: payload.data, ptyInstanceId: payload.instance_id })
      }))
      unlisteners.push(await port.listenEvent(`pty-model-output-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopTerminalModelOutputPayload
        handlers.onModelOutput({
          data: decodeBase64(payload.data),
          ptyInstanceId: payload.instance_id,
          sequence: payload.sequence,
        })
      }))
      unlisteners.push(await port.listenEvent(`pty-model-disabled-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopTerminalModelDisabledPayload
        handlers.onModelDisabled({ ptyInstanceId: payload.instance_id })
      }))
      unlisteners.push(await port.listenEvent(`pty-exit-${shellSessionKey}`, (event) => {
        const payload = event.payload as DesktopPtyExitPayload
        handlers.onExit({ ptyInstanceId: payload.instance_id })
      }))
      ensureActive()
      return track(() => {
        for (const unlisten of unlisteners.reverse()) unlisten()
      })
    } catch (error) {
      for (const unlisten of unlisteners.reverse()) unlisten()
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
        authority: replay.authority,
        data: replay.buffer,
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
