const { contextBridge, ipcRenderer } = require('electron') as typeof import('electron')

const OPENFORGE_INVOKE_CHANNEL = 'openforge:invoke'
const OPENFORGE_EVENT_CHANNEL = 'openforge:event'

interface EventEnvelope {
  eventName: string
  payload: unknown
}

function isEventEnvelope(value: unknown): value is EventEnvelope {
  return typeof value === 'object'
    && value !== null
    && 'eventName' in value
    && typeof (value as { eventName: unknown }).eventName === 'string'
    && 'payload' in value
}

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

const openForgeApi = Object.freeze({
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

contextBridge.exposeInMainWorld('openforge', openForgeApi)
