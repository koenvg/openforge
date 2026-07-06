import { describe, it, expect } from 'vitest'
import { deriveRepoNameFromUrl } from './deriveRepoNameFromUrl'

describe('deriveRepoNameFromUrl', () => {
  it('derives from a full HTTPS url', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets')).toBe('widgets')
  })

  it('strips a trailing .git', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets.git')).toBe('widgets')
  })

  it('derives from an SSH url', () => {
    expect(deriveRepoNameFromUrl('git@github.com:acme/widgets.git')).toBe('widgets')
  })

  it('derives from owner/repo shorthand', () => {
    expect(deriveRepoNameFromUrl('acme/widgets')).toBe('widgets')
  })

  it('ignores a trailing path segment', () => {
    expect(deriveRepoNameFromUrl('https://github.com/acme/widgets/tree/main')).toBe('widgets')
  })

  it('returns an empty string when no repo can be derived', () => {
    expect(deriveRepoNameFromUrl('acme')).toBe('')
    expect(deriveRepoNameFromUrl('')).toBe('')
  })
})
