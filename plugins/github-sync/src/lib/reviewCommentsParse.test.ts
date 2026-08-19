import { describe, it, expect } from 'vitest'
import { parseAndValidateReviewComments } from './reviewCommentsParse'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'

function file(partial: Partial<PrFileDiff>): PrFileDiff {
  return {
    filename: 'a.ts', previous_filename: null, status: 'modified',
    additions: 1, deletions: 0, patch: '@@ -1,1 +1,2 @@\n context\n+added\n',
    sha: 'x', is_truncated: false, patch_line_count: 3, ...partial,
  } as PrFileDiff
}

describe('parseAndValidateReviewComments', () => {
  const files = [file({ filename: 'a.ts' })] // RIGHT lines {1,2}, LEFT {1}

  it('keeps a valid comment on a commentable line', () => {
    const raw = JSON.stringify({ review_comments: [
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'why here?', kind: 'question' },
    ]})
    expect(parseAndValidateReviewComments(raw, files)).toEqual([
      { filename: 'a.ts', line: 2, side: 'RIGHT', body: 'why here?', kind: 'question' },
    ])
  })

  it('drops comments on unknown files or non-commentable lines and defaults kind', () => {
    const raw = JSON.stringify({ review_comments: [
      { filename: 'nope.ts', line: 1, side: 'RIGHT', body: 'x' },
      { filename: 'a.ts', line: 99, side: 'RIGHT', body: 'x' },
      { filename: 'a.ts', line: 1, side: 'RIGHT', body: 'ok' },
    ]})
    expect(parseAndValidateReviewComments(raw, files)).toEqual([
      { filename: 'a.ts', line: 1, side: 'RIGHT', body: 'ok', kind: 'note' },
    ])
  })

  it('returns [] for malformed input', () => {
    expect(parseAndValidateReviewComments('not json', files)).toEqual([])
    expect(parseAndValidateReviewComments(JSON.stringify({}), files)).toEqual([])
  })
})
