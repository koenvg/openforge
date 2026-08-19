import { describe, it, expect } from 'vitest'
import { walkthroughButtonState } from './walkthroughButtonState'
import type { PrWalkthrough } from '@openforge-app/plugin-sdk/domain'

function wt(partial: Partial<PrWalkthrough>): PrWalkthrough {
  return {
    pr_id: 1, head_sha: 'sha1', walkthrough_session_key: null,
    status: 'ready', steps_json: null, error_message: null,
    created_at: 0, updated_at: 0, ...partial,
  }
}

describe('walkthroughButtonState', () => {
  it('is idle when there is no walkthrough', () => {
    expect(walkthroughButtonState(null, 'sha1')).toBe('idle')
    expect(walkthroughButtonState(undefined, 'sha1')).toBe('idle')
  })
  it('reflects generating and error status', () => {
    expect(walkthroughButtonState(wt({ status: 'generating' }), 'sha1')).toBe('generating')
    expect(walkthroughButtonState(wt({ status: 'error' }), 'sha1')).toBe('error')
  })
  it('is ready only when the ready walkthrough matches the current head sha', () => {
    expect(walkthroughButtonState(wt({ status: 'ready', head_sha: 'sha1' }), 'sha1')).toBe('ready')
  })
  it('is stale when a ready walkthrough is for an older commit', () => {
    expect(walkthroughButtonState(wt({ status: 'ready', head_sha: 'old' }), 'sha1')).toBe('stale')
  })
})
