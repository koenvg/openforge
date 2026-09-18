import { describe, expect, it } from 'vitest'
import { walkthroughStorageKey } from './walkthroughStore'

describe('walkthroughStorageKey', () => {
  it('keys by pr id and head sha', () => {
    expect(walkthroughStorageKey(42, 'abc123')).toBe('walkthrough:42:abc123')
  })
})
