import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { validateManifest, validateBaselines, identity, captureAppearance } from './manifest.mjs'

const entry = { catalog: 'pages', story: 'pages-focus-board--populated', theme: 'openforge-light', viewport: { width: 1280, height: 800 }, ready: '[aria-label="Task list"]', expectedErrors: [] }
const indexes = { pages: { entries: { [entry.story]: { type: 'story' } } } }
describe('visual manifest contract', () => {
  it('keeps the checked-in capture matrix free of duplicate identities after merges', () => {
    const entries = JSON.parse(readFileSync(new URL('../../storybook/visual-manifest.json', import.meta.url), 'utf8'))
    const names = entries.map(identity)
    expect(names.filter((name, index) => names.indexOf(name) !== index)).toEqual([])
  })
  it('keeps Workshop themes out of canonical screenshot captures', () => {
    const entries = JSON.parse(readFileSync(new URL('../../storybook/visual-manifest.json', import.meta.url), 'utf8'))
    expect(entries.every(entry => !entry.theme.startsWith('workshop-'))).toBe(true)
  })
  it('accepts the measured two-level Markdown allowance', () => {
    const measured = { ...entry, tolerance: { maxPixels: 10, maxChannelDelta: 2, reason: 'Measured Markdown code-block border variation' } }
    expect(validateManifest([measured], indexes)).toEqual([measured])
  })
  it('accepts the measured 36-pixel allowance with a one-level channel bound', () => {
    const measured = { ...entry, tolerance: { maxPixels: 36, maxChannelDelta: 1, reason: 'Measured repeated pinned Linux antialiasing variation' } }
    expect(validateManifest([measured], indexes)).toEqual([measured])
  })
  it.each([
    ['openforge-light', 'light'], ['openforge-dark', 'dark'],
  ])('accepts %s for deterministic capture', (theme, appearance) => {
    expect(validateManifest([{ ...entry, theme }], indexes)).toEqual([{ ...entry, theme }])
    expect(captureAppearance(theme)).toBe(appearance)
  })
  it('rejects unknown capture appearance instead of inferring from a suffix', () => {
    expect(() => captureAppearance('unknown-dark')).toThrow('invalid theme')
  })
  it('resolves stable identities', () => {
    expect(validateManifest([entry], indexes)).toEqual([entry])
    expect(identity(entry)).toBe('pages/pages-focus-board--populated--openforge-light--1280x800')
  })
  it('accepts a documented two-level rasterization allowance within the pixel cap', () => {
    const bounded = { ...entry, tolerance: { maxPixels: 14, maxChannelDelta: 2, reason: 'Six pinned-container captures differ only at antialiased code-block corners.' } }
    expect(validateManifest([bounded], indexes)).toEqual([bounded])
  })
  it.each([1, 2, 3])('accepts measured two-pixel noise at channel delta %i', (maxChannelDelta) => {
    const measured = { ...entry, tolerance: { maxPixels: 2, maxChannelDelta, reason: 'Measured focused-input corner rasterization' } }
    expect(validateManifest([measured], indexes)).toEqual([measured])
  })
  it.each([[3, 3], [2, 4], [2, 1.5], [2, 0], [0, 3]])('rejects a broader or invalid noise budget %i/%i', (maxPixels, maxChannelDelta) => {
    expect(() => validateManifest([{ ...entry, tolerance: { maxPixels, maxChannelDelta, reason: 'Invalid budget' } }], indexes)).toThrow(/tolerance/)
  })
  it.each([
    [[{ ...entry, catalog: '../escape' }], /catalog/],
    [[{ ...entry, theme: 'unknown' }], /theme/],
    [[{ ...entry, theme: 'workshop-light' }], /theme/],
    [[{ ...entry, viewport: { width: 0, height: 800 } }], /viewport/],
    [[{ ...entry, ready: '' }], /ready/],
    [[{ ...entry, typo: true }], /unknown/],
    [[{ ...entry, tolerance: { maxPixels: 37, maxChannelDelta: 1, reason: 'too broad' } }], /tolerance/],
    [[{ ...entry, tolerance: { maxPixels: 20, maxChannelDelta: 3, reason: 'too broad' } }], /tolerance/],
    [[{ ...entry, tolerance: { maxPixels: 20, maxChannelDelta: 1.5, reason: 'fractional' } }], /tolerance/],
    [[{ ...entry, tolerance: { maxPixels: 20, maxChannelDelta: 1, reason: '' } }], /tolerance/],
    [[entry, entry], /duplicate/],
    [[{ ...entry, story: 'missing' }], /missing story/],
  ])('rejects invalid entries', (entries, diagnostic) => {
    expect(() => validateManifest(entries, indexes)).toThrow(diagnostic)
  })
  it.each([1280, 900])('allows measured raster noise only in light settings captures at width %i', width => {
    const settings = { ...entry, story: 'pages-global-settings--plugins', viewport: { width, height: 900 }, tolerance: { maxPixels: 40, maxChannelDelta: 3, reason: 'Measured rounded-border raster noise' } }
    const settingsIndexes = { pages: { entries: { [settings.story]: { type: 'story' } } } }
    expect(validateManifest([settings], settingsIndexes)).toEqual([settings])
    for (const override of [
      { theme: 'openforge-dark' },
      { viewport: { width: 480, height: 900 } },
      { catalog: 'components' },
      { story: entry.story },
      { tolerance: { ...settings.tolerance, maxPixels: 41 } },
      { tolerance: { ...settings.tolerance, maxChannelDelta: 4 } },
      { tolerance: { ...settings.tolerance, maxChannelDelta: 1.5 } },
    ]) expect(() => validateManifest([{ ...settings, ...override }], settingsIndexes)).toThrow(/tolerance/)
  })
  it('rejects missing, obsolete, and unexpected files without deleting them', () => {
    const name = identity(entry) + '.png'
    expect(() => validateBaselines([entry], [], 'check')).toThrow(/missing baseline/)
    expect(() => validateBaselines([entry], [name, 'pages/old.png'], 'check')).toThrow(/obsolete/)
    expect(() => validateBaselines([entry], [name, 'stray.txt'], 'update')).toThrow(/unexpected/)
    expect(validateBaselines([entry], [name, 'pages/old.png'], 'update')).toEqual(['pages/old.png'])
    expect(validateBaselines([entry], [name], 'check')).toEqual([])
  })
})
