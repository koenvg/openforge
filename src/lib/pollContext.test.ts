import { describe, it, expect } from 'vitest'
import { computePollContext, pollContextEquals } from './pollContext'
import type { AppView } from './types'

const GLOBAL_PR_VIEW = 'plugin:github-sync:pr_review' as AppView

describe('computePollContext', () => {
  it('marks global view open when the current view is the global PR view', () => {
    const result = computePollContext({
      focused: true,
      activeProjectId: 'p1',
      currentView: GLOBAL_PR_VIEW,
      globalPrViewKey: GLOBAL_PR_VIEW,
    })
    expect(result).toEqual({ focused: true, activeProjectId: 'p1', globalViewOpen: true })
  })

  it('scopes to the active project when on a non-global view', () => {
    const result = computePollContext({
      focused: true,
      activeProjectId: 'p1',
      currentView: 'board' as AppView,
      globalPrViewKey: GLOBAL_PR_VIEW,
    })
    expect(result).toEqual({ focused: true, activeProjectId: 'p1', globalViewOpen: false })
  })

  it('passes through focus state', () => {
    const result = computePollContext({
      focused: false,
      activeProjectId: null,
      currentView: 'board' as AppView,
      globalPrViewKey: GLOBAL_PR_VIEW,
    })
    expect(result).toEqual({ focused: false, activeProjectId: null, globalViewOpen: false })
  })
})

describe('pollContextEquals', () => {
  it('is true for identical payloads', () => {
    const a = { focused: true, activeProjectId: 'p1', globalViewOpen: false }
    const b = { focused: true, activeProjectId: 'p1', globalViewOpen: false }
    expect(pollContextEquals(a, b)).toBe(true)
  })

  it('is false when any field differs', () => {
    const base = { focused: true, activeProjectId: 'p1', globalViewOpen: false }
    expect(pollContextEquals(base, { ...base, focused: false })).toBe(false)
    expect(pollContextEquals(base, { ...base, activeProjectId: 'p2' })).toBe(false)
    expect(pollContextEquals(base, { ...base, globalViewOpen: true })).toBe(false)
  })
})
