import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './sanitize'

describe('sanitizeHtml', () => {
  it('strips script tags', () => {
    const dirty = '<p>Hello</p><script>alert("xss")</script>'
    expect(sanitizeHtml(dirty)).toBe('<p>Hello</p>')
  })

  it('strips event handlers', () => {
    const dirty = '<img src="x" onerror="alert(1)">'
    const result = sanitizeHtml(dirty)
    expect(result).not.toContain('onerror')
    expect(result).toContain('<img src="x">')
  })

  it('strips iframe tags', () => {
    const dirty = '<p>Text</p><iframe src="https://evil.com"></iframe>'
    expect(sanitizeHtml(dirty)).toBe('<p>Text</p>')
  })

  it('strips style tags and attributes', () => {
    const dirty = '<p style="background:url(javascript:alert(1))">Text</p><style>body{display:none}</style>'
    const result = sanitizeHtml(dirty)
    expect(result).not.toContain('style')
    expect(result).toContain('<p>Text</p>')
  })

  it('preserves safe HTML elements', () => {
    const safe = '<h1>Title</h1><p>Paragraph</p><ul><li>Item</li></ul><a href="https://example.com">Link</a>'
    expect(sanitizeHtml(safe)).toBe(safe)
  })

  it('preserves code blocks', () => {
    const safe = '<pre><code>const x = 1;</code></pre>'
    expect(sanitizeHtml(safe)).toBe(safe)
  })

  it('preserves tables', () => {
    const input = '<table><tr><th>Header</th></tr><tr><td>Cell</td></tr></table>'
    const result = sanitizeHtml(input)
    expect(result).toContain('<table>')
    expect(result).toContain('<th>Header</th>')
    expect(result).toContain('<td>Cell</td>')
    expect(result).toContain('</table>')
  })

  it('strips javascript: URLs from anchors', () => {
    const dirty = '<a href="javascript:alert(1)">Click</a>'
    const result = sanitizeHtml(dirty)
    expect(result).not.toContain('javascript:')
  })

  it('handles empty string', () => {
    expect(sanitizeHtml('')).toBe('')
  })
})
