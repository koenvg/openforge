import { describe, expect, it, beforeEach } from 'vitest'
import {
  clearTaskReviewPaneState,
  getTaskReviewReviewedFileShas,
  isTaskReviewFileReviewed,
  markTaskReviewFileReviewed,
  pruneTaskReviewReviewedFiles,
  unmarkTaskReviewFileReviewed,
} from './taskReviewPaneState'
import type { PrFileDiff } from './types'

function diff(filename: string, sha: string): PrFileDiff {
  return {
    sha,
    filename,
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: '@@ -1,1 +1,1 @@',
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
  }
}

describe('task review pane reviewed files', () => {
  beforeEach(() => {
    clearTaskReviewPaneState()
  })

  it('marks a file reviewed for its current sha', () => {
    const file = diff('src/feature.ts', 'sha-one')

    markTaskReviewFileReviewed('task-1', file)

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/feature.ts', 'sha-one']]))
  })

  it('treats the same file as unreviewed when its sha changes', () => {
    markTaskReviewFileReviewed('task-1', diff('src/feature.ts', 'sha-one'))

    expect(isTaskReviewFileReviewed('task-1', diff('src/feature.ts', 'sha-two'))).toBe(false)
  })

  it('uses diff content as the reviewed identity when the file sha is empty', () => {
    const original = diff('src/feature.ts', '')
    const changed = {
      ...original,
      additions: 2,
      changes: 3,
      patch: '@@ -1,1 +1,2 @@\n line\n+new line',
    }

    markTaskReviewFileReviewed('task-1', original)

    expect(isTaskReviewFileReviewed('task-1', original)).toBe(true)
    expect(isTaskReviewFileReviewed('task-1', changed)).toBe(false)
  })

  it('does not hide empty-sha truncated diffs because their content identity is incomplete', () => {
    const truncated = { ...diff('src/feature.ts', ''), is_truncated: true }

    markTaskReviewFileReviewed('task-1', truncated)

    expect(isTaskReviewFileReviewed('task-1', truncated)).toBe(false)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map())
  })

  it('removes reviewed state for a file when the user unchecks it', () => {
    const file = diff('src/feature.ts', 'sha-one')
    markTaskReviewFileReviewed('task-1', file)

    unmarkTaskReviewFileReviewed('task-1', file.filename)

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(false)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map())
  })

  it('prunes reviewed file entries that no longer match the current diff files', () => {
    markTaskReviewFileReviewed('task-1', diff('src/feature.ts', 'sha-one'))
    markTaskReviewFileReviewed('task-1', diff('src/unchanged.ts', 'sha-old'))

    pruneTaskReviewReviewedFiles('task-1', [diff('src/feature.ts', 'sha-two')])

    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map())
  })
})
