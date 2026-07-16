import { describe, expect, it } from 'vitest'

import { sanitizePluginIcon } from '@openforge-app/plugin-sdk/pluginIcons'

describe('plugin icon contract', () => {
  it('preserves named icons for backward-compatible host lookup and fallback', () => {
    expect(sanitizePluginIcon('kanban')).toBe('kanban')
    expect(sanitizePluginIcon('not-registered-yet')).toBe('not-registered-yet')
  })

  it('accepts and sanitizes a custom SVG icon while preserving safe geometry and theme color', () => {
    const icon = sanitizePluginIcon({
      type: 'svg',
      svg: '<svg viewBox="0 0 24 24" width="48" height="48" style="display:block" aria-label="Plugin-owned label" focusable="true" onclick="alert(1)"><title>Plugin-owned label</title><script>alert(1)</script><path d="M12 2 22 22H2Z" fill="currentColor" /></svg>',
    })

    expect(icon).toMatchObject({ type: 'svg' })
    expect(typeof icon === 'object' ? icon.svg : '').toContain('viewBox="0 0 24 24"')
    expect(typeof icon === 'object' ? icon.svg : '').toContain('fill="currentColor"')
    expect(typeof icon === 'object' ? icon.svg : '').toContain('<path')
    expect(typeof icon === 'object' ? icon.svg : '').not.toMatch(/aria-label|focusable|onclick|script|style|title|width="48"|height="48"/i)
  })

  it('rejects oversized custom SVG markup before rendering', () => {
    expect(() => sanitizePluginIcon({
      type: 'svg',
      svg: `<svg viewBox="0 0 24 24"><path d="${'M0 0 '.repeat(2_000)}" /></svg>`,
    })).toThrow(/10,000 characters/i)
  })

  it('removes external resources and URL-based paint from custom SVG icons', () => {
    const icon = sanitizePluginIcon({
      type: 'svg',
      svg: '<svg viewBox="0 0 24 24"><image href="https://example.com/icon.png"/><use href="https://example.com/sprite.svg#icon"/><path d="M0 0h24v24H0z" fill="url(https://example.com/paint.svg#brand)" stroke="currentColor"/></svg>',
    })
    const svg = typeof icon === 'object' ? icon.svg : ''

    expect(svg).not.toMatch(/image|use|href|url\(/i)
    expect(svg).toContain('<path')
    expect(svg).toContain('stroke="currentColor"')
  })

  it.each([
    ['a viewBox', '<svg><path d="M0 0h1v1z"/></svg>', /viewBox/i],
    ['a single root', '<svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg><svg viewBox="0 0 24 24"><path d="M0 0h1v1z"/></svg>', /one <svg> root/i],
    ['visible geometry', '<svg viewBox="0 0 24 24"></svg>', /visible geometry/i],
  ])('rejects custom SVG icons without %s', (_label, svg, error) => {
    expect(() => sanitizePluginIcon({ type: 'svg', svg })).toThrow(error)
  })
})
