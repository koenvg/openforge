import { describe, expect, it } from 'vitest'
import { DARK_THEME, LIGHT_THEME, type ThemeDefinition, type ThemeTokenName } from './themeContract'

type ContrastPair = readonly [ThemeTokenName, ThemeTokenName, number]

const CONTRAST_PAIRS: readonly ContrastPair[] = [
  ['text', 'canvas', 4.5],
  ['textSecondary', 'surface', 4.5],
  ['controlText', 'control', 4.5],
  ['focusRing', 'control', 3],
  ['onAccent', 'accent', 4.5],
  ['success', 'surface', 4.5],
  ['warning', 'surface', 4.5],
  ['danger', 'surface', 4.5],
]

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)
  if (!match) throw new Error(`Expected an opaque six-digit color, received ${hex}`)
  const channels = match.slice(1).map((channel) => Number.parseInt(channel, 16) / 255)
  const [red, green, blue] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ))
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

function contrastRatio(first: string, second: string): number {
  const brightest = Math.max(relativeLuminance(first), relativeLuminance(second))
  const darkest = Math.min(relativeLuminance(first), relativeLuminance(second))
  return (brightest + 0.05) / (darkest + 0.05)
}

const builtins: readonly [string, ThemeDefinition][] = [
  ['light', LIGHT_THEME],
  ['dark', DARK_THEME],
]

describe.each(builtins)('angular %s theme', (_name, theme) => {
  it.each(CONTRAST_PAIRS)('%s remains visible against %s', (foreground, background, minimum) => {
    expect(contrastRatio(theme.tokens[foreground], theme.tokens[background])).toBeGreaterThanOrEqual(minimum)
  })

  it('uses compact angular geometry and technical typography', () => {
    expect(theme.tokens).toMatchObject({
      borderWidth: '1px',
      focusWidth: '2px',
      radiusControl: '3px',
      radiusContainer: '2px',
      radiusOverlay: '4px',
      controlHeightCompact: '28px',
      controlHeight: '36px',
      fontSans: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
      fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
    })
  })
})

describe('angular built-in palette', () => {
  it('matches the approved website-aligned light reference', () => {
    expect(LIGHT_THEME.tokens).toMatchObject({
      canvas: '#FBFBFA',
      surface: '#FFFFFF',
      text: '#111318',
      border: '#E1E3E6',
      accent: '#2947FF',
      shadowSurface: '0 1px 2px rgb(17 19 24 / 6%)',
    })
  })

  it('uses the approved independent dark reference', () => {
    expect(DARK_THEME.tokens).toMatchObject({
      canvas: '#0D0F14',
      surface: '#14171D',
      text: '#F3F5F7',
      border: '#2D333D',
      accent: '#8494FF',
      shadowSurface: 'none',
    })
  })
})
