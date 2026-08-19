import { describe, it, expect } from 'vitest'
import { buildQuestionsPrompt, mapAnswersToThreads } from './aiThreadPrompt'
import type { AiThread } from '@openforge-app/plugin-sdk/domain'

const threads: AiThread[] = [{
  id: 't1', anchor: { type: 'line', filename: 'a.ts', line: 2, side: 'RIGHT' }, status: 'pending',
  messages: [{ role: 'user', body: 'why a Map here?', created_at: 1 }], created_at: 1, updated_at: 1,
}]

describe('aiThreadPrompt', () => {
  it('includes each thread id and question text in the prompt', () => {
    const prompt = buildQuestionsPrompt(threads, [], [])
    expect(prompt).toContain('t1')
    expect(prompt).toContain('why a Map here?')
    expect(prompt).toContain('a.ts')
  })
  it('maps answers back onto threads by id and marks answered', () => {
    const raw = JSON.stringify({ answers: [{ thread_id: 't1', body: 'Because ordering matters.' }] })
    const out = mapAnswersToThreads(raw, threads, () => 5)
    expect(out[0].status).toBe('answered')
    expect(out[0].messages.at(-1)).toEqual({ role: 'ai', body: 'Because ordering matters.', created_at: 5 })
  })
  it('marks threads with no answer as error', () => {
    const out = mapAnswersToThreads(JSON.stringify({ answers: [] }), threads, () => 5)
    expect(out[0].status).toBe('error')
  })
})
