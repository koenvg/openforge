import { describe, it, expect } from 'vitest'
import type { ReviewComment, ReviewSubmissionComment, AgentReviewComment } from './types'
import { sideToSplitSide, buildExtendData } from './diffComments'

// ============================================================================
// Test Fixtures
// ============================================================================

const baseExistingComment: ReviewComment = {
  id: 1,
  pr_number: 42,
  repo_owner: 'owner',
  repo_name: 'repo',
  path: 'src/main.ts',
  line: 10,
  side: 'RIGHT',
  body: 'This looks good',
  author: 'reviewer',
  created_at: '2024-01-01T00:00:00Z',
  in_reply_to_id: null,
}

const basePendingComment: ReviewSubmissionComment = {
  path: 'src/main.ts',
  line: 15,
  side: 'RIGHT',
  body: 'Needs improvement',
}

const baseAgentComment: AgentReviewComment = {
  id: 100,
  review_pr_id: 1,
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
}

// ============================================================================
// sideToSplitSide Tests
// ============================================================================

describe('sideToSplitSide', () => {
  it('maps LEFT to oldFile', () => {
    expect(sideToSplitSide('LEFT')).toBe('oldFile')
  })

  it('maps RIGHT to newFile', () => {
    expect(sideToSplitSide('RIGHT')).toBe('newFile')
  })

  it('maps null to newFile', () => {
    expect(sideToSplitSide(null)).toBe('newFile')
  })

  it('maps unknown string to newFile', () => {
    expect(sideToSplitSide('UNKNOWN')).toBe('newFile')
  })

  it('maps empty string to newFile', () => {
    expect(sideToSplitSide('')).toBe('newFile')
  })
})

// ============================================================================
// buildExtendData Tests
// ============================================================================

