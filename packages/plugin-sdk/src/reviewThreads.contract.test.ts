import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type {
  CreateReviewThreadRequest,
  ReviewThread,
  ReviewThreadsAPI,
} from './types'
import { createMockOpenForgeApi, createOpenForgeRegistryFake } from './testing'

const scope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#1421',
  revision: 'sha-1',
}

const request = {
  ...scope,
  anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' },
  origin: 'plugin',
  body: 'Needs a null check',
} satisfies CreateReviewThreadRequest

describe('Review Threads public SDK contract', () => {
  it('exposes the thread operations on the common root', () => {
    const api = createMockOpenForgeApi()

    expectTypeOf(api.reviewThreads).toEqualTypeOf<ReviewThreadsAPI>()
  })

  it('creates and lists a thread without a running host', async () => {
    const api = createMockOpenForgeApi()

    const created = await api.reviewThreads.create(request)

    expect(created.anchor).toEqual(request.anchor)
    expect(created.origin).toBe('plugin')
    expect(created.messages.map(message => message.body)).toEqual(['Needs a null check'])
    await expect(api.reviewThreads.list(scope)).resolves.toEqual([created])
  })

  it('appends a reply to the same thread instead of creating a second one', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)

    const replied = await api.reviewThreads.reply({ threadId: created.id, role: 'human', body: 'Fixed' })

    expect(replied.id).toBe(created.id)
    expect(replied.messages.map(message => message.body)).toEqual(['Needs a null check', 'Fixed'])
    await expect(api.reviewThreads.list(scope)).resolves.toHaveLength(1)
  })

  it('lists only the threads stored under the exact triple', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)
    await api.reviewThreads.create({ ...request, revision: 'sha-2' })

    await expect(api.reviewThreads.list(scope)).resolves.toEqual([created])
    await expect(api.reviewThreads.list({ ...scope, targetKey: 'gh:acme/web#9999' })).resolves.toEqual([])
  })

  it.each([
    [{ ...request, anchor: { kind: 'line', filePath: '', line: 12, side: 'RIGHT' } }, "'filePath' must not be empty"],
    [{ ...request, anchor: { kind: 'line', filePath: 'src/main.ts', line: 0, side: 'RIGHT' } }, "'line' must be at least 1"],
    [{ ...request, anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'MIDDLE' } }, "'side' must be LEFT or RIGHT"],
    [{ ...request, body: '   ' }, "'body' must not be empty"],
    [{ ...request, idempotencyKey: '  ' }, "'idempotencyKey' must not be empty"],
  ] as [CreateReviewThreadRequest, string][])('rejects a create that fails %o naming the offending field', async (invalid, message) => {
    const api = createMockOpenForgeApi()

    await expect(api.reviewThreads.create(invalid)).rejects.toThrow(message)
    await expect(api.reviewThreads.list(scope)).resolves.toEqual([])
  })

  it('returns the stored thread when a create repeats its idempotency key', async () => {
    const api = createMockOpenForgeApi()
    const retried = { ...request, idempotencyKey: 'review-1' }
    const created = await api.reviewThreads.create(retried)

    const repeated = await api.reviewThreads.create({ ...retried, body: 'Rewritten comment' })

    expect(repeated.id).toBe(created.id)
    expect(repeated.idempotencyKey).toBe('review-1')
    expect(repeated.messages.map(message => message.body)).toEqual(['Needs a null check'])
    await expect(api.reviewThreads.list(scope)).resolves.toHaveLength(1)
  })

  it.each([
    ['another namespace', { namespace: 'task' }],
    ['another target key', { targetKey: 'gh:acme/web#9999' }],
    ['another revision', { revision: 'sha-2' }],
  ])('creates a separate thread when a key is reused under %s', async (_part, elsewhere) => {
    const api = createMockOpenForgeApi()
    const retried = { ...request, idempotencyKey: 'review-1' }
    const created = await api.reviewThreads.create(retried)

    const separate = await api.reviewThreads.create({ ...retried, ...elsewhere })

    expect(separate.id).not.toBe(created.id)
    await expect(api.reviewThreads.list(scope)).resolves.toHaveLength(1)
    await expect(api.reviewThreads.list({ ...scope, ...elsewhere })).resolves.toHaveLength(1)
  })

  it('does not deduplicate creates that carry no key', async () => {
    const api = createMockOpenForgeApi()

    await api.reviewThreads.create(request)
    await api.reviewThreads.create(request)

    await expect(api.reviewThreads.list(scope)).resolves.toHaveLength(2)
  })

  it('notifies no subscriber when a repeated key stores nothing', async () => {
    const api = createMockOpenForgeApi()
    const retried = { ...request, idempotencyKey: 'review-1' }
    await api.reviewThreads.create(retried)
    const handler = vi.fn()
    api.reviewThreads.onDidChange(scope, handler)

    await api.reviewThreads.create(retried)

    expect(handler).not.toHaveBeenCalled()
  })

  it('rejects a reply to an unknown thread and creates no thread', async () => {
    const api = createMockOpenForgeApi()

    await expect(api.reviewThreads.reply({ threadId: 'rt_missing', role: 'human', body: 'Fixed' }))
      .rejects.toThrow("Review Thread 'rt_missing' does not exist")
    await expect(api.reviewThreads.list(scope)).resolves.toEqual([])
  })

  it('notifies subscribers of that scope only and carries no thread snapshot', async () => {
    const api = createMockOpenForgeApi()
    const subscribed = vi.fn()
    const otherScope = vi.fn()
    api.reviewThreads.onDidChange(scope, subscribed)
    api.reviewThreads.onDidChange({ ...scope, revision: 'sha-2' }, otherScope)

    await api.reviewThreads.create(request)

    expect(subscribed).toHaveBeenCalledWith(scope)
    expect(otherScope).not.toHaveBeenCalled()
  })

  it('stops notifying a disposed subscriber', async () => {
    const api = createMockOpenForgeApi()
    const handler = vi.fn()
    const subscription = api.reviewThreads.onDidChange(scope, handler)

    subscription.dispose()
    await api.reviewThreads.create(request)

    expect(handler).not.toHaveBeenCalled()
  })

  it('drives a scope notification from the registry fake', () => {
    const registry = createOpenForgeRegistryFake()
    const handler = vi.fn()
    registry.frontendApi.reviewThreads.onDidChange(scope, handler)

    registry.emitReviewThreadChange(scope)

    expect(handler).toHaveBeenCalledWith(scope)
  })

  it('leaves an asked thread open while recording that an agent reply is awaited', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)

    const asked = await api.reviewThreads.reply({ threadId: created.id, role: 'human', body: 'Why?', awaiting: 'agent' })

    expect(asked.status).toBe('open')
    expect(asked.awaiting).toBe('agent')
  })

  it('reports the reviewer decision and a failed agent turn side by side', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)
    await api.reviewThreads.setAwaiting({ threadId: created.id, awaiting: 'error' })

    const resolved = await api.reviewThreads.setStatus({ threadId: created.id, status: 'resolved' })

    expect(resolved.status).toBe('resolved')
    expect(resolved.awaiting).toBe('error')
  })

  it('leaves the reviewer decision alone when the agent turn moves', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)
    await api.reviewThreads.setStatus({ threadId: created.id, status: 'dismissed' })

    const awaited = await api.reviewThreads.setAwaiting({ threadId: created.id, awaiting: 'agent' })

    expect(awaited.status).toBe('dismissed')
  })

  it.each([
    ['setStatus', () => createMockOpenForgeApi().reviewThreads.setStatus({ threadId: 'rt_missing', status: 'resolved' as const })],
    ['setAwaiting', () => createMockOpenForgeApi().reviewThreads.setAwaiting({ threadId: 'rt_missing', awaiting: 'agent' as const })],
    ['markSeen', () => createMockOpenForgeApi().reviewThreads.markSeen({ threadId: 'rt_missing' })],
  ])('rejects %s on an unknown thread', async (_operation, call) => {
    await expect(call()).rejects.toThrow("Review Thread 'rt_missing' does not exist")
  })

  it('counts the latest agent message as read until a newer one arrives', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create({ ...request, origin: 'agent' })
    expect(created.hasUnreadAgentMessage).toBe(true)

    const seen = await api.reviewThreads.markSeen({ threadId: created.id })
    expect(seen.hasUnreadAgentMessage).toBe(false)

    const answered = await api.reviewThreads.reply({ threadId: created.id, role: 'agent', body: 'Fixed', awaiting: 'none' })

    expect(answered.hasUnreadAgentMessage).toBe(true)
    expect(answered.seenAt).toBe(seen.seenAt)
  })

  it('leaves a seen thread read when the reviewer is the one who replies', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create({ ...request, origin: 'agent' })
    await api.reviewThreads.markSeen({ threadId: created.id })

    const asked = await api.reviewThreads.reply({ threadId: created.id, role: 'human', body: 'Why?', awaiting: 'agent' })

    expect(asked.hasUnreadAgentMessage).toBe(false)
  })

  it('notifies the scope on every state write', async () => {
    const api = createMockOpenForgeApi()
    const created = await api.reviewThreads.create(request)
    const handler = vi.fn()
    api.reviewThreads.onDidChange(scope, handler)

    await api.reviewThreads.setStatus({ threadId: created.id, status: 'resolved' })
    await api.reviewThreads.setAwaiting({ threadId: created.id, awaiting: 'error' })
    await api.reviewThreads.markSeen({ threadId: created.id })

    expect(handler).toHaveBeenCalledTimes(3)
  })

  it('hands back copies so a caller cannot mutate stored threads', async () => {
    const api = createMockOpenForgeApi()
    const created: ReviewThread = await api.reviewThreads.create(request)

    created.messages.push({ id: 'rtm_forged', role: 'human', body: 'Forged', createdAt: 9 })

    const [stored] = await api.reviewThreads.list(scope)
    expect(stored.messages).toHaveLength(1)
  })
})
