import { describe, expect, it, vi } from 'vitest'
import type { ReviewThread } from '@openforge-app/plugin-sdk'
import type { PrFileDiff } from '@openforge-app/plugin-sdk/domain'
import {
  dismissSubmittedReviewThreads,
  resolvedAgentThreadSubmissions,
} from './reviewThreadSubmission'

const files: PrFileDiff[] = [{
  sha: 'abc123',
  filename: 'src/main.ts',
  status: 'modified',
  additions: 1,
  deletions: 1,
  changes: 2,
  patch: ['@@ -19,2 +19,2 @@', ' context', '-old', '+new'].join('\n'),
  previous_filename: null,
  is_truncated: false,
  patch_line_count: null,
}]

function reviewThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'RT-1',
    namespace: 'github',
    targetKey: 'gh:acme/web#42',
    revision: 'head-a',
    runId: 'run-1',
    origin: 'agent',
    anchor: { kind: 'line', filePath: 'src/main.ts', line: 20, side: 'RIGHT' },
    status: 'resolved',
    awaiting: 'none',
    idempotencyKey: 'finding-1',
    seenAt: null,
    hasUnreadAgentMessage: false,
    createdAt: 1,
    updatedAt: 1,
    messages: [{ id: 'RT-1:m1', role: 'agent', body: '  Guard the null case.  ', createdAt: 1 }],
    ...overrides,
  }
}

describe('resolvedAgentThreadSubmissions', () => {
  it('maps each resolved agent-authored line finding once', () => {
    const thread = reviewThread()

    expect(resolvedAgentThreadSubmissions(files, [thread, thread])).toEqual([{
      threadId: 'RT-1',
      comment: { path: 'src/main.ts', line: 20, side: 'RIGHT', body: 'Guard the null case.' },
    }])
  })

  it('excludes open, dismissed, non-agent, custom-anchored, and empty findings', () => {
    const threads = [
      reviewThread({ id: 'open', status: 'open' }),
      reviewThread({ id: 'dismissed', status: 'dismissed' }),
      reviewThread({ id: 'human', origin: 'human' }),
      reviewThread({ id: 'custom', anchor: { kind: 'custom', key: 'step:setup' } }),
      reviewThread({ id: 'empty', messages: [{ id: 'empty:m1', role: 'human', body: 'Question', createdAt: 1 }] }),
    ]

    expect(resolvedAgentThreadSubmissions(files, threads)).toEqual([])
  })

  it('excludes resolved findings whose file or line is not commentable in the diff', () => {
    const threads = [
      reviewThread({ id: 'missing-file', anchor: { kind: 'line', filePath: 'src/gone.ts', line: 20, side: 'RIGHT' } }),
      reviewThread({ id: 'missing-line', anchor: { kind: 'line', filePath: 'src/main.ts', line: 900, side: 'RIGHT' } }),
    ]

    expect(resolvedAgentThreadSubmissions(files, threads)).toEqual([])
  })
})

describe('dismissSubmittedReviewThreads', () => {
  it('dismisses exactly the submitted thread ids', async () => {
    const setStatus = vi.fn().mockResolvedValue(undefined)

    await dismissSubmittedReviewThreads(['RT-1', 'RT-2'], setStatus)

    expect(setStatus.mock.calls).toEqual([
      ['RT-1', 'dismissed'],
      ['RT-2', 'dismissed'],
    ])
  })

  it('reports a failed status write to the caller', async () => {
    const setStatus = vi.fn().mockRejectedValue(new Error('offline'))

    await expect(dismissSubmittedReviewThreads(['RT-1'], setStatus)).rejects.toThrow('offline')
  })
})
