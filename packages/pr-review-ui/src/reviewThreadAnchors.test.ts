import { describe, expect, it } from 'vitest'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import { placeReviewThreads } from './reviewThreadAnchors'

const PATCH = [
  '@@ -10,3 +10,3 @@',
  ' const a = 1',
  '-const b = 2',
  '+const b = 3',
  ' const c = 4',
].join('\n')

function makeFile(overrides: Partial<PrFileDiff> = {}): PrFileDiff {
  return {
    sha: 'abc123',
    filename: 'src/main.ts',
    status: 'modified',
    additions: 1,
    deletions: 1,
    changes: 2,
    patch: PATCH,
    previous_filename: null,
    is_truncated: false,
    patch_line_count: null,
    ...overrides,
  }
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'rt_1',
    namespace: 'github',
    targetKey: 'gh:acme/web#1421',
    revision: 'sha-1',
    anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' },
    origin: 'agent',
    status: 'open',
    awaiting: 'none',
    runId: null,
    idempotencyKey: null,
    seenAt: null,
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'rtm_1', role: 'agent', body: 'Needs a null check', createdAt: 1 }],
    ...overrides,
  }
}

describe('placeReviewThreads', () => {
  it('anchors a thread whose line the patch shows on that side', () => {
    const thread = makeThread()

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(anchored).toEqual([thread])
    expect(orphaned).toEqual([])
  })

  it('anchors a LEFT thread against the old-side numbering', () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/main.ts', line: 11, side: 'LEFT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(anchored).toEqual([thread])
    expect(orphaned).toEqual([])
  })

  it('orphans a thread whose file the diff does not contain', () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/gone.ts', line: 12, side: 'RIGHT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(anchored).toEqual([])
    expect(orphaned).toEqual([{ thread, reason: 'file-not-in-diff' }])
  })

  it('orphans a thread whose anchor only ends with a reviewed filename', () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'main.ts', line: 12, side: 'RIGHT' } })

    const { orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(orphaned).toEqual([{ thread, reason: 'file-not-in-diff' }])
  })

  it('orphans a thread whose line falls outside every hunk of its file', () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'src/main.ts', line: 900, side: 'RIGHT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(anchored).toEqual([])
    expect(orphaned).toEqual([{ thread, reason: 'line-not-in-diff' }])
  })

  it('judges each side against its own numbering', () => {
    const addedLinePatch = ['@@ -10,2 +10,3 @@', ' const a = 1', '+const b = 3', ' const c = 4'].join('\n')
    const file = makeFile({ patch: addedLinePatch })
    const onNewSide = makeThread({ id: 'rt_new', anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' } })
    const onOldSide = makeThread({ id: 'rt_old', anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'LEFT' } })

    const { anchored, orphaned } = placeReviewThreads([file], [onNewSide, onOldSide])

    expect(anchored).toEqual([onNewSide])
    expect(orphaned).toEqual([{ thread: onOldSide, reason: 'line-not-in-diff' }])
  })

  it('orphans a thread on a file the viewer renders without a diff', () => {
    const thread = makeThread({ anchor: { kind: 'line', filePath: 'logo.png', line: 1, side: 'RIGHT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile({ filename: 'logo.png', patch: null })], [thread])

    expect(anchored).toEqual([])
    expect(orphaned).toEqual([{ thread, reason: 'line-not-in-diff' }])
  })

  it('judges a truncated patch by the lines it still shows', () => {
    const shown = makeThread({ id: 'rt_shown', anchor: { kind: 'line', filePath: 'src/main.ts', line: 12, side: 'RIGHT' } })
    const cutOff = makeThread({ id: 'rt_cut_off', anchor: { kind: 'line', filePath: 'src/main.ts', line: 900, side: 'RIGHT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile({ is_truncated: true })], [shown, cutOff])

    expect(anchored).toEqual([shown])
    expect(orphaned).toEqual([{ thread: cutOff, reason: 'line-not-in-diff' }])
  })

  it('leaves a custom-anchored thread to the surface that owns its anchor', () => {
    const thread = makeThread({ anchor: { kind: 'custom', key: 'step-3' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [thread])

    expect(anchored).toEqual([])
    expect(orphaned).toEqual([])
  })

  it('keeps the supplied thread order within each group', () => {
    const first = makeThread({ id: 'rt_1' })
    const second = makeThread({ id: 'rt_2', anchor: { kind: 'line', filePath: 'src/gone.ts', line: 1, side: 'RIGHT' } })
    const third = makeThread({ id: 'rt_3', anchor: { kind: 'line', filePath: 'src/main.ts', line: 10, side: 'RIGHT' } })
    const fourth = makeThread({ id: 'rt_4', anchor: { kind: 'line', filePath: 'src/main.ts', line: 900, side: 'RIGHT' } })

    const { anchored, orphaned } = placeReviewThreads([makeFile()], [first, second, third, fourth])

    expect(anchored.map(thread => thread.id)).toEqual(['rt_1', 'rt_3'])
    expect(orphaned.map(entry => entry.thread.id)).toEqual(['rt_2', 'rt_4'])
  })
})
