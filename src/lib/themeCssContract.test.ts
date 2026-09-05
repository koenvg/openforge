import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_DARK_THEME_ID, BUILTIN_LIGHT_THEME_ID } from './themeContract'

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')
const themeAdapterCss = readFileSync(resolve(process.cwd(), 'src/styles/theme-adapter.css'), 'utf8')

const DAISY_TOKEN_ADAPTER = {
  '--color-base-100': '--of-surface',
  '--color-base-200': '--of-surface-subtle',
  '--color-base-300': '--of-border',
  '--color-base-content': '--of-text',
  '--color-primary': '--of-accent',
  '--color-primary-content': '--of-on-accent',
  '--color-secondary': '--of-control',
  '--color-secondary-content': '--of-control-text',
  '--color-accent': '--of-accent',
  '--color-accent-content': '--of-on-accent',
  '--color-neutral': '--of-text',
  '--color-neutral-content': '--of-text-inverse',
  '--color-info': '--of-info',
  '--color-info-content': '--of-on-info',
  '--color-success': '--of-success',
  '--color-success-content': '--of-on-success',
  '--color-warning': '--of-warning',
  '--color-warning-content': '--of-on-warning',
  '--color-error': '--of-danger',
  '--color-error-content': '--of-on-danger',
  '--radius-selector': '--of-radius-round',
  '--radius-field': '--of-radius-control',
  '--radius-box': '--of-radius-container',
  '--border': '--of-border-width',
} as const

function daisyThemeBlock(id: string): string {
  const marker = `name: "${id}";`
  const markerIndex = themeAdapterCss.indexOf(marker)
  expect(markerIndex).toBeGreaterThan(-1)
  const start = themeAdapterCss.lastIndexOf('@plugin "daisyui/theme"', markerIndex)
  const end = themeAdapterCss.indexOf('\n}', markerIndex)
  return themeAdapterCss.slice(start, end)
}

describe('daisyUI theme compatibility contract', () => {
  it('maps root compatibility values for arbitrary contributed theme IDs', () => {
    const root = themeAdapterCss.match(/:root\s*\{([^}]+)\}/)?.[1] ?? ''
    for (const [daisyToken, semanticToken] of Object.entries(DAISY_TOKEN_ADAPTER)) {
      expect(root).toContain(`${daisyToken}: var(${semanticToken});`)
    }
    expect(root).toContain('--size-field: calc(var(--of-control-height) / 10);')
    expect(root).toContain('--size-selector: calc(var(--of-control-height-compact) / 8);')
  })

  it('keeps theme adapters separate from unrelated global presentation rules', () => {
    expect(appCss).toContain('@import "./styles/theme-adapter.css";')
    expect(appCss).not.toContain('@plugin "daisyui/theme"')
  })

  it('keeps token-driven focus and reduced-motion rules canonical in the imported adapter', () => {
    expect(themeAdapterCss).toContain('--font-sans: var(--of-font-sans);')
    expect(themeAdapterCss).toContain('--font-mono: var(--of-font-mono);')
    expect(themeAdapterCss).toContain('outline: var(--of-focus-width) solid var(--of-focus-ring);')
    expect(themeAdapterCss).toContain('outline-offset: var(--of-space1);')
    expect(themeAdapterCss).toContain('@media (prefers-reduced-motion: reduce)')
    expect(themeAdapterCss).toContain('transition-duration: 0.01ms !important;')
    expect(themeAdapterCss).toContain('animation-duration: 0.01ms !important;')
    expect(appCss).not.toMatch(/:where\([^)]*(?:button|input|select|textarea)[^)]*\):focus-visible/)
    expect(appCss).not.toContain('@media (prefers-reduced-motion: reduce)')
  })

  it.each([BUILTIN_LIGHT_THEME_ID, BUILTIN_DARK_THEME_ID])(
    'maps %s daisyUI geometry to the documented control heights',
    (themeId) => {
      const block = daisyThemeBlock(themeId)
      expect(block).toContain('--size-field: calc(var(--of-control-height) / 10);')
      expect(block).toContain('--size-selector: calc(var(--of-control-height-compact) / 8);')
      expect(themeAdapterCss).toContain('--size: var(--of-control-height-compact);')
    },
  )

  it.each([BUILTIN_LIGHT_THEME_ID, BUILTIN_DARK_THEME_ID])(
    'maps %s daisyUI values to OpenForge semantic tokens without independent colors',
    (themeId) => {
      const block = daisyThemeBlock(themeId)
      for (const [daisyToken, semanticToken] of Object.entries(DAISY_TOKEN_ADAPTER)) {
        expect(block).toContain(`${daisyToken}: var(${semanticToken});`)
      }
      expect(block).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    },
  )
})
