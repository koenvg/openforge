export const OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL = 'openforge:event-subscription'

export interface RendererEventSubscriptionRequest {
  action: 'subscribe' | 'unsubscribe'
  eventName: string
}

function parseRequest(value: unknown): RendererEventSubscriptionRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const { action, eventName } = value as Record<string, unknown>
  if (action !== 'subscribe' && action !== 'unsubscribe') return null
  if (typeof eventName !== 'string' || eventName.length === 0) return null
  return { action, eventName }
}

export class RendererEventSubscriptions {
  private readonly subscriptions = new Map<number, Set<string>>()

  update(rendererId: number, value: unknown): boolean {
    const request = parseRequest(value)
    if (!request) return false

    const events = this.subscriptions.get(rendererId) ?? new Set<string>()
    if (request.action === 'subscribe') {
      events.add(request.eventName)
      this.subscriptions.set(rendererId, events)
      return true
    }

    events.delete(request.eventName)
    if (events.size === 0) this.subscriptions.delete(rendererId)
    return true
  }

  has(rendererId: number, eventName: string): boolean {
    return this.subscriptions.get(rendererId)?.has(eventName) ?? false
  }

  clear(rendererId: number): void {
    this.subscriptions.delete(rendererId)
  }
}

interface RendererEventSubscriptionIpc {
  handle(
    channel: string,
    handler: (event: { sender: { id: number } }, request: unknown) => boolean,
  ): void
}

export function registerRendererEventSubscriptionHandler(
  ipc: RendererEventSubscriptionIpc,
  subscriptions: RendererEventSubscriptions,
  currentRendererId: () => number | null,
): void {
  ipc.handle(OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL, (event, request) => {
    const rendererId = currentRendererId()
    if (rendererId === null || event.sender.id !== rendererId) return false
    return subscriptions.update(rendererId, request)
  })
}
