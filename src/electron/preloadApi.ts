export const OPENFORGE_INVOKE_CHANNEL = 'openforge:invoke'
export const OPENFORGE_EVENT_CHANNEL = 'openforge:event'
export const OPENFORGE_APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

export interface PreloadIpcRenderer {
  invoke(channel: string, payload: unknown): Promise<unknown>
  on(channel: string, listener: (event: unknown, payload: unknown) => void): void
  off(channel: string, listener: (event: unknown, payload: unknown) => void): void
}

export interface OpenForgePreloadApi {
  readonly version: 1
  invoke(command: string, payload?: unknown): Promise<unknown>
  onEvent(eventName: string, handler: (payload: unknown) => void): () => void
}

function isEventEnvelope(value: unknown): value is { eventName: string; payload: unknown } {
  return typeof value === 'object'
    && value !== null
    && 'eventName' in value
    && typeof (value as { eventName: unknown }).eventName === 'string'
    && 'payload' in value
}

export function createOpenForgePreloadApi(ipcRenderer: PreloadIpcRenderer): OpenForgePreloadApi {
  const eventHandlers = new Map<string, Array<(payload: unknown) => void>>()
  let isOpenForgeEventListenerRegistered = false

  const dispatchOpenForgeEvent = (_event: unknown, envelope: unknown): void => {
    if (!isEventEnvelope(envelope)) return

    const handlers = eventHandlers.get(envelope.eventName)
    if (!handlers) return

    for (const handler of Array.from(handlers)) {
      handler(envelope.payload)
    }
  }

  function registerOpenForgeEventListener(): void {
    if (isOpenForgeEventListenerRegistered) return

    ipcRenderer.on(OPENFORGE_EVENT_CHANNEL, dispatchOpenForgeEvent)
    isOpenForgeEventListenerRegistered = true
  }

  function hasOpenForgeEventHandlers(): boolean {
    return Array.from(eventHandlers.values()).some((handlers) => handlers.length > 0)
  }

  function unregisterOpenForgeEventListenerIfIdle(): void {
    if (!isOpenForgeEventListenerRegistered || hasOpenForgeEventHandlers()) return

    ipcRenderer.off(OPENFORGE_EVENT_CHANNEL, dispatchOpenForgeEvent)
    isOpenForgeEventListenerRegistered = false
  }

  return Object.freeze({
    version: 1 as const,
    invoke(command: string, payload: unknown = null): Promise<unknown> {
      return ipcRenderer.invoke(OPENFORGE_INVOKE_CHANNEL, { command, payload })
    },
    onEvent(eventName: string, handler: (payload: unknown) => void): () => void {
      let handlers = eventHandlers.get(eventName)
      if (!handlers) {
        handlers = []
        eventHandlers.set(eventName, handlers)
      }

      handlers.push(handler)
      registerOpenForgeEventListener()

      return () => {
        const currentHandlers = eventHandlers.get(eventName)
        if (!currentHandlers) return

        const handlerIndex = currentHandlers.indexOf(handler)
        if (handlerIndex === -1) return

        currentHandlers.splice(handlerIndex, 1)
        if (currentHandlers.length === 0) {
          eventHandlers.delete(eventName)
        }
        unregisterOpenForgeEventListenerIfIdle()
      }
    },
  })
}
