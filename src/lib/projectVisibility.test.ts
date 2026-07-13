import { describe, it, expect } from 'vitest'
import {
  parseHiddenProjectIds,
  serializeHiddenProjectIds,
  partitionProjectsByHidden,
  withProjectHidden,
  moveVisibleProject,
} from './projectVisibility'
import type { Project } from './types'

function project(id: string): Project {
  return { id, name: id, path: `/repos/${id}`, created_at: 0, updated_at: 0 }
}

describe('parseHiddenProjectIds', () => {
  it('returns an empty set for null', () => {
    expect(parseHiddenProjectIds(null)).toEqual(new Set())
  })

  it('returns an empty set for invalid JSON', () => {
    expect(parseHiddenProjectIds('not json')).toEqual(new Set())
  })

  it('returns an empty set when the JSON is not an array', () => {
    expect(parseHiddenProjectIds('{"a":1}')).toEqual(new Set())
  })

  it('parses an array of ids into a set', () => {
    expect(parseHiddenProjectIds('["a","b","a"]')).toEqual(new Set(['a', 'b']))
  })
})

describe('serializeHiddenProjectIds', () => {
  it('round-trips through parse', () => {
    const ids = new Set(['x', 'y', 'z'])
    expect(parseHiddenProjectIds(serializeHiddenProjectIds(ids))).toEqual(ids)
  })

  it('serializes to a JSON array', () => {
    expect(JSON.parse(serializeHiddenProjectIds(new Set(['a', 'b'])))).toEqual(['a', 'b'])
  })
})

describe('partitionProjectsByHidden', () => {
  it('splits projects into visible and hidden, preserving order in each', () => {
    const projects = [project('a'), project('b'), project('c'), project('d')]
    const { visible, hidden } = partitionProjectsByHidden(projects, new Set(['b', 'd']))
    expect(visible.map((p) => p.id)).toEqual(['a', 'c'])
    expect(hidden.map((p) => p.id)).toEqual(['b', 'd'])
  })

  it('ignores hidden ids that are not present in projects', () => {
    const projects = [project('a'), project('b')]
    const { visible, hidden } = partitionProjectsByHidden(projects, new Set(['zzz']))
    expect(visible.map((p) => p.id)).toEqual(['a', 'b'])
    expect(hidden).toEqual([])
  })

  it('treats an empty hidden set as everything visible', () => {
    const projects = [project('a'), project('b')]
    const { visible, hidden } = partitionProjectsByHidden(projects, new Set())
    expect(visible.map((p) => p.id)).toEqual(['a', 'b'])
    expect(hidden).toEqual([])
  })
})

describe('withProjectHidden', () => {
  it('adds an id when hiding, without mutating the input', () => {
    const input = new Set(['a'])
    const next = withProjectHidden(input, 'b', true)
    expect(next).toEqual(new Set(['a', 'b']))
    expect(input).toEqual(new Set(['a']))
  })

  it('removes an id when unhiding, without mutating the input', () => {
    const input = new Set(['a', 'b'])
    const next = withProjectHidden(input, 'b', false)
    expect(next).toEqual(new Set(['a']))
    expect(input).toEqual(new Set(['a', 'b']))
  })

  it('is a no-op when hiding an already-hidden id', () => {
    expect(withProjectHidden(new Set(['a']), 'a', true)).toEqual(new Set(['a']))
  })

  it('is a no-op when unhiding an id that is not hidden', () => {
    expect(withProjectHidden(new Set(['a']), 'b', false)).toEqual(new Set(['a']))
  })
})

describe('moveVisibleProject', () => {
  it('swaps a visible project down with its next visible neighbour, skipping hidden slots', () => {
    // full order: a(v) b(hidden) c(v) d(v); visible list is [a, c, d]
    const projects = [project('a'), project('b'), project('c'), project('d')]
    const hidden = new Set(['b'])
    const next = moveVisibleProject(projects, hidden, 0, 'down')
    // a (visible idx 0) swaps with c (visible idx 1); b stays put at slot 1
    expect(next.map((p) => p.id)).toEqual(['c', 'b', 'a', 'd'])
  })

  it('swaps a visible project up with its previous visible neighbour', () => {
    const projects = [project('a'), project('b'), project('c'), project('d')]
    const hidden = new Set(['b'])
    const next = moveVisibleProject(projects, hidden, 2, 'up')
    // d (visible idx 2) swaps with c (visible idx 1)
    expect(next.map((p) => p.id)).toEqual(['a', 'b', 'd', 'c'])
  })

  it('returns an unchanged order when moving the first visible project up', () => {
    const projects = [project('a'), project('b')]
    const next = moveVisibleProject(projects, new Set(), 0, 'up')
    expect(next.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('returns an unchanged order when moving the last visible project down', () => {
    const projects = [project('a'), project('b')]
    const next = moveVisibleProject(projects, new Set(), 1, 'down')
    expect(next.map((p) => p.id)).toEqual(['a', 'b'])
  })

  it('does not mutate the input array', () => {
    const projects = [project('a'), project('b')]
    moveVisibleProject(projects, new Set(), 0, 'down')
    expect(projects.map((p) => p.id)).toEqual(['a', 'b'])
  })
})
