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
  ] as [CreateReviewThreadRequest, string][])('rejects a create that fails %o naming the offending field', async (invalid, message) => {
    const api = createMockOpenForgeApi()

    await expect(api.reviewThreads.create(invalid)).rejects.toThrow(message)
    await expect(api.reviewThreads.list(scope)).resolves.toEqual([])
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

  it('hands back copies so a caller cannot mutate stored threads', async () => {
    const api = createMockOpenForgeApi()
    const created: ReviewThread = await api.reviewThreads.create(request)

    created.messages.push({ id: 'rtm_forged', role: 'human', body: 'Forged', createdAt: 9 })

    const [stored] = await api.reviewThreads.list(scope)
    expect(stored.messages).toHaveLength(1)
  })
})
