import { describe, expect, it } from 'vitest'
import { RendererEventSubscriptions } from './rendererEventSubscriptions'

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
})
