const OPENFORGE_INVOKE_CHANNEL = 'openforge:invoke'
const OPENFORGE_EVENT_CHANNEL = 'openforge:event'
const OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL = 'openforge:event-subscription'
const OPENFORGE_APP_EVENTS_RECONNECTED_EVENT = 'openforge-app-events-reconnected'

function isEventEnvelope(value) {
  return typeof value === 'object'
    && value !== null
    && 'eventName' in value
    && typeof value.eventName === 'string'
    && 'payload' in value
}

function createOpenForgePreloadApi(ipcRenderer) {
  const eventHandlers = new Map()
  let isOpenForgeEventListenerRegistered = false

  const dispatchOpenForgeEvent = (_event, envelope) => {
    if (!isEventEnvelope(envelope)) return

    const handlers = eventHandlers.get(envelope.eventName)
    if (!handlers) return

    for (const handler of Array.from(handlers)) {
      handler(envelope.payload)
    }
  }

  function registerOpenForgeEventListener() {
    if (isOpenForgeEventListenerRegistered) return

    ipcRenderer.on(OPENFORGE_EVENT_CHANNEL, dispatchOpenForgeEvent)
    isOpenForgeEventListenerRegistered = true
  }

  function hasOpenForgeEventHandlers() {
    return Array.from(eventHandlers.values()).some((handlers) => handlers.length > 0)
  }

  function unregisterOpenForgeEventListenerIfIdle() {
    if (!isOpenForgeEventListenerRegistered || hasOpenForgeEventHandlers()) return

    ipcRenderer.off(OPENFORGE_EVENT_CHANNEL, dispatchOpenForgeEvent)
    isOpenForgeEventListenerRegistered = false
  }

  return Object.freeze({
    version: 1,
    invoke(command, payload = null) {
      return ipcRenderer.invoke(OPENFORGE_INVOKE_CHANNEL, { command, payload })
    },
    onEvent(eventName, handler) {
      let handlers = eventHandlers.get(eventName)
      const isFirstHandler = !handlers
      if (!handlers) {
        handlers = []
        eventHandlers.set(eventName, handlers)
      }

      handlers.push(handler)
      registerOpenForgeEventListener()
      if (isFirstHandler) {
        ipcRenderer.send?.(OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL, { action: 'subscribe', eventName })
      }

      return () => {
        const currentHandlers = eventHandlers.get(eventName)
        if (!currentHandlers) return

        const handlerIndex = currentHandlers.indexOf(handler)
        if (handlerIndex === -1) return

        currentHandlers.splice(handlerIndex, 1)
        if (currentHandlers.length === 0) {
          eventHandlers.delete(eventName)
          ipcRenderer.send?.(OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL, { action: 'unsubscribe', eventName })
        }
        unregisterOpenForgeEventListenerIfIdle()
      }
    },
  })
}

module.exports = {
  OPENFORGE_INVOKE_CHANNEL,
  OPENFORGE_EVENT_CHANNEL,
  OPENFORGE_APP_EVENTS_RECONNECTED_EVENT,
  createOpenForgePreloadApi,
}
