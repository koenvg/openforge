import { describe, expect, it } from 'vitest'
import {
  OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL,
  RendererEventSubscriptions,
  registerRendererEventSubscriptionHandler,
} from './rendererEventSubscriptions'

describe('renderer event subscriptions', () => {
  it('routes only events explicitly retained by each renderer', () => {
    const subscriptions = new RendererEventSubscriptions()

    subscriptions.update(7, { action: 'subscribe', eventName: 'pty-model-output-T-1' })
    subscriptions.update(8, { action: 'subscribe', eventName: 'task-changed' })

    expect(subscriptions.has(7, 'pty-model-output-T-1')).toBe(true)
    expect(subscriptions.has(7, 'pty-output-T-1')).toBe(false)
    expect(subscriptions.has(8, 'task-changed')).toBe(true)
  })

  it('removes final subscriptions and clears dead renderers', () => {
    const subscriptions = new RendererEventSubscriptions()
    subscriptions.update(7, { action: 'subscribe', eventName: 'task-changed' })
    subscriptions.update(7, { action: 'subscribe', eventName: 'pty-exit-T-1' })

    subscriptions.update(7, { action: 'unsubscribe', eventName: 'task-changed' })
    expect(subscriptions.has(7, 'task-changed')).toBe(false)
    expect(subscriptions.has(7, 'pty-exit-T-1')).toBe(true)

    subscriptions.clear(7)
    expect(subscriptions.has(7, 'pty-exit-T-1')).toBe(false)
  })

  it('rejects malformed subscription messages', () => {
    const subscriptions = new RendererEventSubscriptions()

    expect(subscriptions.update(7, { action: 'subscribe', eventName: '' })).toBe(false)
    expect(subscriptions.update(7, { action: 'replace', eventName: 'task-changed' })).toBe(false)
    expect(subscriptions.has(7, 'task-changed')).toBe(false)
  })

  it('acknowledges only after the trusted renderer subscription is retained', () => {
    const handlers = new Map<string, (event: { sender: { id: number } }, request: unknown) => boolean>()
    const ipc = {
      handle(channel: string, handler: (event: { sender: { id: number } }, request: unknown) => boolean) {
        handlers.set(channel, handler)
      },
    }
    const subscriptions = new RendererEventSubscriptions()
    registerRendererEventSubscriptionHandler(ipc, subscriptions, () => 7)
    const handle = handlers.get(OPENFORGE_EVENT_SUBSCRIPTION_CHANNEL)
    expect(handle).toBeDefined()

    expect(handle?.(
      { sender: { id: 8 } },
      { action: 'subscribe', eventName: 'pty-model-output-T-1' },
    )).toBe(false)
    expect(subscriptions.has(8, 'pty-model-output-T-1')).toBe(false)

    expect(handle?.(
      { sender: { id: 7 } },
      { action: 'subscribe', eventName: 'pty-model-output-T-1' },
    )).toBe(true)
    expect(subscriptions.has(7, 'pty-model-output-T-1')).toBe(true)
  })
})
