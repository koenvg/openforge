import { describe, expect, it, vi } from 'vitest'
import { OPENFORGE_EVENT_CHANNEL } from './preloadApi'
import { FrontendPluginCommandRelay } from './frontendPluginCommandRelay'

function request(correlationId: string) {
  return {
    eventName: 'plugin-frontend-command-request',
    payload: {
      operation: 'invoke',
      correlationId,
      pluginId: 'browser',
      projectId: 'P-1',
      commandId: 'browser.open',
      input: { url: 'http://localhost:5173' },
      context: { taskId: 'T-1', projectId: 'P-1', source: 'agent-cli' },
    },
  }
}

describe('Electron frontend Plugin Command relay', () => {
  it('routes correlated renderer acknowledgements once and rejects cross-renderer consumption', async () => {
    const acknowledgeSidecar = vi.fn(async () => true)
    const send = vi.fn()
    const relay = new FrontendPluginCommandRelay({ acknowledgeSidecar })

    expect(relay.forward(request('one'), { id: 7, send })).toBe(true)
    expect(relay.forward(request('two'), { id: 7, send })).toBe(true)
    expect(send).toHaveBeenNthCalledWith(1, OPENFORGE_EVENT_CHANNEL, request('one'))

    await expect(relay.acknowledge(8, {
      correlationId: 'one',
      outcome: { status: 'success', output: { wrong: true } },
    })).rejects.toThrow('does not own')
    await expect(relay.acknowledge(7, {
      correlationId: 'two',
      outcome: { status: 'success', output: { request: 'two' } },
    })).resolves.toBe(true)
    await expect(relay.acknowledge(7, {
      correlationId: 'one',
      outcome: { status: 'success', output: { request: 'one' } },
    })).resolves.toBe(true)
    await expect(relay.acknowledge(7, {
      correlationId: 'one',
      outcome: { status: 'success', output: { duplicate: true } },
    })).resolves.toBe(false)

    expect(acknowledgeSidecar.mock.calls).toEqual([
      [{ correlationId: 'two', outcome: { status: 'success', output: { request: 'two' } } }],
      [{ correlationId: 'one', outcome: { status: 'success', output: { request: 'one' } } }],
    ])
  })

  it('fails requests immediately without a renderer and cleans requests when its renderer is lost', async () => {
    const acknowledgeSidecar = vi.fn(async () => true)
    const relay = new FrontendPluginCommandRelay({ acknowledgeSidecar })
    const send = vi.fn()

    expect(relay.forward(request('missing'), null)).toBe(true)
    expect(relay.forward(request('lost'), { id: 9, send })).toBe(true)
    await relay.rendererLost(9)

    expect(acknowledgeSidecar).toHaveBeenNthCalledWith(1, {
      correlationId: 'missing',
      outcome: { status: 'error', error: 'OpenForge trusted renderer is unavailable' },
    })
    expect(acknowledgeSidecar).toHaveBeenNthCalledWith(2, {
      correlationId: 'lost',
      outcome: { status: 'error', error: 'OpenForge trusted renderer was lost before the command completed' },
    })
    expect(relay.pendingCount).toBe(0)
  })

  it('ignores unrelated and malformed sidecar events', () => {
    const relay = new FrontendPluginCommandRelay({ acknowledgeSidecar: vi.fn(async () => true) })
    expect(relay.forward({ eventName: 'task-changed', payload: {} }, null)).toBe(false)
    expect(relay.forward({ eventName: 'plugin-frontend-command-request', payload: {} }, null)).toBe(false)
  })
})
