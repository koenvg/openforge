import { describe, expect, it } from 'vitest'
import { extractWalkthroughStepsJson, walkthroughStorageKey } from './walkthroughStore'

const STEPS = { steps: [{ id: 'step-1', title: 'Do a thing', summary: 'x', files: [] }] }

describe('walkthroughStorageKey', () => {
  it('keys by pr id and head sha', () => {
    expect(walkthroughStorageKey(42, 'abc123')).toBe('walkthrough:42:abc123')
  })
})

describe('extractWalkthroughStepsJson', () => {
  it('accepts clean JSON with a steps array', () => {
    const raw = JSON.stringify(STEPS)
    expect(extractWalkthroughStepsJson(raw)).toBe(JSON.stringify(STEPS))
  })

  it('extracts JSON from a fenced code block', () => {
    const raw = 'Here is the walkthrough:\n```json\n' + JSON.stringify(STEPS) + '\n```\n'
    expect(extractWalkthroughStepsJson(raw)).toBe(JSON.stringify(STEPS))
  })

  it('extracts JSON wrapped in prose without fences', () => {
    const raw = 'Sure! ' + JSON.stringify(STEPS) + ' Hope that helps.'
    expect(extractWalkthroughStepsJson(raw)).toBe(JSON.stringify(STEPS))
  })

  it('returns null for empty output', () => {
    expect(extractWalkthroughStepsJson('   ')).toBeNull()
  })

  it('returns null when there is no valid JSON', () => {
    expect(extractWalkthroughStepsJson('I could not produce a walkthrough.')).toBeNull()
  })

  it('returns null for a JSON object without a steps array', () => {
    expect(extractWalkthroughStepsJson(JSON.stringify({ notSteps: true }))).toBeNull()
  })
})
