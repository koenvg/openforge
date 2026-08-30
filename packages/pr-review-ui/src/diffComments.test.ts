import { describe, it, expect, expectTypeOf } from 'vitest'
import type { AiThread, ReviewComment, ReviewSubmissionComment, AgentReviewComment, PrComment } from '@openforge-app/plugin-sdk/domain'
import { sideToSplitSide, buildExtendData, prCommentsToReviewComments, approvedInlineAgentComments, agentCommentToSubmission, type InlineCommentDisplayData } from './diffComments'

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


describe('CommentDisplayData', () => {
  it('narrows each comment variant to its valid fields', () => {
    function checkComment(comment: import('./diffComments').CommentDisplayData['comments'][number]) {
      switch (comment.type) {
        case 'existing':
          expectTypeOf(comment.author).toEqualTypeOf<string>()
          // @ts-expect-error Existing comments do not expose pending-comment indexes.
          expectTypeOf(comment.index)
          break
        case 'pending':
          expectTypeOf(comment.index).toEqualTypeOf<number>()
          // @ts-expect-error Pending comments do not expose GitHub comment ids.
          expectTypeOf(comment.commentId)
          break
        case 'agent':
          expectTypeOf(comment.commentId).toEqualTypeOf<number>()
          expectTypeOf(comment.filePath).toEqualTypeOf<string>()
          expectTypeOf(comment.lineNumber).toEqualTypeOf<number>()
          expectTypeOf(comment.commentSide).toEqualTypeOf<'LEFT' | 'RIGHT'>()
          break
        case 'ai-thread':
          expectTypeOf(comment.thread).toEqualTypeOf<AiThread>()
          // @ts-expect-error AI threads do not expose a placeholder body.
          expectTypeOf(comment.body)
          break
        case 'pending-reply':
          expectTypeOf(comment.commentId).toEqualTypeOf<number>()
          // @ts-expect-error Pending replies do not expose pending-comment indexes.
          expectTypeOf(comment.index)
          break
      }
    }

    expectTypeOf(checkComment).toBeFunction()
  })
})

