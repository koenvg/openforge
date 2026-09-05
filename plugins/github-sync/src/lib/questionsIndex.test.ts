import { describe, it, expect } from 'vitest'
import { buildQuestionsIndex, markThreadSeen, QUESTION_GROUP_ORDER } from './questionsIndex'
import type { AiThread, AiThreadAnchor, AgentReviewComment } from '@openforge-app/plugin-sdk/domain'

function thread(over: Partial<AiThread> & { id: string }): AiThread {
  return {
    anchor: { type: 'line', filename: 'a.ts', line: 1, side: 'RIGHT' },
    status: 'draft',
    messages: [{ role: 'user', body: 'why?', created_at: 1 }],
    created_at: 1,
    updated_at: 1,
    ...over,
  }
}

function answered(id: string, aiAt: number, over: Partial<AiThread> = {}): AiThread {
  return thread({
    id,
    status: 'answered',
    messages: [
      { role: 'user', body: 'why?', created_at: 1 },
      { role: 'ai', body: 'because', created_at: aiAt },
    ],
    updated_at: aiAt,
    ...over,
  })
}

function suggestion(over: Partial<AgentReviewComment> & { id: number }): AgentReviewComment {
  return {
    review_pr_id: 5,
    review_session_key: 's',
    comment_type: 'inline',
    file_path: 'src/x.ts',
    line_number: 20,
    side: 'RIGHT',
    body: 'consider caching',
    status: 'pending',
    opencode_session_id: null,
    created_at: 1,
    updated_at: 1,
    ...over,
  }
}

describe('buildQuestionsIndex — classification', () => {
  it('puts a draft thread (last message from user) in needs_sending', () => {
    const idx = buildQuestionsIndex([thread({ id: 't1', status: 'draft' })], [])
    expect(idx.groups.needs_sending.map(i => i.key)).toEqual(['t1'])
  })

  it('puts an errored thread with an outstanding user message in needs_sending', () => {
    const idx = buildQuestionsIndex([thread({ id: 't1', status: 'error' })], [])
    expect(idx.groups.needs_sending.map(i => i.key)).toEqual(['t1'])
  })

  it('puts a pending (dispatched) thread in waiting', () => {
    const idx = buildQuestionsIndex([thread({ id: 't1', status: 'pending' })], [])
    expect(idx.groups.waiting.map(i => i.key)).toEqual(['t1'])
  })

  it('puts an unread answered thread in answers_to_read', () => {
    const idx = buildQuestionsIndex([answered('t1', 5)], [])
    expect(idx.groups.answers_to_read.map(i => i.key)).toEqual(['t1'])
  })

  it('puts a read answered thread (seen_at at or after the answer) in done', () => {
    const idx = buildQuestionsIndex([answered('t1', 5, { seen_at: 5 })], [])
    expect(idx.groups.done.map(i => i.key)).toEqual(['t1'])
  })

  it('treats a newer answer as unread even when seen_at was set for the old one', () => {
    const idx = buildQuestionsIndex([answered('t1', 9, { seen_at: 5 })], [])
    expect(idx.groups.answers_to_read.map(i => i.key)).toEqual(['t1'])
  })

  it('skips threads with no messages', () => {
    const idx = buildQuestionsIndex([thread({ id: 't1', messages: [] })], [])
    expect(idx.totalCount).toBe(0)
  })
})

describe('buildQuestionsIndex — suggestions', () => {
  it('includes only undecided (pending) AI suggestions', () => {
    const idx = buildQuestionsIndex([], [
      suggestion({ id: 1, status: 'pending' }),
      suggestion({ id: 2, status: 'approved' }),
      suggestion({ id: 3, status: 'dismissed' }),
    ])
    expect(idx.groups.suggestions_to_review.map(i => i.key)).toEqual(['suggestion:1'])
  })
})

describe('buildQuestionsIndex — navigation targets', () => {
  it('maps a line-anchored thread to a diff target', () => {
    const anchor: AiThreadAnchor = { type: 'line', filename: 'src/a.ts', line: 42, side: 'RIGHT' }
    const idx = buildQuestionsIndex([thread({ id: 't1', anchor })], [])
    expect(idx.groups.needs_sending[0].target).toEqual({ kind: 'diff', filename: 'src/a.ts', line: 42, side: 'RIGHT' })
  })

  it('maps a comment-anchored thread to a diff target at its denormalized location', () => {
    const anchor: AiThreadAnchor = { type: 'comment', comment_id: 7, filename: 'src/b.ts', line: 8, side: 'LEFT' }
    const idx = buildQuestionsIndex([thread({ id: 't1', anchor })], [])
    expect(idx.groups.needs_sending[0].target).toEqual({ kind: 'diff', filename: 'src/b.ts', line: 8, side: 'LEFT' })
  })

  it('maps a step-anchored thread to a step target', () => {
    const anchor: AiThreadAnchor = { type: 'step', step_id: 'step-3' }
    const idx = buildQuestionsIndex([thread({ id: 't1', anchor })], [])
    expect(idx.groups.needs_sending[0].target).toEqual({ kind: 'step', stepId: 'step-3' })
  })

  it('maps a suggestion to a diff target from its file/line', () => {
    const idx = buildQuestionsIndex([], [suggestion({ id: 1, file_path: 'src/c.ts', line_number: 12, side: 'RIGHT' })])
    expect(idx.groups.suggestions_to_review[0].target).toEqual({ kind: 'diff', filename: 'src/c.ts', line: 12, side: 'RIGHT' })
  })
})

describe('buildQuestionsIndex — counts and ordering', () => {
  it('counts only actionable groups (needs_sending + answers_to_read + suggestions_to_review)', () => {
    const idx = buildQuestionsIndex(
      [
        thread({ id: 'd1', status: 'draft' }),
        thread({ id: 'w1', status: 'pending' }),
        answered('r1', 5),
        answered('done1', 5, { seen_at: 5 }),
      ],
      [suggestion({ id: 1, status: 'pending' })],
    )
    expect(idx.actionableCount).toBe(3)
    expect(idx.totalCount).toBe(5)
  })

  it('sorts items within a group by updatedAt descending', () => {
    const idx = buildQuestionsIndex([
      thread({ id: 'older', status: 'draft', updated_at: 1 }),
      thread({ id: 'newer', status: 'draft', updated_at: 9 }),
    ], [])
    expect(idx.groups.needs_sending.map(i => i.key)).toEqual(['newer', 'older'])
  })

  it('lists actionable groups before informational and done', () => {
    expect(QUESTION_GROUP_ORDER).toEqual([
      'needs_sending',
      'answers_to_read',
      'suggestions_to_review',
      'waiting',
      'done',
    ])
  })
})

describe('markThreadSeen', () => {
  it('sets seen_at on the matching thread and leaves others untouched', () => {
    const threads = [answered('t1', 5), answered('t2', 5)]
    const next = markThreadSeen(threads, 't1', 12)
    expect(next.find(t => t.id === 't1')?.seen_at).toBe(12)
    expect(next.find(t => t.id === 't2')?.seen_at ?? null).toBeNull()
  })

  it('returns a new array and does not mutate the input', () => {
    const threads = [answered('t1', 5)]
    const next = markThreadSeen(threads, 't1', 12)
    expect(next).not.toBe(threads)
    expect(threads[0].seen_at ?? null).toBeNull()
  })
})
