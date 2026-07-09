import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  infoPanelSectionCollapse,
  isInfoPanelSectionCollapsed,
  setInfoPanelSectionCollapsed,
  toggleInfoPanelSection,
  clearInfoPanelSectionCollapse,
} from './infoPanelSectionState'

const STORAGE_KEY = 'openforge.infoPanelSectionCollapse.v1'

describe('infoPanelSectionState', () => {
  beforeEach(() => {
    localStorage.clear()
    clearInfoPanelSectionCollapse()
  })

  it('treats an unseen section as expanded by default', () => {
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'details')).toBe(false)
  })

  it('toggles a section between collapsed and expanded', () => {
    toggleInfoPanelSection('details')
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'details')).toBe(true)

    toggleInfoPanelSection('details')
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'details')).toBe(false)
  })

  it('sets an explicit collapsed state', () => {
    setInfoPanelSectionCollapsed('pull-requests', true)
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'pull-requests')).toBe(true)

    setInfoPanelSectionCollapsed('pull-requests', false)
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'pull-requests')).toBe(false)
  })

  it('persists collapsed sections to localStorage', () => {
    setInfoPanelSectionCollapsed('handoff-notes', true)

    const raw = localStorage.getItem(STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)['handoff-notes']).toBe(true)
  })

  it('stores a single global map (not scoped per task or project)', () => {
    setInfoPanelSectionCollapsed('changes', true)

    // The same global key drives every task/project view; there is no task scoping.
    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'changes')).toBe(true)
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) as string)
    expect(Object.keys(raw)).toEqual(['changes'])
  })

  it('does not persist expanded (default) sections', () => {
    setInfoPanelSectionCollapsed('details', true)
    setInfoPanelSectionCollapsed('details', false)

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })

  it('clears all collapsed state', () => {
    setInfoPanelSectionCollapsed('details', true)
    clearInfoPanelSectionCollapse()

    expect(isInfoPanelSectionCollapsed(get(infoPanelSectionCollapse), 'details')).toBe(false)
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})