function commentOfType<Type extends InlineCommentDisplayData['type']>(
  comment: InlineCommentDisplayData,
  type: Type
): Extract<InlineCommentDisplayData, { type: Type }> {
  expect(comment.type).toBe(type)
  return comment as Extract<InlineCommentDisplayData, { type: Type }>
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
      isReply: false,
      commentId: 1,
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

    expect(commentOfType(result.newFile['10'].data.comments[0], 'pending').index).toBe(0)
    expect(commentOfType(result.newFile['20'].data.comments[0], 'pending').index).toBe(1)
    expect(commentOfType(result.newFile['30'].data.comments[0], 'pending').index).toBe(2)
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
    expect(commentOfType(result.newFile['10'].data.comments[0], 'existing').body).toBe('This looks good')
    expect(commentOfType(result.newFile['10'].data.comments[1], 'existing').body).toBe('Also good')
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

    const comment = commentOfType(result.newFile['10'].data.comments[0], 'existing')
    expect(comment.author).toBe('alice')
    expect(comment.createdAt).toBe('2024-02-15T10:30:00Z')
  })

  it('does not include author or createdAt for pending comments', () => {
    const pending: ReviewSubmissionComment[] = [basePendingComment]

    const result = buildExtendData('src/main.ts', [], pending)

    const comment = commentOfType(result.newFile['15'].data.comments[0], 'pending')
    expect(comment).not.toHaveProperty('author')
    expect(comment).not.toHaveProperty('createdAt')
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
    expect(commentOfType(result.newFile['20'].data.comments[0], 'agent').body).toBe('Consider error handling here')
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
    expect(commentOfType(result.newFile['20'].data.comments[0], 'agent').status).toBe('approved')
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
    
    const comment = commentOfType(result.newFile['20'].data.comments[0], 'agent')
    expect(comment.commentId).toBe(100)
    expect(comment.status).toBe('pending')
    expect(comment.filePath).toBe('src/main.ts')
    expect(comment.lineNumber).toBe(20)
    expect(comment.commentSide).toBe('RIGHT')
  })

  // ==========================================================================
  // Threading Tests (in_reply_to_id)
  // ==========================================================================

  it('reply comments appear after their parent on the same line', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Parent comment',
      in_reply_to_id: null,
    }
    const reply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: 10,
      body: 'Reply comment',
      in_reply_to_id: 1,
    }

    const result = buildExtendData('src/main.ts', [reply, parent], [])

    const comments = result.newFile['10'].data.comments
    expect(comments).toHaveLength(2)
    const parentComment = commentOfType(comments[0], 'existing')
    expect(parentComment.body).toBe('Parent comment')
    expect(parentComment.isReply).toBe(false)
    expect(commentOfType(comments[1], 'existing')).toMatchObject({
      body: 'Reply comment',
      isReply: true,
    })
  })

  it('reply with null line inherits position from parent', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Parent comment',
      in_reply_to_id: null,
    }
    const reply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: null,
      body: 'Reply with no line',
      in_reply_to_id: 1,
    }

    const result = buildExtendData('src/main.ts', [parent, reply], [])

    expect(result.newFile['10'].data.comments).toHaveLength(2)
    const replyComment = commentOfType(result.newFile['10'].data.comments[1], 'existing')
    expect(replyComment.body).toBe('Reply with no line')
    expect(replyComment.isReply).toBe(true)
  })

  it('reply with null line and null side inherits both from parent', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 5,
      side: 'LEFT',
      body: 'Parent on old file',
      in_reply_to_id: null,
    }
    const reply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: null,
      side: null,
      body: 'Reply inherits old file position',
      in_reply_to_id: 1,
    }

    const result = buildExtendData('src/main.ts', [parent, reply], [])

    expect(result.oldFile['5'].data.comments).toHaveLength(2)
    const replyComment = commentOfType(result.oldFile['5'].data.comments[1], 'existing')
    expect(replyComment.body).toBe('Reply inherits old file position')
    expect(replyComment.isReply).toBe(true)
    expect(result.newFile).toEqual({})
  })

  it('multiple reply threads on different lines stay separate', () => {
    const parent1: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Thread 1 parent',
      in_reply_to_id: null,
    }
    const reply1: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: 10,
      body: 'Thread 1 reply',
      in_reply_to_id: 1,
    }
    const parent2: ReviewComment = {
      ...baseExistingComment,
      id: 3,
      line: 20,
      body: 'Thread 2 parent',
      in_reply_to_id: null,
    }
    const reply2: ReviewComment = {
      ...baseExistingComment,
      id: 4,
      line: null,
      body: 'Thread 2 reply',
      in_reply_to_id: 3,
    }

    const result = buildExtendData('src/main.ts', [parent1, reply1, parent2, reply2], [])

    expect(result.newFile['10'].data.comments).toHaveLength(2)
    expect(result.newFile['10'].data.comments.map(comment => commentOfType(comment, 'existing').body)).toEqual([
      'Thread 1 parent',
      'Thread 1 reply',
    ])

    expect(result.newFile['20'].data.comments).toHaveLength(2)
    expect(result.newFile['20'].data.comments.map(comment => commentOfType(comment, 'existing').body)).toEqual([
      'Thread 2 parent',
      'Thread 2 reply',
    ])
  })

  it('replies are sorted chronologically within a thread', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Parent',
      created_at: '2024-01-01T00:00:00Z',
      in_reply_to_id: null,
    }
    const earlyReply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: 10,
      body: 'Early reply',
      created_at: '2024-01-01T01:00:00Z',
      in_reply_to_id: 1,
    }
    const lateReply: ReviewComment = {
      ...baseExistingComment,
      id: 3,
      line: 10,
      body: 'Late reply',
      created_at: '2024-01-01T02:00:00Z',
      in_reply_to_id: 1,
    }

    // Pass in reverse order to verify sorting
    const result = buildExtendData('src/main.ts', [lateReply, parent, earlyReply], [])

    expect(result.newFile['10'].data.comments).toHaveLength(3)
    expect(result.newFile['10'].data.comments.map(comment => commentOfType(comment, 'existing').body)).toEqual([
      'Parent',
      'Early reply',
      'Late reply',
    ])
  })

  it('orphan reply with null line is dropped when parent not found', () => {
    const orphan: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: null,
      body: 'Orphan reply',
      in_reply_to_id: 999,
    }

    const result = buildExtendData('src/main.ts', [orphan], [])

    expect(result.oldFile).toEqual({})
    expect(result.newFile).toEqual({})
  })

  it('reply with own line but different from parent uses parent line', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Parent',
      in_reply_to_id: null,
    }
    const reply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: 15,
      body: 'Reply (outdated line)',
      in_reply_to_id: 1,
    }

    const result = buildExtendData('src/main.ts', [parent, reply], [])

    // Reply should be grouped with parent at line 10, not at its own line 15
    expect(result.newFile['10'].data.comments).toHaveLength(2)
    expect(commentOfType(result.newFile['10'].data.comments[1], 'existing').body).toBe('Reply (outdated line)')
    expect(result.newFile['15']).toBeUndefined()
  })

  it('existing thread + pending comment coexist on the same line', () => {
    const parent: ReviewComment = {
      ...baseExistingComment,
      id: 1,
      line: 10,
      body: 'Thread parent',
      in_reply_to_id: null,
    }
    const reply: ReviewComment = {
      ...baseExistingComment,
      id: 2,
      line: 10,
      body: 'Thread reply',
      in_reply_to_id: 1,
    }
    const pending: ReviewSubmissionComment[] = [
      { ...basePendingComment, line: 10 },
    ]

    const result = buildExtendData('src/main.ts', [parent, reply], pending)

    expect(result.newFile['10'].data.comments).toHaveLength(3)
    // Thread first (parent, reply), then pending
    expect(commentOfType(result.newFile['10'].data.comments[0], 'existing').body).toBe('Thread parent')
    expect(commentOfType(result.newFile['10'].data.comments[1], 'existing').body).toBe('Thread reply')
    expect(result.newFile['10'].data.comments[2].type).toBe('pending')
  })
})

