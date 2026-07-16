import { describe, it, expect } from 'vitest'
import { normalizeSourceTicketUrl, getSourceTicketLink } from './sourceTicket'

describe('normalizeSourceTicketUrl', () => {
  it('returns null for null, undefined, empty, or whitespace-only values', () => {
    expect(normalizeSourceTicketUrl(null)).toBeNull()
    expect(normalizeSourceTicketUrl(undefined)).toBeNull()
    expect(normalizeSourceTicketUrl('')).toBeNull()
    expect(normalizeSourceTicketUrl('   ')).toBeNull()
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeSourceTicketUrl('  https://example.com/1  ')).toBe('https://example.com/1')
  })
})

describe('getSourceTicketLink', () => {
  it('returns null when there is no source ticket value', () => {
    expect(getSourceTicketLink(null)).toBeNull()
    expect(getSourceTicketLink('   ')).toBeNull()
  })

  it('derives an owner/repo#number label for a GitHub issue URL', () => {
    const link = getSourceTicketLink('https://github.com/koenvg/openforge/issues/1294')
    expect(link).not.toBeNull()
    expect(link?.url).toBe('https://github.com/koenvg/openforge/issues/1294')
    expect(link?.clickable).toBe(true)
    expect(link?.label).toBe('koenvg/openforge#1294')
  })

  it('derives an owner/repo#number label for a GitHub pull request URL', () => {
    const link = getSourceTicketLink('https://github.com/koenvg/openforge/pull/42')
    expect(link?.clickable).toBe(true)
    expect(link?.label).toBe('koenvg/openforge#42')
  })

  it('ignores query strings and fragments when labelling GitHub URLs', () => {
    const link = getSourceTicketLink('https://github.com/koenvg/openforge/issues/1294?foo=bar#comment-1')
    expect(link?.label).toBe('koenvg/openforge#1294')
  })

  it('derives the Jira issue key from an Atlassian browse URL', () => {
    const link = getSourceTicketLink('https://acme.atlassian.net/browse/ABC-123')
    expect(link?.clickable).toBe(true)
    expect(link?.label).toBe('ABC-123')
  })

  it('falls back to the host for a generic http(s) URL', () => {
    const link = getSourceTicketLink('https://tickets.example.com/t/5')
    expect(link?.clickable).toBe(true)
    expect(link?.label).toBe('tickets.example.com')
  })

  it('strips a leading www. from the host label', () => {
    const link = getSourceTicketLink('http://www.example.com/path')
    expect(link?.clickable).toBe(true)
    expect(link?.label).toBe('example.com')
  })

  it('treats a bare Jira id as non-clickable plain text', () => {
    const link = getSourceTicketLink('ABC-123')
    expect(link?.clickable).toBe(false)
    expect(link?.label).toBe('ABC-123')
    expect(link?.url).toBe('ABC-123')
  })

  it('treats arbitrary non-URL text as non-clickable plain text', () => {
    const link = getSourceTicketLink('see the ticket in notion')
    expect(link?.clickable).toBe(false)
    expect(link?.label).toBe('see the ticket in notion')
  })

  it('never marks a non-http(s) scheme as clickable', () => {
    for (const value of ['javascript:alert(1)', 'ftp://example.com/file', 'file:///etc/passwd', 'mailto:a@b.com']) {
      const link = getSourceTicketLink(value)
      expect(link?.clickable).toBe(false)
    }
  })
})
