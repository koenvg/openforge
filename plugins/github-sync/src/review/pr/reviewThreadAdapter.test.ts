import { describe, expect, it } from 'vitest'
import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
import type { AgentReviewComment, AiThread } from '../../lib/prReviewRecords'
import {
  adaptedThreadId,
  parseAdaptedThreadId,
  reviewerStatusForAgentComment,
  toReviewThreads,
} from './reviewThreadAdapter'

const pr = {
  id: 7,
  repo_owner: 'acme',
  repo_name: 'web',
  number: 1421,
  head_sha: 'sha-1',
} as unknown as ReviewPullRequest

function agentComment(overrides: Partial<AgentReviewComment> = {}): AgentReviewComment {
  return {
    id: 100,
    review_pr_id: 7,
    review_session_key: 'session-1',
    comment_type: 'inline',
    file_path: 'src/main.ts',
    line_number: 20,
    side: 'RIGHT',
    body: 'Consider error handling here',
    status: 'pending',
    opencode_session_id: null,
    created_at: 1000,
    updated_at: 1000,
    ...overrides,
  }
}

function aiThread(overrides: Partial<AiThread> = {}): AiThread {
  return {
    id: 'thread-abc',
    anchor: { type: 'line', filename: 'src/main.ts', line: 12, side: 'RIGHT' },
    status: 'answered',
    messages: [
      { role: 'user', body: 'Why this change?', created_at: 1 },
      { role: 'ai', body: 'To guard the null case.', created_at: 2 },
    ],
    created_at: 1,
    updated_at: 2,
    ...overrides,
  }
}

function followUp(overrides: Partial<AiThread> = {}): AiThread {
  return aiThread({
    anchor: { type: 'comment', comment_id: 100, filename: 'src/main.ts', line: 20, side: 'LEFT' },
    ...overrides,
  })
}

