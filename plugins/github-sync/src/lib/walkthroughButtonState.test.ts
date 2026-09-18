import { describe, it, expect } from 'vitest'
import { walkthroughButtonState } from './walkthroughButtonState'
import type { WalkthroughRecordV1 } from './walkthroughRecord'

function wt(partial: Partial<WalkthroughRecordV1>): WalkthroughRecordV1 {
  return {
    version: 1,
    prId: 1,
    scope: { namespace: 'github', targetKey: 'gh:o/r#1', revision: 'sha1' },
    attemptId: 'attempt-1',
    state: 'ready',
    steps: [],
    error: null,
    createdAt: 0,
    updatedAt: 0,
    ...partial,
  }
}

describe('walkthroughButtonState', () => {
  it('is idle when there is no walkthrough', () => {
    expect(walkthroughButtonState(null, 'sha1')).toBe('idle')
    expect(walkthroughButtonState(undefined, 'sha1')).toBe('idle')
  })
  it('reflects generating and distinct terminal status', () => {
    expect(walkthroughButtonState(wt({ state: 'generating' }), 'sha1')).toBe('generating')
    expect(walkthroughButtonState(wt({ state: 'failed' }), 'sha1')).toBe('failed')
    expect(walkthroughButtonState(wt({ state: 'aborted' }), 'sha1')).toBe('aborted')
    expect(walkthroughButtonState(wt({ state: 'no-submissions' }), 'sha1')).toBe('no-submissions')
  })
  it('is ready only when the ready walkthrough matches the current head sha', () => {
    expect(walkthroughButtonState(wt({ state: 'ready' }), 'sha1')).toBe('ready')
  })
  it('is stale when a ready walkthrough is for an older commit', () => {
    expect(walkthroughButtonState(wt({ state: 'ready', scope: { namespace: 'github', targetKey: 'gh:o/r#1', revision: 'old' } }), 'sha1')).toBe('stale')
  })
})