// ============================================================================
// prCommentsToReviewComments Tests
// ============================================================================

const basePrComment: PrComment = {
  id: 100,
  pr_id: 1,
  author: 'reviewer',
  body: 'Looks good',
  comment_type: 'review_comment',
  file_path: 'src/main.ts',
  line_number: 10,
  addressed: 0,
  outdated: 0,
  created_at: 1704067200, // 2024-01-01T00:00:00Z
}

describe('prCommentsToReviewComments', () => {
  it('converts a review_comment with file_path and line_number', () => {
    const result = prCommentsToReviewComments([basePrComment])

    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      id: 100,
      pr_number: 0,
      repo_owner: '',
      repo_name: '',
      path: 'src/main.ts',
      line: 10,
      side: 'RIGHT',
      body: 'Looks good',
      author: 'reviewer',
      created_at: new Date(1704067200 * 1000).toISOString(),
      in_reply_to_id: null,
    })
  })

  it('excludes comments without file_path', () => {
    const comment: PrComment = {
      ...basePrComment,
      file_path: null,
    }

    const result = prCommentsToReviewComments([comment])

    expect(result).toHaveLength(0)
  })

  it('excludes comments without line_number', () => {
    const comment: PrComment = {
      ...basePrComment,
      line_number: null,
    }

    const result = prCommentsToReviewComments([comment])

    expect(result).toHaveLength(0)
  })

  it('excludes issue_comment type', () => {
    const comment: PrComment = {
      ...basePrComment,
      comment_type: 'issue_comment',
      file_path: null,
      line_number: null,
    }

    const result = prCommentsToReviewComments([comment])

    expect(result).toHaveLength(0)
  })

  it('excludes review_body type', () => {
    const comment: PrComment = {
      ...basePrComment,
      comment_type: 'review_body',
      file_path: null,
      line_number: null,
    }

    const result = prCommentsToReviewComments([comment])

    expect(result).toHaveLength(0)
  })

  it('converts multiple inline comments', () => {
    const comments: PrComment[] = [
      basePrComment,
      { ...basePrComment, id: 101, line_number: 20, body: 'Also this' },
      { ...basePrComment, id: 102, file_path: 'src/other.ts', line_number: 5, body: 'And this' },
    ]

    const result = prCommentsToReviewComments(comments)

    expect(result).toHaveLength(3)
    expect(result[0].line).toBe(10)
    expect(result[1].line).toBe(20)
    expect(result[2].path).toBe('src/other.ts')
  })

  it('returns empty array for empty input', () => {
    const result = prCommentsToReviewComments([])

    expect(result).toHaveLength(0)
  })

  it('filters mix of inline and non-inline comments', () => {
    const comments: PrComment[] = [
      basePrComment,
      { ...basePrComment, id: 101, comment_type: 'issue_comment', file_path: null, line_number: null },
      { ...basePrComment, id: 102, comment_type: 'review_body', file_path: null, line_number: null },
      { ...basePrComment, id: 103, line_number: 30, body: 'Another inline' },
    ]

    const result = prCommentsToReviewComments(comments)

    expect(result).toHaveLength(2)
    expect(result[0].id).toBe(100)
    expect(result[1].id).toBe(103)
  })

  it('converts created_at from epoch seconds to ISO string', () => {
    const comment: PrComment = {
      ...basePrComment,
      created_at: 1707993000, // 2024-02-15T10:30:00Z
    }

    const result = prCommentsToReviewComments([comment])

    expect(result[0].created_at).toBe(new Date(1707993000 * 1000).toISOString())
  })

  it('result integrates correctly with buildExtendData', () => {
    const prComments: PrComment[] = [basePrComment]
    const reviewComments = prCommentsToReviewComments(prComments)

    const extendData = buildExtendData('src/main.ts', reviewComments, [])

    expect(extendData.newFile['10']).toBeDefined()
    expect(extendData.newFile['10'].data.comments).toHaveLength(1)
    const displayComment = commentOfType(extendData.newFile['10'].data.comments[0], 'existing')
    expect(displayComment.author).toBe('reviewer')
    expect(displayComment.body).toBe('Looks good')
  })
})

