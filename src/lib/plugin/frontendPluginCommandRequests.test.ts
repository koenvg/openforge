import { describe, expect, it, vi } from 'vitest'
import { FrontendPluginCommandRequestHandler } from './frontendPluginCommandRequests'

function invokeRequest(correlationId: string, pluginId = 'browser') {
  return {
    operation: 'invoke' as const,
    correlationId,
    pluginId,
    projectId: 'P-1',
    commandId: `${pluginId}.open`,
    input: { url: `http://localhost:5173/${correlationId}` },
    context: { taskId: 'T-1', projectId: 'P-1', source: 'agent-cli' as const },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

describe('frontend Plugin Command renderer requests', () => {
  it('acknowledges concurrent invocations only with their correlated registry output', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const acknowledge = vi.fn(async () => true)
    const handler = new FrontendPluginCommandRequestHandler({
      list: vi.fn(async () => []),
      invoke: vi.fn(async (_pluginId, _projectId, _commandId, input) =>
        (input as { url: string }).url.endsWith('/first') ? first.promise : second.promise),
      acknowledge,
    })

    const firstWork = handler.handle(invokeRequest('first'))
    const secondWork = handler.handle(invokeRequest('second'))
    second.resolve({ request: 'second' })
    await secondWork
    first.resolve({ request: 'first' })
    await firstWork

    expect(acknowledge.mock.calls).toEqual([
      [{ correlationId: 'second', outcome: { status: 'success', output: { request: 'second' } } }],
      [{ correlationId: 'first', outcome: { status: 'success', output: { request: 'first' } } }],
    ])
  })

  it('ends pending requests on plugin deactivation and ignores late handler completion', async () => {
    const invocation = deferred<unknown>()
    const acknowledge = vi.fn(async () => true)
    const handler = new FrontendPluginCommandRequestHandler({
      list: vi.fn(async () => []),
      invoke: vi.fn(async () => invocation.promise),
      acknowledge,
    })

    const work = handler.handle(invokeRequest('pending'))
    await handler.failPlugin('browser', 'frontend plugin runtime deactivated')
    invocation.resolve({ tooLate: true })
    await work

    expect(acknowledge).toHaveBeenCalledOnce()
    expect(acknowledge).toHaveBeenCalledWith({
      correlationId: 'pending',
      outcome: { status: 'error', error: 'frontend plugin runtime deactivated' },
    })
  })

  it('returns stable errors for malformed requests and unavailable exact commands', async () => {
    const acknowledge = vi.fn(async () => true)
    const handler = new FrontendPluginCommandRequestHandler({
      list: vi.fn(async () => []),
      invoke: vi.fn(async () => { throw new Error('Unknown agent-facing Plugin Command: browser.missing') }),
      acknowledge,
    })

    await handler.handle(invokeRequest('missing'))
    await handler.handle({ operation: 'invoke', correlationId: 'malformed' })

    expect(acknowledge).toHaveBeenNthCalledWith(1, {
      correlationId: 'missing',
      outcome: { status: 'error', error: 'Unknown agent-facing Plugin Command: browser.missing' },
    })
    expect(acknowledge).toHaveBeenNthCalledWith(2, {
      correlationId: 'malformed',
      outcome: { status: 'error', error: 'invalid frontend Plugin Command request' },
    })
  })
})
