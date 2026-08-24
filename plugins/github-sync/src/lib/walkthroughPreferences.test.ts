import { beforeEach, describe, expect, it } from 'vitest'
import {
  WALKTHROUGH_STEP_DETAILS_STORAGE_KEY,
  loadWalkthroughStepDetailsExpanded,
  saveWalkthroughStepDetailsExpanded,
} from './walkthroughPreferences'

describe('walkthrough step-details preference', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
  })

  it('defaults to expanded so a first-time reviewer still sees the step summary', () => {
    expect(loadWalkthroughStepDetailsExpanded()).toBe(true)
  })

  it('round-trips a collapsed choice so the diff keeps the extra space across PRs', () => {
    saveWalkthroughStepDetailsExpanded(false)

    expect(loadWalkthroughStepDetailsExpanded()).toBe(false)
  })

  it('falls back to expanded when the stored value is not a boolean', () => {
    globalThis.localStorage?.setItem(WALKTHROUGH_STEP_DETAILS_STORAGE_KEY, '"nope"')

    expect(loadWalkthroughStepDetailsExpanded()).toBe(true)
  })
})