describe('toReviewThreads', () => {
  it('scopes every thread to the reviewed PR at its head sha', () => {
    const threads = toReviewThreads({ pr, agentComments: [agentComment()], aiThreads: [aiThread()] })

    for (const thread of threads) {
      expect(thread.namespace).toBe('github')
      expect(thread.targetKey).toBe('gh:acme/web#1421')
      expect(thread.revision).toBe('sha-1')
    }
  })

  it('renders a pending agent comment as an open agent-authored thread', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [agentComment()], aiThreads: [] })

    expect(thread.id).toBe('agent:100')
    expect(thread.origin).toBe('agent')
    expect(thread.status).toBe('open')
    expect(thread.awaiting).toBe('none')
    expect(thread.anchor).toEqual({ kind: 'line', filePath: 'src/main.ts', line: 20, side: 'RIGHT' })
    expect(thread.messages).toEqual([
      { id: 'agent:100:m0', role: 'agent', body: 'Consider error handling here', createdAt: 1000 },
    ])
  })

  it('renders an approved agent comment as resolved', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [agentComment({ status: 'approved' })], aiThreads: [] })

    expect(thread.status).toBe('resolved')
  })

  it('hides a dismissed agent comment', () => {
    const threads = toReviewThreads({ pr, agentComments: [agentComment({ status: 'dismissed' })], aiThreads: [] })

    expect(threads).toEqual([])
  })

  it('hides a summary agent comment and one without a line', () => {
    const threads = toReviewThreads({
      pr,
      agentComments: [
        agentComment({ id: 1, comment_type: 'summary' }),
        agentComment({ id: 2, line_number: null }),
        agentComment({ id: 3, file_path: null }),
      ],
      aiThreads: [],
    })

    expect(threads).toEqual([])
  })

  it('defaults a missing agent comment side to RIGHT', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [agentComment({ side: null })], aiThreads: [] })

    expect(thread.anchor).toEqual({ kind: 'line', filePath: 'src/main.ts', line: 20, side: 'RIGHT' })
  })

  it('renders a question thread as reviewer-authored with both speakers named', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [], aiThreads: [aiThread()] })

    expect(thread.id).toBe('ai:thread-abc')
    expect(thread.origin).toBe('human')
    expect(thread.messages).toEqual([
      { id: 'ai:thread-abc:m0', role: 'human', body: 'Why this change?', createdAt: 1 },
      { id: 'ai:thread-abc:m1', role: 'agent', body: 'To guard the null case.', createdAt: 2 },
    ])
  })

  it('reports an unsent and an in-flight question as waiting on the agent', () => {
    const threads = toReviewThreads({
      pr,
      agentComments: [],
      aiThreads: [
        aiThread({ id: 'draft', status: 'draft' }),
        aiThread({ id: 'pending', status: 'pending' }),
      ],
    })

    expect(threads.map(thread => thread.awaiting)).toEqual(['agent', 'agent'])
  })

  it('reports a failed question turn as an error', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [], aiThreads: [aiThread({ status: 'error' })] })

    expect(thread.awaiting).toBe('error')
  })

  it('carries the reviewer decision stored on a question thread', () => {
    const [thread] = toReviewThreads({
      pr,
      agentComments: [],
      aiThreads: [aiThread({ reviewer_status: 'resolved' })],
    })

    expect(thread.status).toBe('resolved')
  })

  it('treats a question thread with no stored decision as open', () => {
    const [thread] = toReviewThreads({ pr, agentComments: [], aiThreads: [aiThread()] })

    expect(thread.status).toBe('open')
  })

  it('reports an answer newer than the last read as unread', () => {
    const unread = toReviewThreads({ pr, agentComments: [], aiThreads: [aiThread({ seen_at: 1 })] })
    const read = toReviewThreads({ pr, agentComments: [], aiThreads: [aiThread({ seen_at: 2 })] })

    expect(unread[0].hasUnreadAgentMessage).toBe(true)
    expect(unread[0].seenAt).toBe(1)
    expect(read[0].hasUnreadAgentMessage).toBe(false)
  })

  it('keeps a follow-up readable on its diff line when the agent comment it asks about is gone', () => {
    const threads = toReviewThreads({
      pr,
      agentComments: [],
      aiThreads: [followUp()],
    })

    expect(threads.map(thread => [thread.id, thread.anchor])).toEqual([
      ['ai:thread-abc', { kind: 'line', filePath: 'src/main.ts', line: 20, side: 'LEFT' }],
    ])
  })

  it('folds a follow-up question into the agent comment it asks about', () => {
    const threads = toReviewThreads({ pr, agentComments: [agentComment()], aiThreads: [followUp()] })

    expect(threads.map(thread => thread.id)).toEqual(['agent:100'])
    expect(threads[0].messages).toEqual([
      { id: 'agent:100:m0', role: 'agent', body: 'Consider error handling here', createdAt: 1000 },
      { id: 'agent:100:m1', role: 'human', body: 'Why this change?', createdAt: 1 },
      { id: 'agent:100:m2', role: 'agent', body: 'To guard the null case.', createdAt: 2 },
    ])
    expect(threads[0].origin).toBe('agent')
    expect(threads[0].anchor).toEqual({ kind: 'line', filePath: 'src/main.ts', line: 20, side: 'RIGHT' })
  })

  it('waits on the agent while the folded follow-up is unanswered', () => {
    const [thread] = toReviewThreads({
      pr,
      agentComments: [agentComment()],
      aiThreads: [followUp({ status: 'pending' })],
    })

    expect(thread.awaiting).toBe('agent')
  })

  it('reports a folded answer newer than the last read as unread', () => {
    const unread = toReviewThreads({ pr, agentComments: [agentComment()], aiThreads: [followUp({ seen_at: 1 })] })
    const read = toReviewThreads({ pr, agentComments: [agentComment()], aiThreads: [followUp({ seen_at: 2 })] })

    expect(unread[0].hasUnreadAgentMessage).toBe(true)
    expect(read[0].hasUnreadAgentMessage).toBe(false)
  })

  it('keeps a step-anchored question off the diff with a custom anchor', () => {
    const [thread] = toReviewThreads({
      pr,
      agentComments: [],
      aiThreads: [aiThread({ anchor: { type: 'step', step_id: 'step-3' } })],
    })

    expect(thread.anchor).toEqual({ kind: 'custom', key: 'step:step-3' })
  })

  it('renders an agent-authored and a reviewer-authored thread on the same line', () => {
    const threads = toReviewThreads({
      pr,
      agentComments: [agentComment({ line_number: 12 })],
      aiThreads: [aiThread()],
    })

    expect(threads.map(thread => [thread.origin, thread.anchor])).toEqual([
      ['agent', { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' }],
      ['human', { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' }],
    ])
  })
})

describe('adaptedThreadId', () => {
  it('round-trips an agent comment id', () => {
    expect(parseAdaptedThreadId(adaptedThreadId.agent(100))).toEqual({ kind: 'agent', commentId: 100 })
  })

  it('round-trips a question thread id that contains a colon', () => {
    expect(parseAdaptedThreadId(adaptedThreadId.ai('thread-a:b'))).toEqual({ kind: 'ai', threadId: 'thread-a:b' })
  })

  it('rejects an id from another surface', () => {
    expect(parseAdaptedThreadId('rt_1')).toBeNull()
    expect(parseAdaptedThreadId('agent:not-a-number')).toBeNull()
  })
})

describe('reviewerStatusForAgentComment', () => {
  it('maps the reviewer decision onto the stored agent comment status', () => {
    expect(reviewerStatusForAgentComment('resolved')).toBe('approved')
    expect(reviewerStatusForAgentComment('dismissed')).toBe('dismissed')
    expect(reviewerStatusForAgentComment('open')).toBe('pending')
  })
})