describe('buildExtendData with AI threads', () => {
  const thread: AiThread = {
    id: 't1', anchor: { type: 'line', filename: 'a.ts', line: 3, side: 'RIGHT' }, status: 'answered',
    messages: [{ role: 'user', body: 'why?', created_at: 1 }, { role: 'ai', body: 'because', created_at: 2 }],
    created_at: 1, updated_at: 2,
  }

  it('places a line-anchored thread on the RIGHT side at its line', () => {
    const { newFile } = buildExtendData('a.ts', [], [], [], [thread])
    const entry = newFile['3'].data.comments.find(c => c.type === 'ai-thread')
    expect(entry?.thread?.id).toBe('t1')
  })

  it('ignores step-anchored threads and threads for other files', () => {
    const stepThread: AiThread = { ...thread, id: 't2', anchor: { type: 'step', step_id: 's1' } }
    const otherFile: AiThread = { ...thread, id: 't3', anchor: { type: 'line', filename: 'b.ts', line: 3, side: 'RIGHT' } }
    const { newFile } = buildExtendData('a.ts', [], [], [], [stepThread, otherFile])
    expect(newFile['3']?.data.comments.some(c => c.type === 'ai-thread')).toBeFalsy()
  })

  it('places a pending reply under its parent comment line', () => {
    const parent = { ...baseExistingComment, id: 1, path: 'src/main.ts', line: 20, side: 'RIGHT' }
    const { newFile } = buildExtendData('src/main.ts', [parent], [], [], [], [{ commentId: 1, body: 'queued reply' }])
    const entry = newFile['20'].data.comments.find(c => c.type === 'pending-reply')
    expect(entry?.body).toBe('queued reply')
    expect(entry?.commentId).toBe(1)
  })

  it('ignores a pending reply whose parent comment is not on this file', () => {
    const { newFile } = buildExtendData('src/main.ts', [], [], [], [], [{ commentId: 999, body: 'orphan' }])
    const hasPendingReply = Object.values(newFile).some(line => line.data.comments.some(c => c.type === 'pending-reply'))
    expect(hasPendingReply).toBe(false)
  })

  it('places a comment-anchored thread inline at its line, nested under the comment', () => {
    const commentThread: AiThread = {
      ...thread,
      id: 't4',
      anchor: { type: 'comment', comment_id: 99, filename: 'a.ts', line: 3, side: 'RIGHT' },
    }
    const { newFile } = buildExtendData('a.ts', [], [], [], [commentThread])
    const entry = newFile['3'].data.comments.find(c => c.type === 'ai-thread')
    expect(entry?.thread?.id).toBe('t4')
    // Nested (reply-styled) so it reads as a follow-up to the AI review comment.
    expect(entry?.isReply).toBe(true)
  })

  it('does not nest a line-anchored thread', () => {
    const { newFile } = buildExtendData('a.ts', [], [], [], [thread])
    const entry = newFile['3'].data.comments.find(c => c.type === 'ai-thread')
    expect(entry?.isReply).toBeFalsy()
  })
})

describe('approvedInlineAgentComments', () => {
  it('keeps only approved inline comments that can be anchored to a line', () => {
    const approved: AgentReviewComment = { ...baseAgentComment, id: 1, status: 'approved' }
    const stillPending: AgentReviewComment = { ...baseAgentComment, id: 2, status: 'pending' }
    const dismissed: AgentReviewComment = { ...baseAgentComment, id: 3, status: 'dismissed' }
    const approvedSummary: AgentReviewComment = { ...baseAgentComment, id: 4, status: 'approved', comment_type: 'summary' }
    const approvedNoLine: AgentReviewComment = { ...baseAgentComment, id: 5, status: 'approved', line_number: null }

    const result = approvedInlineAgentComments([approved, stillPending, dismissed, approvedSummary, approvedNoLine])

    expect(result.map(c => c.id)).toEqual([1])
  })
})

describe('agentCommentToSubmission', () => {
  it('maps an agent comment to a review submission comment', () => {
    const approved: AgentReviewComment = { ...baseAgentComment, file_path: 'src/a.ts', line_number: 42, side: 'LEFT', body: '  trim me  ' }
    expect(agentCommentToSubmission(approved)).toEqual({
      path: 'src/a.ts',
      line: 42,
      side: 'LEFT',
      body: 'trim me',
    })
  })

  it('defaults a missing side to RIGHT', () => {
    const approved: AgentReviewComment = { ...baseAgentComment, side: null }
    expect(agentCommentToSubmission(approved).side).toBe('RIGHT')
  })
})
