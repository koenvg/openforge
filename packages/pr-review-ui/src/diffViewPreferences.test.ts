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

  it('defaults to true when nothing is stored', () => {
    expect(loadDiffViewWrap()).toBe(true)
  })

  it('round-trips a saved preference', () => {
    saveDiffViewWrap(false)
    expect(loadDiffViewWrap()).toBe(false)

    saveDiffViewWrap(true)
    expect(loadDiffViewWrap()).toBe(true)
  })

  it('falls back to the default when the stored value is malformed', () => {
    localStorage.setItem(DIFF_VIEW_WRAP_STORAGE_KEY, 'not-a-bool')
    expect(loadDiffViewWrap()).toBe(true)
  })
})
