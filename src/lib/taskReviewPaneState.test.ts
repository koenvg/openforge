import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearTaskReviewPaneState,
  getTaskReviewReviewedFileShas,
  getTaskReviewReviewedFileSnapshots,
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

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('marks a file reviewed for its current sha', () => {
    const file = diff('src/feature.ts', 'sha-one')

    markTaskReviewFileReviewed('task-1', file)

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/feature.ts', 'sha-one']]))
  })

  it('restores reviewed files after the in-memory pane cache is cleared', () => {
    const file = diff('src/feature.ts', 'sha-one')
    markTaskReviewFileReviewed('task-1', file)

    clearTaskReviewPaneState(undefined, { clearPersisted: false })

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

  it('persists a reviewed file content snapshot for future since-reviewed comparisons', () => {
    const file = diff('src/feature.ts', 'sha-one')

    markTaskReviewFileReviewed('task-1', file, { newContent: 'reviewed content\n' })

    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map([
      ['src/feature.ts', { identity: 'sha-one', newContent: 'reviewed content\n' }],
    ]))

    clearTaskReviewPaneState(undefined, { clearPersisted: false })

    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map([
      ['src/feature.ts', { identity: 'sha-one', newContent: 'reviewed content\n' }],
    ]))
  })

  it('skips oversized reviewed file content snapshots while keeping the reviewed marker persistent', () => {
    const file = diff('src/large-feature.ts', 'sha-one')
    const oversizedContent = 'x'.repeat(300 * 1024)

    markTaskReviewFileReviewed('task-1', file, { newContent: oversizedContent })

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/large-feature.ts', 'sha-one']]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map())

    clearTaskReviewPaneState(undefined, { clearPersisted: false })

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/large-feature.ts', 'sha-one']]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map())
  })

  it('deterministically prunes snapshots over the global snapshot storage cap without dropping markers', () => {
    const snapshotContent = 'x'.repeat(240 * 1024)

    for (let index = 1; index <= 5; index += 1) {
      markTaskReviewFileReviewed('task-1', diff(`src/file-${index}.ts`, `sha-${index}`), {
        newContent: snapshotContent,
      })
    }

    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([
      ['src/file-1.ts', 'sha-1'],
      ['src/file-2.ts', 'sha-2'],
      ['src/file-3.ts', 'sha-3'],
      ['src/file-4.ts', 'sha-4'],
      ['src/file-5.ts', 'sha-5'],
    ]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map([
      ['src/file-1.ts', { identity: 'sha-1', newContent: snapshotContent }],
      ['src/file-2.ts', { identity: 'sha-2', newContent: snapshotContent }],
      ['src/file-3.ts', { identity: 'sha-3', newContent: snapshotContent }],
      ['src/file-4.ts', { identity: 'sha-4', newContent: snapshotContent }],
    ]))
  })

  it('prefers the task being updated when pruning snapshots over the global cap', () => {
    const snapshotContent = 'x'.repeat(240 * 1024)

    for (let index = 1; index <= 4; index += 1) {
      markTaskReviewFileReviewed('task-a', diff(`src/old-${index}.ts`, `old-sha-${index}`), {
        newContent: snapshotContent,
      })
    }
    markTaskReviewFileReviewed('task-z', diff('src/current.ts', 'current-sha'), {
      newContent: snapshotContent,
    })

    expect(getTaskReviewReviewedFileShas('task-z')).toEqual(new Map([['src/current.ts', 'current-sha']]))
    expect(getTaskReviewReviewedFileSnapshots('task-z')).toEqual(new Map([
      ['src/current.ts', { identity: 'current-sha', newContent: snapshotContent }],
    ]))
  })

  it('preserves current-task baselines when normalizing a legacy over-cap snapshot cache', () => {
    const snapshotContent = 'x'.repeat(240 * 1024)
    localStorage.setItem('openforge.taskReviewPaneState.reviewedFileSnapshots.v1', JSON.stringify({
      'task-a': [
        ['src/old-a-1.ts', { identity: 'old-a-sha-1', newContent: snapshotContent }],
        ['src/old-a-2.ts', { identity: 'old-a-sha-2', newContent: snapshotContent }],
        ['src/old-a-3.ts', { identity: 'old-a-sha-3', newContent: snapshotContent }],
        ['src/old-a-4.ts', { identity: 'old-a-sha-4', newContent: snapshotContent }],
      ],
      'task-z': [
        ['src/already-reviewed.ts', { identity: 'old-z-sha', newContent: snapshotContent }],
      ],
    }))

    markTaskReviewFileReviewed('task-z', diff('src/newly-reviewed.ts', 'new-z-sha'), {
      newContent: snapshotContent,
    })

    expect(getTaskReviewReviewedFileSnapshots('task-z')).toEqual(new Map([
      ['src/already-reviewed.ts', { identity: 'old-z-sha', newContent: snapshotContent }],
      ['src/newly-reviewed.ts', { identity: 'new-z-sha', newContent: snapshotContent }],
    ]))
  })

  it('keeps reviewed marker persistence when snapshot storage is rejected by quota', () => {
    const file = diff('src/feature.ts', 'sha-one')
    const setItem = Storage.prototype.setItem
    const rejectedSnapshotWrites: string[] = []
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === 'openforge.taskReviewPaneState.reviewedFileSnapshots.v1') {
        rejectedSnapshotWrites.push(value)
        throw new DOMException('snapshot quota exceeded', 'QuotaExceededError')
      }
      return setItem.call(this, key, value)
    })

    markTaskReviewFileReviewed('task-1', file, { newContent: 'reviewed content\n' })

    expect(rejectedSnapshotWrites).toHaveLength(1)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/feature.ts', 'sha-one']]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map())

    clearTaskReviewPaneState(undefined, { clearPersisted: false })

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/feature.ts', 'sha-one']]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map())
  })

  it('prunes oversized existing snapshots before writing reviewed markers', () => {
    const file = diff('src/feature.ts', 'sha-one')
    const snapshotStorageKey = 'openforge.taskReviewPaneState.reviewedFileSnapshots.v1'
    localStorage.setItem(snapshotStorageKey, JSON.stringify({
      'old-task': [['src/huge.ts', { identity: 'old-sha', newContent: 'x'.repeat(2 * 1024 * 1024) }]],
    }))
    const setItem = Storage.prototype.setItem
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key: string, value: string) {
      if (
        key === 'openforge.taskReviewPaneState.reviewedFiles.v1'
        && (localStorage.getItem(snapshotStorageKey)?.length ?? 0) > 1024 * 1024
      ) {
        throw new DOMException('reviewed marker quota blocked by stale snapshots', 'QuotaExceededError')
      }
      return setItem.call(this, key, value)
    })

    markTaskReviewFileReviewed('task-1', file, { newContent: 'reviewed content\n' })

    clearTaskReviewPaneState(undefined, { clearPersisted: false })

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(true)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map([['src/feature.ts', 'sha-one']]))
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map([
      ['src/feature.ts', { identity: 'sha-one', newContent: 'reviewed content\n' }],
    ]))
  })

  it('removes reviewed state and its comparison snapshot when the user unchecks it', () => {
    const file = diff('src/feature.ts', 'sha-one')
    markTaskReviewFileReviewed('task-1', file, { newContent: 'reviewed content\n' })

    unmarkTaskReviewFileReviewed('task-1', file.filename)

    expect(isTaskReviewFileReviewed('task-1', file)).toBe(false)
    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map())
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map())
  })

  it('prunes reviewed file entries that no longer match the current diff files without losing comparison snapshots', () => {
    markTaskReviewFileReviewed('task-1', diff('src/feature.ts', 'sha-one'), { newContent: 'old feature\n' })
    markTaskReviewFileReviewed('task-1', diff('src/unchanged.ts', 'sha-old'), { newContent: 'old unchanged\n' })

    pruneTaskReviewReviewedFiles('task-1', [diff('src/feature.ts', 'sha-two')])

    expect(getTaskReviewReviewedFileShas('task-1')).toEqual(new Map())
    expect(getTaskReviewReviewedFileSnapshots('task-1')).toEqual(new Map([
      ['src/feature.ts', { identity: 'sha-one', newContent: 'old feature\n' }],
      ['src/unchanged.ts', { identity: 'sha-old', newContent: 'old unchanged\n' }],
    ]))
  })
})
