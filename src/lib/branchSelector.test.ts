import { describe, it, expect } from 'vitest'
import { dedupeBranchesForSelector, matchExistingBranchSeed } from './branchSelector'
import type { GitBranchInfo } from './types'

function branch(name: string, is_remote: boolean, is_current = false): GitBranchInfo {
  return { name, is_remote, is_current }
}

describe('dedupeBranchesForSelector', () => {
  it('keeps a local-only branch with its bare name and a local location', () => {
    const result = dedupeBranchesForSelector([branch('foo', false)])
    expect(result).toEqual([{ value: 'foo', label: 'foo', location: 'local' }])
  })

  it('keeps a remote-only branch as origin/<name> with a remote location', () => {
    const result = dedupeBranchesForSelector([branch('origin/foo', true)])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('origin/foo')
    expect(result[0].location).toBe('remote')
  })

  it('collapses a branch that exists both locally and on origin into one entry storing origin/<name> with a both location', () => {
    const result = dedupeBranchesForSelector([
      branch('foo', false),
      branch('origin/foo', true),
    ])
    expect(result).toHaveLength(1)
    // Linchpin: the both-case must store origin/foo so the backend fetches,
    // aligns, and detects divergence rather than silently taking the local path.
    expect(result[0].value).toBe('origin/foo')
    // The label must distinguish "both" from "remote only" so the user can tell
    // at a glance whether they already have the branch locally.
    expect(result[0].location).toBe('both')
    expect(result[0].label).toBe('foo')
  })

  it('collapses regardless of listing order (remote before local)', () => {
    const result = dedupeBranchesForSelector([
      branch('origin/foo', true),
      branch('foo', false),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('origin/foo')
    expect(result[0].location).toBe('both')
  })

  it('collapses local + origin but keeps a non-origin remote of the same name distinct as remote', () => {
    const result = dedupeBranchesForSelector([
      branch('foo', false),
      branch('origin/foo', true),
      branch('upstream/foo', true),
    ])
    // local+origin collapse to origin/foo (both); upstream/foo stays its own remote entry.
    const byValue = new Map(result.map((entry) => [entry.value, entry]))
    expect([...byValue.keys()].sort()).toEqual(['origin/foo', 'upstream/foo'])
    expect(byValue.get('origin/foo')?.location).toBe('both')
    expect(byValue.get('upstream/foo')?.location).toBe('remote')
  })

  it('preserves slashed local branch names without treating the slash as a remote boundary', () => {
    const result = dedupeBranchesForSelector([branch('feature/foo', false)])
    expect(result).toEqual([{ value: 'feature/foo', label: 'feature/foo', location: 'local' }])
  })

  it('collapses local feature/foo with its origin/feature/foo remote as both', () => {
    const result = dedupeBranchesForSelector([
      branch('feature/foo', false),
      branch('origin/feature/foo', true),
    ])
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe('origin/feature/foo')
    expect(result[0].location).toBe('both')
    expect(result[0].label).toBe('feature/foo')
  })
})

describe('matchExistingBranchSeed', () => {
  const options = dedupeBranchesForSelector([
    branch('main', false, true),
    branch('origin/main', true),
    branch('fix/auth', false),
    branch('origin/fix/auth', true),
    branch('local-only', false),
  ])

  it('returns null for a blank seed', () => {
    expect(matchExistingBranchSeed('  ', options)).toBeNull()
  })

  it('keeps an exact stored value, including origin/<name>', () => {
    expect(matchExistingBranchSeed('origin/fix/auth', options)).toBe('origin/fix/auth')
  })

  it('prefers origin/<name> when the seed is a pull-request head ref that exists on origin', () => {
    expect(matchExistingBranchSeed('fix/auth', options)).toBe('origin/fix/auth')
  })

  it('uses the local name when the seed has no origin counterpart', () => {
    expect(matchExistingBranchSeed('local-only', options)).toBe('local-only')
  })

  it('returns null when no selector option matches the seed', () => {
    expect(matchExistingBranchSeed('missing-branch', options)).toBeNull()
  })
})
