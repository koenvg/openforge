import { describe, it, expect } from 'vitest'
import { searchInjectables, filterInjectables, groupInjectables, sectionOf, cycleSectionFilter } from './facets'
import type { Injectable } from '../domain'

const make = (over: Partial<Injectable>): Injectable => ({
  id: 'project:skill:a',
  kind: 'skill',
  name: 'a',
  description: null,
  origin: 'project',
  triggerMode: 'auto+manual',
  sourceDir: null,
  sourcePath: null,
  content: null,
  invocationText: '/a ',
  ...over,
})

describe('facets', () => {
  it('search matches name and description case-insensitively; empty returns all', () => {
    const items = [
      make({ name: 'Refactor' }),
      make({ name: 'b', description: 'helps REFACTOR code' }),
      make({ name: 'c' }),
    ]
    expect(searchInjectables(items, 'refactor').length).toBe(2)
    expect(searchInjectables(items, '').length).toBe(3)
  })

  it('filter ANDs across facets and ORs within a facet', () => {
    const items = [
      make({ name: 'a', origin: 'project', triggerMode: 'manual-only' }),
      make({ name: 'b', origin: 'personal', triggerMode: 'manual-only' }),
      make({ name: 'c', origin: 'project', triggerMode: 'auto+manual' }),
    ]
    const out = filterInjectables(items, { origins: ['project', 'personal'], triggers: ['manual-only'] })
    expect(out.map((i) => i.name).sort()).toEqual(['a', 'b'])
  })

  it('empty/omitted facet is no constraint', () => {
    const items = [make({ name: 'a' }), make({ name: 'b', origin: 'plugin' })]
    expect(filterInjectables(items, {}).length).toBe(2)
    expect(filterInjectables(items, { origins: [] }).length).toBe(2)
  })

  it('groups by origin in canonical order with friendly labels', () => {
    const items = [
      make({ name: 'a', origin: 'builtin' }),
      make({ name: 'b', origin: 'personal' }),
      make({ name: 'c', origin: 'project' }),
    ]
    const groups = groupInjectables(items, 'origin')
    expect(groups.map((g) => g.key)).toEqual(['personal', 'project', 'builtin'])
    expect(groups[0].label).toBe('Personal')
    expect(groups.find((g) => g.key === 'builtin')!.label).toBe('Claude Code')
  })

  it('groups by trigger with friendly labels', () => {
    const items = [make({ triggerMode: 'manual-only' }), make({ triggerMode: 'auto+manual' })]
    const groups = groupInjectables(items, 'trigger')
    expect(groups.map((g) => g.label).sort()).toEqual(['auto + manual', 'manual only'])
  })

  it('sectionOf returns "snippet" for snippets, else the origin', () => {
    expect(sectionOf(make({ kind: 'skill', origin: 'personal' }))).toBe('personal')
    expect(sectionOf(make({ kind: 'command', origin: 'builtin' }))).toBe('builtin')
    expect(sectionOf(make({ kind: 'snippet', origin: 'personal' }))).toBe('snippet')
  })

  it('groups snippets into a first-position "Snippets" section in origin mode', () => {
    const items = [
      make({ name: 'a', origin: 'project' }),
      make({ name: 's', kind: 'snippet', origin: 'personal' }),
      make({ name: 'p', origin: 'personal' }),
    ]
    const groups = groupInjectables(items, 'origin')
    expect(groups.map((g) => g.key)).toEqual(['snippet', 'personal', 'project'])
    expect(groups[0].label).toBe('Snippets')
  })

  it('groups snippets into a first-position "Snippets" section in trigger mode too', () => {
    const items = [
      make({ name: 'a', triggerMode: 'manual-only' }),
      make({ name: 's', kind: 'snippet', triggerMode: 'manual-only' }),
    ]
    const groups = groupInjectables(items, 'trigger')
    expect(groups.map((g) => g.key)).toEqual(['snippet', 'manual-only'])
    expect(groups[0].label).toBe('Snippets')
  })

  it('filters by section: the Snippets chip isolates snippets; origin chips exclude them', () => {
    const items = [
      make({ name: 'skill', kind: 'skill', origin: 'personal' }),
      make({ name: 'snip', kind: 'snippet', origin: 'personal' }),
    ]
    expect(filterInjectables(items, { sections: ['snippet'] }).map((i) => i.name)).toEqual(['snip'])
    expect(filterInjectables(items, { sections: ['personal'] }).map((i) => i.name)).toEqual(['skill'])
  })

  describe('cycleSectionFilter', () => {
    it('cycles forward from All through each section and wraps back to All', () => {
      expect(cycleSectionFilter([], 1)).toEqual(['snippet'])
      expect(cycleSectionFilter(['snippet'], 1)).toEqual(['personal'])
      expect(cycleSectionFilter(['personal'], 1)).toEqual(['project'])
      expect(cycleSectionFilter(['project'], 1)).toEqual(['plugin'])
      expect(cycleSectionFilter(['plugin'], 1)).toEqual(['builtin'])
      expect(cycleSectionFilter(['builtin'], 1)).toEqual([]) // wrap to All
    })

    it('cycles backward, wrapping All to the last section', () => {
      expect(cycleSectionFilter([], -1)).toEqual(['builtin'])
      expect(cycleSectionFilter(['snippet'], -1)).toEqual([]) // back to All
      expect(cycleSectionFilter(['personal'], -1)).toEqual(['snippet'])
    })

    it('collapses a multi-selection to All-then-first when cycling', () => {
      // A mouse multi-select has no single cursor; treat it as All (index 0).
      expect(cycleSectionFilter(['personal', 'project'], 1)).toEqual(['snippet'])
      expect(cycleSectionFilter(['personal', 'project'], -1)).toEqual(['builtin'])
    })
  })
})
