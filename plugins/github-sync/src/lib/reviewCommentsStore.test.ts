import { describe, it, expect } from 'vitest'
import { toAgentReviewComments } from './reviewCommentsStore'

describe('toAgentReviewComments', () => {
  it('maps validated comments to AgentReviewComment shape with synthetic ids', () => {
    const out = toAgentReviewComments(7, 'sess', [
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'q', kind: 'question' },
    ], () => 1000)
    expect(out).toEqual([{
      id: 1, review_pr_id: 7, review_session_key: 'sess', comment_type: 'inline',
      file_path: 'a.ts', line_number: 2, side: 'RIGHT', body: 'q',
      status: 'pending', opencode_session_id: null, created_at: 1000, updated_at: 1000,
    }])
  })
})
