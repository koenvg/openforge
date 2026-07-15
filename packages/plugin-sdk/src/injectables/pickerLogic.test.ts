import { describe, it, expect } from 'vitest'
import {
  formatCharCount,
  stepSelection,
  isEditablePersonalSkill,
  findInjectableBySource,
  isEditableSnippet,
  snippetDbId,
  isProjectChecked,
  toggleAllProjectsScope,
  toggleProjectInScope,
  flattenNavRows,
  navLeft,
  navRight,
} from './pickerLogic'
import type { Injectable } from '../domain'

const make = (over: Partial<Injectable>): Injectable => ({
  id: 'personal:skill:a',
  kind: 'skill',
  name: 'a',
  description: null,
  origin: 'personal',
  triggerMode: 'auto+manual',
  sourceDir: '.claude',
  sourcePath: 'a',
  content: null,
  invocationText: '/a ',
  ...over,
})

describe('formatCharCount', () => {
  it('groups thousands and suffixes with " char"', () => {
    expect(formatCharCount(2309)).toBe('2,309 char')
    expect(formatCharCount(1_000_000)).toBe('1,000,000 char')
  })

  it('handles small and zero counts without a separator', () => {
    expect(formatCharCount(0)).toBe('0 char')
    expect(formatCharCount(1)).toBe('1 char')
    expect(formatCharCount(999)).toBe('999 char')
  })
})

describe('stepSelection', () => {
  const ids = ['a', 'b', 'c']

  it('returns null for an empty list', () => {
    expect(stepSelection([], null, 1)).toBeNull()
  })

  it('selects the first item on down / last on up when nothing is selected', () => {
    expect(stepSelection(ids, null, 1)).toBe('a')
    expect(stepSelection(ids, null, -1)).toBe('c')
  })

  it('moves to the neighbour in the given direction', () => {
    expect(stepSelection(ids, 'a', 1)).toBe('b')
    expect(stepSelection(ids, 'b', -1)).toBe('a')
  })

  it('wraps around at the ends (circular)', () => {
    expect(stepSelection(ids, 'c', 1)).toBe('a')
    expect(stepSelection(ids, 'a', -1)).toBe('c')
  })

  it('falls back to first/last when the current id is no longer visible', () => {
    expect(stepSelection(ids, 'gone', 1)).toBe('a')
    expect(stepSelection(ids, 'gone', -1)).toBe('c')
  })
})

describe('isEditablePersonalSkill', () => {
  it('is true for a personal skill with a source dir and folder identity', () => {
    expect(isEditablePersonalSkill(make({ origin: 'personal', kind: 'skill' }))).toBe(true)
  })

  it('is false for non-personal skills', () => {
    expect(isEditablePersonalSkill(make({ origin: 'project', kind: 'skill' }))).toBe(false)
    expect(isEditablePersonalSkill(make({ origin: 'plugin', kind: 'skill' }))).toBe(false)
    expect(isEditablePersonalSkill(make({ origin: 'builtin', kind: 'skill' }))).toBe(false)
  })

  it('is false for personal commands', () => {
    expect(isEditablePersonalSkill(make({ origin: 'personal', kind: 'command' }))).toBe(false)
  })

  it('is false when the source dir or folder identity is missing', () => {
    expect(isEditablePersonalSkill(make({ sourceDir: null }))).toBe(false)
    expect(isEditablePersonalSkill(make({ sourcePath: null }))).toBe(false)
  })
})

describe('findInjectableBySource', () => {
  const items = [
    make({ id: 'personal:skill:renamed', name: 'renamed', sourceDir: '.claude', sourcePath: 'pr-writer' }),
    make({ id: 'project:skill:other', name: 'other', sourceDir: '.claude', sourcePath: 'other' }),
  ]

  it('matches on folder identity regardless of the (possibly renamed) name', () => {
    expect(findInjectableBySource(items, '.claude', 'pr-writer')?.id).toBe('personal:skill:renamed')
  })

  it('returns null when nothing matches or the identity is incomplete', () => {
    expect(findInjectableBySource(items, '.claude', 'gone')).toBeNull()
    expect(findInjectableBySource(items, null, 'pr-writer')).toBeNull()
    expect(findInjectableBySource(items, '.claude', null)).toBeNull()
  })
})

describe('isEditableSnippet', () => {
  it('is true only for snippet-kind injectables', () => {
    expect(isEditableSnippet(make({ kind: 'snippet' }))).toBe(true)
    expect(isEditableSnippet(make({ kind: 'skill' }))).toBe(false)
    expect(isEditableSnippet(make({ kind: 'command' }))).toBe(false)
  })
})

