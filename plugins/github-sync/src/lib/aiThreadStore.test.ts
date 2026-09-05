import { describe, it, expect } from 'vitest'
import { threadsNeedingAnswer, upsertThread, editLastUserMessage } from './aiThreadStore'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

function thread(id: string, lastRole: 'user' | 'ai', status: AiThread['status']): AiThread {
  return {
    id, anchor: { type: 'line', filename: 'a.ts', line: 1, side: 'RIGHT' }, status,
    messages: [{ role: 'user', body: 'q', created_at: 1 }, ...(lastRole === 'ai' ? [{ role: 'ai' as const, body: 'a', created_at: 2 }] : [])],
    created_at: 1, updated_at: 2,
  }
}

describe('aiThreadStore helpers', () => {
  it('threadsNeedingAnswer returns threads whose last message is from the user', () => {
    const needs = thread('t1', 'user', 'draft')
    const answered = thread('t2', 'ai', 'answered')
    expect(threadsNeedingAnswer([needs, answered]).map(t => t.id)).toEqual(['t1'])
  })
  it('upsertThread replaces by id or appends', () => {
    const a = thread('t1', 'user', 'draft')
    const b = thread('t2', 'user', 'draft')
    const updatedA = { ...a, status: 'answered' as const }
    expect(upsertThread([a, b], updatedA).find(t => t.id === 't1')?.status).toBe('answered')
    const c = thread('t3', 'user', 'draft')
    expect(upsertThread([a], c).map(t => t.id)).toEqual(['t1', 't3'])
  })
})

describe('editLastUserMessage', () => {
  it('replaces the latest user message body and resets status to draft', () => {
    const t: AiThread = {
      id: 't1', anchor: { type: 'step', step_id: 's1' }, status: 'error',
      messages: [{ role: 'user', body: 'old', created_at: 1 }],
      created_at: 1, updated_at: 1,
    }
    const next = editLastUserMessage(t, 'new', 5)
    expect(next.messages.at(-1)).toEqual({ role: 'user', body: 'new', created_at: 1 })
    expect(next.status).toBe('draft')
    expect(next.updated_at).toBe(5)
  })

  it('edits only the latest message when earlier history exists', () => {
    const t: AiThread = {
      id: 't1', anchor: { type: 'step', step_id: 's1' }, status: 'draft',
      messages: [
        { role: 'user', body: 'q1', created_at: 1 },
        { role: 'ai', body: 'a1', created_at: 2 },
        { role: 'user', body: 'q2 old', created_at: 3 },
      ],
      created_at: 1, updated_at: 3,
    }
    const next = editLastUserMessage(t, 'q2 new', 9)
    expect(next.messages.map(m => m.body)).toEqual(['q1', 'a1', 'q2 new'])
  })

  it('is a no-op when the latest message is from the AI', () => {
    const t: AiThread = {
      id: 't1', anchor: { type: 'step', step_id: 's1' }, status: 'answered',
      messages: [
        { role: 'user', body: 'q', created_at: 1 },
        { role: 'ai', body: 'a', created_at: 2 },
      ],
      created_at: 1, updated_at: 2,
    }
    expect(editLastUserMessage(t, 'x', 9)).toBe(t)
  })
})
