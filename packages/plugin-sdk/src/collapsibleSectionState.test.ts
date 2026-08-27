import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import {
  COLLAPSED_SECTIONS_STORAGE_KEY,
  clearCollapsedSections,
  collapsedSections,
  isSectionCollapsed,
  pluginSectionKey,
  setSectionCollapsed,
  toggleSection,
} from './collapsibleSectionState'

describe('collapsibleSectionState', () => {
  beforeEach(() => {
    localStorage.clear()
    clearCollapsedSections()
  })

  // The store moved here from the host app (src/lib/infoPanelSectionState.ts). Changing
  // the key would silently reset every user's collapsed sections on upgrade.
  it('keeps the storage key the host app already persisted under', () => {
    expect(COLLAPSED_SECTIONS_STORAGE_KEY).toBe('openforge.infoPanelSectionCollapse.v1')
  })

  it('treats an unseen section as expanded by default', () => {
    expect(isSectionCollapsed(get(collapsedSections), 'details')).toBe(false)
  })

  it('toggles a section between collapsed and expanded', () => {
    toggleSection('details')
    expect(isSectionCollapsed(get(collapsedSections), 'details')).toBe(true)

    toggleSection('details')
    expect(isSectionCollapsed(get(collapsedSections), 'details')).toBe(false)
  })

  it('sets an explicit collapsed state', () => {
    setSectionCollapsed('pull-requests', true)
    expect(isSectionCollapsed(get(collapsedSections), 'pull-requests')).toBe(true)

    setSectionCollapsed('pull-requests', false)
    expect(isSectionCollapsed(get(collapsedSections), 'pull-requests')).toBe(false)
  })

  it('persists collapsed sections to localStorage', () => {
    setSectionCollapsed('initial-prompt', true)

    const raw = localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)['initial-prompt']).toBe(true)
  })

  it('preserves unrelated persisted keys written after this bundle initialized', () => {
    localStorage.setItem(
      COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify({ [pluginSectionKey('another-plugin', 'details')]: true }),
    )

    setSectionCollapsed('initial-prompt', true)

    expect(JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY) as string)).toEqual({
      [pluginSectionKey('another-plugin', 'details')]: true,
      'initial-prompt': true,
    })
  })

  it('stores a single global map (not scoped per task or project)', () => {
    setSectionCollapsed('changes', true)

    // The same global key drives every task/project view; there is no task scoping.
    expect(isSectionCollapsed(get(collapsedSections), 'changes')).toBe(true)
    const raw = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY) as string)
    expect(Object.keys(raw)).toEqual(['changes'])
  })

  it('does not persist expanded (default) sections', () => {
    setSectionCollapsed('details', true)
    setSectionCollapsed('details', false)

    expect(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  it('clears all collapsed state', () => {
    setSectionCollapsed('details', true)
    clearCollapsedSections()

    expect(isSectionCollapsed(get(collapsedSections), 'details')).toBe(false)
    expect(localStorage.getItem(COLLAPSED_SECTIONS_STORAGE_KEY)).toBeNull()
  })

  describe('pluginSectionKey', () => {
    it('namespaces a plugin section key by plugin id', () => {
      expect(pluginSectionKey('github-sync', 'pull-requests')).toBe('plugin:github-sync:pull-requests')
    })

    it('keeps two plugins using the same local key apart', () => {
      setSectionCollapsed(pluginSectionKey('jira', 'details'), true)

      expect(isSectionCollapsed(get(collapsedSections), pluginSectionKey('jira', 'details'))).toBe(true)
      expect(isSectionCollapsed(get(collapsedSections), pluginSectionKey('github-sync', 'details'))).toBe(false)
      // Built-in host sections use bare keys, so they never collide with a plugin's.
      expect(isSectionCollapsed(get(collapsedSections), 'details')).toBe(false)
    })
  })
})