describe('buildExtendData', () => {
  it('returns empty objects when no comments provided', () => {
    const result = buildExtendData('src/main.ts', [], [])

    expect(result.oldFile).toEqual({})
    expect(result.newFile).toEqual({})
  })

  it('maps existing comment to correct line in newFile', () => {
    const comments: ReviewComment[] = [baseExistingComment]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['10']).toBeDefined()
    expect(result.newFile['10'].data.comments).toHaveLength(1)
    expect(result.newFile['10'].data.comments[0]).toEqual({
      body: 'This looks good',
      author: 'reviewer',
      type: 'existing',
      createdAt: '2024-01-01T00:00:00Z',
    })
  })

  it('maps existing comment to oldFile when side is LEFT', () => {
    const leftComment: ReviewComment = {
      ...baseExistingComment,
      side: 'LEFT',
      line: 5,
    }

    const result = buildExtendData('src/main.ts', [leftComment], [])

    expect(result.oldFile['5']).toBeDefined()
    expect(result.oldFile['5'].data.comments).toHaveLength(1)
    expect(result.newFile['5']).toBeUndefined()
  })

  it('maps pending comment to correct line in newFile', () => {
    const comments: ReviewSubmissionComment[] = [basePendingComment]

    const result = buildExtendData('src/main.ts', [], comments)

    expect(result.newFile['15']).toBeDefined()
    expect(result.newFile['15'].data.comments).toHaveLength(1)
    expect(result.newFile['15'].data.comments[0]).toEqual({
      body: 'Needs improvement',
      type: 'pending',
      index: 0,
    })
  })

  it('maps pending comment to oldFile when side is LEFT', () => {
    const leftPending: ReviewSubmissionComment = {
      ...basePendingComment,
      side: 'LEFT',
      line: 8,
    }

    const result = buildExtendData('src/main.ts', [], [leftPending])

    expect(result.oldFile['8']).toBeDefined()
    expect(result.oldFile['8'].data.comments).toHaveLength(1)
    expect(result.newFile['8']).toBeUndefined()
  })

  it('preserves index for pending comments', () => {
    const pending: ReviewSubmissionComment[] = [
      { ...basePendingComment, line: 10 },
      { ...basePendingComment, line: 20 },
      { ...basePendingComment, line: 30 },
    ]

    const result = buildExtendData('src/main.ts', [], pending)

    expect(result.newFile['10'].data.comments[0].index).toBe(0)
    expect(result.newFile['20'].data.comments[0].index).toBe(1)
    expect(result.newFile['30'].data.comments[0].index).toBe(2)
  })

  it('filters comments by filename - exact match', () => {
    const comments: ReviewComment[] = [
      baseExistingComment,
      { ...baseExistingComment, id: 2, path: 'src/other.ts', line: 20 },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['10']).toBeDefined()
    expect(result.newFile['20']).toBeUndefined()
  })

  it('filters comments by filename - endsWith match', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, path: 'main.ts' },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['10']).toBeDefined()
  })

  it('filters comments by filename - reverse endsWith match', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, path: 'src/main.ts' },
    ]

    const result = buildExtendData('main.ts', comments, [])

    expect(result.newFile['10']).toBeDefined()
  })

  it('excludes comments with null line number', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, line: null },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.oldFile).toEqual({})
    expect(result.newFile).toEqual({})
  })

  it('aggregates multiple comments on same line', () => {
    const comments: ReviewComment[] = [
      baseExistingComment,
      { ...baseExistingComment, id: 2, body: 'Also good' },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['10'].data.comments).toHaveLength(2)
    expect(result.newFile['10'].data.comments[0].body).toBe('This looks good')
    expect(result.newFile['10'].data.comments[1].body).toBe('Also good')
  })

  it('aggregates existing and pending comments on same line', () => {
    const existing: ReviewComment[] = [
      { ...baseExistingComment, line: 10 },
    ]
    const pending: ReviewSubmissionComment[] = [
      { ...basePendingComment, line: 10 },
    ]

    const result = buildExtendData('src/main.ts', existing, pending)

    expect(result.newFile['10'].data.comments).toHaveLength(2)
    expect(result.newFile['10'].data.comments[0].type).toBe('existing')
    expect(result.newFile['10'].data.comments[1].type).toBe('pending')
  })

  it('handles multiple files with different comments', () => {
    const comments: ReviewComment[] = [
      baseExistingComment,
      { ...baseExistingComment, id: 2, path: 'src/other.ts', line: 20 },
    ]

    const result1 = buildExtendData('src/main.ts', comments, [])
    const result2 = buildExtendData('src/other.ts', comments, [])

    expect(result1.newFile['10']).toBeDefined()
    expect(result1.newFile['20']).toBeUndefined()

    expect(result2.newFile['10']).toBeUndefined()
    expect(result2.newFile['20']).toBeDefined()
  })

  it('handles mixed LEFT and RIGHT comments on same file', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, side: 'LEFT', line: 5 },
      { ...baseExistingComment, id: 2, side: 'RIGHT', line: 10 },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.oldFile['5']).toBeDefined()
    expect(result.newFile['10']).toBeDefined()
    expect(result.oldFile['10']).toBeUndefined()
    expect(result.newFile['5']).toBeUndefined()
  })

  it('handles null side as newFile', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, side: null },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['10']).toBeDefined()
    expect(result.oldFile['10']).toBeUndefined()
  })

  it('preserves comment metadata for existing comments', () => {
    const comments: ReviewComment[] = [
      {
        ...baseExistingComment,
        author: 'alice',
        created_at: '2024-02-15T10:30:00Z',
      },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    const comment = result.newFile['10'].data.comments[0]
    expect(comment.author).toBe('alice')
    expect(comment.createdAt).toBe('2024-02-15T10:30:00Z')
  })

  it('does not include author or createdAt for pending comments', () => {
    const pending: ReviewSubmissionComment[] = [basePendingComment]

    const result = buildExtendData('src/main.ts', [], pending)

    const comment = result.newFile['15'].data.comments[0]
    expect(comment.author).toBeUndefined()
    expect(comment.createdAt).toBeUndefined()
  })

  it('handles deeply nested file paths with endsWith matching', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, path: 'Button.svelte' },
    ]

    const result = buildExtendData(
      'src/components/ui/buttons/Button.svelte',
      comments,
      []
    )

    expect(result.newFile['10']).toBeDefined()
  })

  it('returns correct structure with oldFile and newFile keys', () => {
    const result = buildExtendData('src/main.ts', [], [])

    expect(result).toHaveProperty('oldFile')
    expect(result).toHaveProperty('newFile')
    expect(typeof result.oldFile).toBe('object')
    expect(typeof result.newFile).toBe('object')
  })

  it('line keys are strings', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, line: 42 },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(Object.keys(result.newFile)).toContain('42')
    expect(typeof Object.keys(result.newFile)[0]).toBe('string')
  })

  it('handles large line numbers', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, line: 9999 },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['9999']).toBeDefined()
  })

  it('handles line number 1', () => {
    const comments: ReviewComment[] = [
      { ...baseExistingComment, line: 1 },
    ]

    const result = buildExtendData('src/main.ts', comments, [])

    expect(result.newFile['1']).toBeDefined()
  })

  it('agent comments appear in extendData output', () => {
    const agentComments: AgentReviewComment[] = [baseAgentComment]
    
    const result = buildExtendData('src/main.ts', [], [], agentComments)
    
    expect(result.newFile['20']).toBeDefined()
    expect(result.newFile['20'].data.comments).toHaveLength(1)
    expect(result.newFile['20'].data.comments[0].type).toBe('agent')
    expect(result.newFile['20'].data.comments[0].body).toBe('Consider error handling here')
  })
  
  it('dismissed agent comments are excluded', () => {
    const dismissed: AgentReviewComment = {
      ...baseAgentComment,
      status: 'dismissed',
    }
    
    const result = buildExtendData('src/main.ts', [], [], [dismissed])
    
    expect(result.oldFile).toEqual({})
    expect(result.newFile).toEqual({})
  })
  
  it('approved agent comments are included', () => {
    const approved: AgentReviewComment = {
      ...baseAgentComment,
      status: 'approved',
    }
    
    const result = buildExtendData('src/main.ts', [], [], [approved])
    
    expect(result.newFile['20']).toBeDefined()
    expect(result.newFile['20'].data.comments[0].status).toBe('approved')
  })
  
  it('summary agent comments are excluded', () => {
    const summary: AgentReviewComment = {
      ...baseAgentComment,
      comment_type: 'summary',
    }
    
    const result = buildExtendData('src/main.ts', [], [], [summary])
    
    expect(result.oldFile).toEqual({})
    expect(result.newFile).toEqual({})
  })
  
  it('agent comment has commentId and status fields', () => {
    const agentComments: AgentReviewComment[] = [baseAgentComment]
    
    const result = buildExtendData('src/main.ts', [], [], agentComments)
    
    const comment = result.newFile['20'].data.comments[0]
    expect(comment.commentId).toBe(100)
    expect(comment.status).toBe('pending')
    expect(comment.filePath).toBe('src/main.ts')
    expect(comment.lineNumber).toBe(20)
    expect(comment.commentSide).toBe('RIGHT')
  })
})
