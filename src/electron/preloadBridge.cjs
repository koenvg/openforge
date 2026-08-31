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
  const eventSubscriptionUpdates = new Map()
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

  function updateEventSubscription(eventName, action) {
    const previous = eventSubscriptionUpdates.get(eventName) ?? Promise.resolve()
    const update = previous
      .catch(() => undefined)
      .then(async () => {
        const accepted = await ipcRenderer.invoke(OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL, { action, eventName })
        if (accepted !== true) throw new Error(`Electron main rejected ${action} for app event "${eventName}"`)
      })
      .finally(() => {
        if (eventSubscriptionUpdates.get(eventName) === update) {
          eventSubscriptionUpdates.delete(eventName)
        }
      })
    eventSubscriptionUpdates.set(eventName, update)
    return update
  }

  function registerEventHandler(eventName, handler) {
    let handlers = eventHandlers.get(eventName)
    const isFirstHandler = !handlers
    if (!handlers) {
      handlers = []
      eventHandlers.set(eventName, handlers)
    }

    handlers.push(handler)
    registerOpenForgeEventListener()
    let active = true
    const remove = notifyMain => {
      if (!active) return
      active = false
      const currentHandlers = eventHandlers.get(eventName)
      const handlerIndex = currentHandlers?.indexOf(handler) ?? -1
      if (handlerIndex !== -1) currentHandlers.splice(handlerIndex, 1)
      if (currentHandlers?.length === 0) {
        eventHandlers.delete(eventName)
        if (notifyMain) {
          void updateEventSubscription(eventName, 'unsubscribe').catch(() => undefined)
        }
      }
      unregisterOpenForgeEventListenerIfIdle()
    }
    const registration = isFirstHandler
      ? updateEventSubscription(eventName, 'subscribe')
      : eventSubscriptionUpdates.get(eventName) ?? Promise.resolve()
    const ready = registration.catch(error => {
      remove(false)
      throw error
    })
    return { ready, unsubscribe: () => remove(true) }
  }

  return Object.freeze({
    version: 1,
    invoke(command, payload = null) {
      return ipcRenderer.invoke(OPENFORGE_INVOKE_CHANNEL, { command, payload })
    },
    onEvent(eventName, handler) {
      const subscription = registerEventHandler(eventName, handler)
      void subscription.ready.catch(() => undefined)
      return subscription.unsubscribe
    },
    async onEventReady(eventName, handler) {
      const subscription = registerEventHandler(eventName, handler)
      await subscription.ready
      return subscription.unsubscribe
    },
  })
}

module.exports = {
  OPENFORGE_INVOKE_CHANNEL,
  OPENFORGE_EVENT_CHANNEL,
  OPENFORGE_APP_EVENTS_RECONNECTED_EVENT,
  createOpenForgePreloadApi,
}
