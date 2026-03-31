import { describe, expect, it } from 'vitest'
import * as stores from './stores'

describe('stores module cleanup', () => {
  it('does not export the orphaned Claude session state store', () => {
    expect('claudeSessionStates' in stores).toBe(false)
  })
})
