import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DIFF_VIEW_WRAP_STORAGE_KEY,
  loadDiffViewWrap,
  saveDiffViewWrap,
} from './diffViewPreferences'

describe('diff view wrap preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
  })

  it('defaults to false when nothing is stored', () => {
    expect(loadDiffViewWrap()).toBe(false)
  })

  it('round-trips a saved preference', () => {
    saveDiffViewWrap(true)
    expect(loadDiffViewWrap()).toBe(true)

    saveDiffViewWrap(false)
    expect(loadDiffViewWrap()).toBe(false)
  })

  it('falls back to the default when the stored value is malformed', () => {
    localStorage.setItem(DIFF_VIEW_WRAP_STORAGE_KEY, 'not-a-bool')
    expect(loadDiffViewWrap()).toBe(false)
  })
})
