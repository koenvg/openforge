import { describe, expect, it } from 'vitest'
import { parseProjectKeys, resolveJiraKey, type JiraKeySource } from './jiraKey'

function source(overrides: Partial<JiraKeySource> = {}): JiraKeySource {
  return { head_ref: 'main', title: 'Some change', body: null, ...overrides }
}

describe('parseProjectKeys', () => {
  it('splits, trims, and uppercases a comma-separated list', () => {
    expect(parseProjectKeys(' aviv , KVG,  kvg2 ')).toEqual(['AVIV', 'KVG', 'KVG2'])
  })

  it('treats blank and missing input as no configured keys', () => {
    expect(parseProjectKeys('')).toEqual([])
    expect(parseProjectKeys('  ,  ,')).toEqual([])
    expect(parseProjectKeys(null)).toEqual([])
    expect(parseProjectKeys(undefined)).toEqual([])
  })
})

describe('resolveJiraKey', () => {
  it('prefers a reviewer override over anything detected', () => {
    const pr = source({ head_ref: 'openforge/AVIV-304', title: 'AVIV-999 something' })
    expect(resolveJiraKey(pr, [], 'KVG-1')).toBe('KVG-1')
  })

  it('normalises an override that was typed loosely', () => {
    expect(resolveJiraKey(source(), [], '  aviv-304 ')).toBe('AVIV-304')
  })

  it('ignores a blank override and falls through to detection', () => {
    const pr = source({ head_ref: 'openforge/AVIV-304' })
    expect(resolveJiraKey(pr, [], '   ')).toBe('AVIV-304')
  })

  it('detects the key in the branch name', () => {
    expect(resolveJiraKey(source({ head_ref: 'openforge/AVIV-304' }), [])).toBe('AVIV-304')
  })

  it('prefers the branch over the title when both carry a key', () => {
    const pr = source({ head_ref: 'openforge/AVIV-304', title: 'KVG-99 unrelated mention' })
    expect(resolveJiraKey(pr, [])).toBe('AVIV-304')
  })

  it('falls back to the title when the branch has no key', () => {
    const pr = source({ head_ref: 'fix-the-thing', title: 'AVIV-304: add gap analysis' })
    expect(resolveJiraKey(pr, [])).toBe('AVIV-304')
  })

  it('falls back to the body when neither branch nor title has one', () => {
    const pr = source({ head_ref: 'fix-the-thing', body: 'Implements AVIV-304 as discussed.' })
    expect(resolveJiraKey(pr, [])).toBe('AVIV-304')
  })

  it('returns null when nothing looks like a ticket', () => {
    expect(resolveJiraKey(source({ head_ref: 'chore/bump-deps' }), [])).toBeNull()
  })

  it('does not mistake UTF-8 in a title for a ticket key', () => {
    const pr = source({ head_ref: 'fix-encoding', title: 'Fix UTF-8 handling in the parser' })
    expect(resolveJiraKey(pr, [])).toBeNull()
  })

  it('does not mistake ISO-8601 or HTTP-2 for ticket keys', () => {
    expect(resolveJiraKey(source({ title: 'Parse ISO-8601 dates' }), [])).toBeNull()
    expect(resolveJiraKey(source({ title: 'Support HTTP-2' }), [])).toBeNull()
  })

  it('only matches configured project keys when they are set', () => {
    const pr = source({ head_ref: 'openforge/KVG-3501', title: 'AVIV-304 mentioned here' })
    expect(resolveJiraKey(pr, ['AVIV'])).toBe('AVIV-304')
  })

  it('returns null when a key is present but belongs to another project', () => {
    const pr = source({ head_ref: 'openforge/KVG-3501' })
    expect(resolveJiraKey(pr, ['AVIV'])).toBeNull()
  })

  it('accepts a lowercase branch key once the project key vouches for it', () => {
    // Branch names are frequently lowercased by tooling. Matching lowercase is
    // only safe when we know which prefixes are real projects.
    expect(resolveJiraKey(source({ head_ref: 'feature/aviv-304' }), ['AVIV'])).toBe('AVIV-304')
  })

  it('rejects a lowercase key when no project keys are configured', () => {
    expect(resolveJiraKey(source({ head_ref: 'feature/aviv-304' }), [])).toBeNull()
  })

  it('tolerates a null body', () => {
    expect(resolveJiraKey(source({ body: null }), [])).toBeNull()
  })
})
