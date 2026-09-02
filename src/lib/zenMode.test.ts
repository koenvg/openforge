import { describe, it, expect } from 'vitest'
import { isZenActive, canToggleZenMode } from './zenMode'

describe('isZenActive', () => {
  const base = {
    zenMode: true,
    currentView: 'board' as const,
    selectedTaskId: 'task-1',
    activeView: 'agent',
  }

  it('is active when zen is on, viewing a task, on the agent tab', () => {
    expect(isZenActive(base)).toBe(true)
  })

  it('is inactive when the zen flag is off', () => {
    expect(isZenActive({ ...base, zenMode: false })).toBe(false)
  })

  it('is inactive when no task is selected', () => {
    expect(isZenActive({ ...base, selectedTaskId: null })).toBe(false)
  })

  it('is inactive when the current view is not the board', () => {
    expect(isZenActive({ ...base, currentView: 'settings' })).toBe(false)
  })

  it('is inactive when a non-agent tab is active', () => {
    expect(isZenActive({ ...base, activeView: 'review' })).toBe(false)
    expect(isZenActive({ ...base, activeView: 'github-sync:changes' })).toBe(false)
  })
})

describe('canToggleZenMode', () => {
  it('allows toggling while viewing a task on the board', () => {
    expect(canToggleZenMode({ currentView: 'board', selectedTaskId: 'task-1' })).toBe(true)
  })

  it('blocks toggling on the board with no task open', () => {
    expect(canToggleZenMode({ currentView: 'board', selectedTaskId: null })).toBe(false)
  })

  it('blocks toggling outside the board even with a task selected', () => {
    expect(canToggleZenMode({ currentView: 'settings', selectedTaskId: 'task-1' })).toBe(false)
  })
})
