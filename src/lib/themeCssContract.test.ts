import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { BUILTIN_DARK_THEME_ID, BUILTIN_LIGHT_THEME_ID } from './themeContract'

const appCss = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf8')

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
  const markerIndex = appCss.indexOf(marker)
  expect(markerIndex).toBeGreaterThan(-1)
  const start = appCss.lastIndexOf('@plugin "daisyui/theme"', markerIndex)
  const end = appCss.indexOf('\n}', markerIndex)
  return appCss.slice(start, end)
}

describe('daisyUI theme compatibility contract', () => {
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
