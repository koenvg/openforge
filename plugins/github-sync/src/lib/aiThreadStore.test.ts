import { describe, it, expect } from 'vitest'
import { threadsNeedingAnswer, upsertThread } from './aiThreadStore'
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
