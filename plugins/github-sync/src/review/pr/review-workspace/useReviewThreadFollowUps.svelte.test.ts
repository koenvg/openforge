import { describe, expect, it, vi } from 'vitest'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
import { createPrReviewAgentSessionController } from './usePrReviewAgentSession.svelte'
import {
  createReviewThreadFollowUpController,
  reviewThreadFollowUpInput,
} from './useReviewThreadFollowUps.svelte'

const pullRequest = {
  id: 42,
  repo_owner: 'acme',
  repo_name: 'web',
  number: 1421,
  head_sha: 'head-a',
  title: 'Keep the review session visible',
} as ReviewPullRequest

function setup() {
  const registry = createOpenForgeRegistryFake({
    pluginId: 'com.openforge.github-sync',
    projectId: 'P-1',
  })
  const agentSession = createPrReviewAgentSessionController(
    registry.frontendApi,
    async () => 'P-1',
  )
  const followUps = createReviewThreadFollowUpController(registry.frontendApi, agentSession)
  return { registry, agentSession, followUps }
}

describe('pull request Review Thread follow-ups', () => {
  it('stores a line question before sending it to the existing scoped session', async () => {
    const { registry, agentSession, followUps } = setup()
    const operations: string[] = []
    const create = registry.frontendApi.reviewThreads.create.bind(registry.frontendApi.reviewThreads)
    const input = registry.frontendApi.agentSessions.input.bind(registry.frontendApi.agentSessions)
    registry.frontendApi.reviewThreads.create = vi.fn(async request => {
      operations.push('store')
      return create(request)
    })
    registry.frontendApi.agentSessions.input = vi.fn(async (scope, message) => {
      operations.push('input')
      return input(scope, message)
    })

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    await followUps.load(pullRequest)
    const thread = await followUps.askLine('src/review.ts', 18, 'RIGHT', 'Why is this safe?')

    expect(operations).toEqual(['store', 'input'])
    expect(thread).toMatchObject({
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
      anchor: { kind: 'line', filePath: 'src/review.ts', line: 18, side: 'RIGHT' },
      origin: 'human',
      awaiting: 'agent',
    })
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
    expect(registry.calls.scopedAgentSessionInputs).toEqual([{
      scope: agentSession.scope,
      input: reviewThreadFollowUpInput(thread.id, 'Why is this safe?'),
    }])
  })

  it('keeps the human message and marks the thread failed when session input fails', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    await followUps.load(pullRequest)
    registry.frontendApi.agentSessions.input = vi.fn(async () => {
      throw new Error('Provider input failed')
    })

    await expect(followUps.askStep('validation', 'What happens on retry?'))
      .rejects.toThrow('Provider input failed')

    const [stored] = await registry.frontendApi.reviewThreads.list(agentSession.scope!)
    expect(stored.anchor).toEqual({ kind: 'custom', key: 'step:validation' })
    expect(stored.messages.map(message => message.body)).toEqual(['What happens on retry?'])
    expect(stored.awaiting).toBe('error')
    expect(followUps.threads).toEqual([stored])
    expect(registry.calls.scopedAgentSessionStarts).toHaveLength(1)
  })

  it('appends a reply before directing the agent to answer that exact thread', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    const existing = await registry.frontendApi.reviewThreads.create({
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
      anchor: { kind: 'line', filePath: 'src/review.ts', line: 18, side: 'RIGHT' },
      origin: 'agent',
      body: 'This branch needs a guard.',
    })
    await followUps.load(pullRequest)

    const replied = await followUps.reply(existing.id, 'Can you show the failing case?')

    expect(replied.id).toBe(existing.id)
    expect(replied.messages.map(message => message.body)).toEqual([
      'This branch needs a guard.',
      'Can you show the failing case?',
    ])
    expect(registry.calls.scopedAgentSessionInputs.at(-1)).toEqual({
      scope: agentSession.scope,
      input: reviewThreadFollowUpInput(existing.id, 'Can you show the failing case?'),
    })
  })

  it('keeps an agent reply readable on the same thread after the follow-up turn', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    await followUps.load(pullRequest)
    const asked = await followUps.askStep('validation', 'What happens on retry?')

    await registry.frontendApi.reviewThreads.reply({
      threadId: asked.id,
      role: 'agent',
      body: 'The retry starts a new attempt in the same conversation.',
      awaiting: 'none',
    })

    await vi.waitFor(() => {
      expect(followUps.threads[0].messages.map(message => message.body)).toEqual([
        'What happens on retry?',
        'The retry starts a new attempt in the same conversation.',
      ])
    })
  })

  it('marks an unread agent answer seen through the Review Threads API', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    const created = await registry.frontendApi.reviewThreads.create({
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
      anchor: { kind: 'custom', key: 'step:validation' },
      origin: 'human',
      body: 'What happens on retry?',
    })
    await registry.frontendApi.reviewThreads.reply({
      threadId: created.id,
      role: 'agent',
      body: 'The retry starts a new attempt.',
      awaiting: 'none',
    })
    await followUps.load(pullRequest)
    expect(followUps.threads[0].hasUnreadAgentMessage).toBe(true)

    await followUps.markSeen(created.id)

    expect(followUps.threads[0].hasUnreadAgentMessage).toBe(false)
    expect(followUps.threads[0].seenAt).not.toBeNull()
  })

  it('updates only submitted threads after GitHub accepts them', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    const first = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'head-a',
      anchor: { kind: 'line', filePath: 'src/a.ts', line: 1, side: 'RIGHT' },
      origin: 'agent', body: 'First',
    })
    const second = await registry.frontendApi.reviewThreads.create({
      namespace: 'github', targetKey: 'gh:acme/web#1421', revision: 'head-a',
      anchor: { kind: 'line', filePath: 'src/b.ts', line: 2, side: 'RIGHT' },
      origin: 'agent', body: 'Second',
    })
    await registry.frontendApi.reviewThreads.setStatus({ threadId: first.id, status: 'resolved' })
    await registry.frontendApi.reviewThreads.setStatus({ threadId: second.id, status: 'resolved' })
    await followUps.load(pullRequest)

    await followUps.dismissSubmitted([first.id])

    expect(followUps.threads.find(thread => thread.id === first.id)?.status).toBe('dismissed')
    expect(followUps.threads.find(thread => thread.id === second.id)?.status).toBe('resolved')
  })

  it('keeps the newest thread state when invalidation reads resolve out of order', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await agentSession.activate()
    await followUps.load(pullRequest)
    const created = await registry.frontendApi.reviewThreads.create({
      namespace: 'github',
      targetKey: 'gh:acme/web#1421',
      revision: 'head-a',
      anchor: { kind: 'custom', key: 'step:validation' },
      origin: 'human',
      body: 'What happens on retry?',
    })
    const older = await registry.frontendApi.reviewThreads.setAwaiting({
      threadId: created.id,
      awaiting: 'agent',
    })
    const newer = await registry.frontendApi.reviewThreads.setAwaiting({
      threadId: created.id,
      awaiting: 'error',
    })
    await vi.waitFor(() => expect(followUps.threads[0]?.awaiting).toBe('error'))

    let resolveOlder!: (threads: ReviewThread[]) => void
    let resolveNewer!: (threads: ReviewThread[]) => void
    const olderRead = new Promise<ReviewThread[]>(resolve => { resolveOlder = resolve })
    const newerRead = new Promise<ReviewThread[]>(resolve => { resolveNewer = resolve })
    registry.frontendApi.reviewThreads.list = vi.fn()
      .mockReturnValueOnce(olderRead)
      .mockReturnValueOnce(newerRead)

    registry.emitReviewThreadChange(agentSession.scope!)
    registry.emitReviewThreadChange(agentSession.scope!)
    expect(registry.frontendApi.reviewThreads.list).toHaveBeenCalledTimes(2)

    resolveNewer([newer])
    await newerRead
    await vi.waitFor(() => expect(followUps.threads[0]?.awaiting).toBe('error'))
    resolveOlder([older])
    await olderRead
    await Promise.resolve()

    expect(followUps.threads[0]?.awaiting).toBe('error')
  })

  it('blocks clearly when the current head has no usable session', async () => {
    const { registry, agentSession, followUps } = setup()

    await agentSession.observe(pullRequest)
    await followUps.load(pullRequest)

    expect(followUps.unavailableReason).toBe('Generate a walkthrough in the Agent tab before asking a follow-up question.')
    await expect(followUps.askLine('src/review.ts', 18, 'RIGHT', 'Why?'))
      .rejects.toThrow('Generate a walkthrough in the Agent tab before asking a follow-up question.')
    await expect(registry.frontendApi.reviewThreads.list(agentSession.scope!)).resolves.toEqual([])
    expect(registry.calls.scopedAgentSessionStarts).toEqual([])
    expect(registry.calls.scopedAgentSessionInputs).toEqual([])
  })
})