describe('snippetDbId', () => {
  it('extracts the db id from a snippet injectable id', () => {
    expect(snippetDbId(make({ kind: 'snippet', id: 'snippet:abc-123' }))).toBe('abc-123')
  })

  it('returns null for non-snippets', () => {
    expect(snippetDbId(make({ kind: 'skill', id: 'personal:skill:a' }))).toBeNull()
  })
})

describe('project scope checklist', () => {
  const ALL_IDS = ['P-1', 'P-2', 'P-3']

  it('isProjectChecked reflects all-projects and explicit scope', () => {
    expect(isProjectChecked({ allProjects: true, projectIds: [] }, 'P-1')).toBe(true)
    expect(isProjectChecked({ allProjects: false, projectIds: ['P-2'] }, 'P-2')).toBe(true)
    expect(isProjectChecked({ allProjects: false, projectIds: ['P-2'] }, 'P-1')).toBe(false)
  })

  it('toggles All on and off', () => {
    expect(toggleAllProjectsScope({ allProjects: false, projectIds: ['P-1'] })).toEqual({
      allProjects: true,
      projectIds: [],
    })
    expect(toggleAllProjectsScope({ allProjects: true, projectIds: [] })).toEqual({
      allProjects: false,
      projectIds: [],
    })
  })

  it('unchecking one project while on All converts to the explicit rest and unticks All', () => {
    expect(toggleProjectInScope({ allProjects: true, projectIds: [] }, 'P-2', ALL_IDS)).toEqual({
      allProjects: false,
      projectIds: ['P-1', 'P-3'],
    })
  })

  it('checking every project individually re-ticks All (flag on, empty list)', () => {
    const s1 = toggleProjectInScope({ allProjects: false, projectIds: [] }, 'P-1', ALL_IDS)
    const s2 = toggleProjectInScope(s1, 'P-2', ALL_IDS)
    const s3 = toggleProjectInScope(s2, 'P-3', ALL_IDS)
    expect(s3).toEqual({ allProjects: true, projectIds: [] })
  })

  it('toggling a project off removes it from the explicit list', () => {
    expect(toggleProjectInScope({ allProjects: false, projectIds: ['P-1', 'P-2'] }, 'P-2', ALL_IDS)).toEqual({
      allProjects: false,
      projectIds: ['P-1'],
    })
  })
})

describe('tree navigation (headers + items)', () => {
  const groups = [
    { key: 'snippet', items: [{ id: 'snippet:s1' }] },
    { key: 'personal', items: [{ id: 'personal:skill:a' }, { id: 'personal:skill:b' }] },
  ]

  it('flattenNavRows lists a header per group then its items when expanded', () => {
    const rows = flattenNavRows(groups, new Set())
    expect(rows.map((r) => r.id)).toEqual([
      'group:snippet',
      'snippet:s1',
      'group:personal',
      'personal:skill:a',
      'personal:skill:b',
    ])
  })

  it('flattenNavRows hides items of a collapsed group (header stays)', () => {
    const rows = flattenNavRows(groups, new Set(['snippet']))
    expect(rows.map((r) => r.id)).toEqual([
      'group:snippet',
      'group:personal',
      'personal:skill:a',
      'personal:skill:b',
    ])
  })

  it('navLeft on an item collapses its group and moves to the header', () => {
    const rows = flattenNavRows(groups, new Set())
    expect(navLeft(rows, 'personal:skill:a', new Set())).toEqual({
      type: 'toggle',
      groupKey: 'personal',
      focusId: 'group:personal',
    })
  })

  it('navLeft on an expanded header collapses it (focus stays); collapsed header does nothing', () => {
    const rows = flattenNavRows(groups, new Set())
    expect(navLeft(rows, 'group:personal', new Set())).toEqual({
      type: 'toggle',
      groupKey: 'personal',
      focusId: 'group:personal',
    })
    const collapsedRows = flattenNavRows(groups, new Set(['personal']))
    expect(navLeft(collapsedRows, 'group:personal', new Set(['personal']))).toEqual({ type: 'none' })
  })

  it('navRight on a collapsed header expands it; on an expanded header dives to first item', () => {
    const collapsedRows = flattenNavRows(groups, new Set(['personal']))
    expect(navRight(collapsedRows, 'group:personal', new Set(['personal']))).toEqual({
      type: 'toggle',
      groupKey: 'personal',
      focusId: 'group:personal',
    })
    const rows = flattenNavRows(groups, new Set())
    expect(navRight(rows, 'group:personal', new Set())).toEqual({
      type: 'focus',
      focusId: 'personal:skill:a',
    })
  })

  it('navRight on an item does nothing', () => {
    const rows = flattenNavRows(groups, new Set())
    expect(navRight(rows, 'personal:skill:a', new Set())).toEqual({ type: 'none' })
  })
})
