import { describe, expect, it } from 'vitest'
import {
  DARK_THEME,
  LIGHT_THEME,
  THEME_TOKEN_CSS_PROPERTIES,
  THEME_TOKEN_NAMES,
  type ThemeDefinition,
} from './themeContract'
import { createThemeDocumentAdapter } from './themeDocumentAdapter'
import { createThemeRegistry } from './themeRegistry'

describe('theme document adapter', () => {
  it('applies every semantic token and separate identity and appearance attributes', () => {
    const root = document.createElement('html')
    const adapter = createThemeDocumentAdapter(root)

    adapter.apply(LIGHT_THEME)

    for (const token of THEME_TOKEN_NAMES) {
      expect(root.style.getPropertyValue(THEME_TOKEN_CSS_PROPERTIES[token])).toBe(LIGHT_THEME.tokens[token])
    }
    expect(root.dataset.theme).toBe(LIGHT_THEME.id)
    expect(root.dataset.themeAppearance).toBe('light')
    expect(root.style.colorScheme).toBe('light')
  })

  it('updates a mounted document only through registry selection', async () => {
    const root = document.createElement('html')
    const adapter = createThemeDocumentAdapter(root)
    const registry = createThemeRegistry({ applyTheme: adapter.apply })

    adapter.apply(LIGHT_THEME)
    await registry.selectTheme(DARK_THEME.id)

    expect(root.dataset.theme).toBe(DARK_THEME.id)
    expect(root.dataset.themeAppearance).toBe('dark')
    expect(root.style.getPropertyValue('--of-canvas')).toBe(DARK_THEME.tokens.canvas)
    expect(root.style.getPropertyValue('--of-terminal-background')).toBe(DARK_THEME.tokens.terminalBackground)
  })

  it('retains the current complete theme when candidate validation fails', () => {
    const root = document.createElement('html')
    const adapter = createThemeDocumentAdapter(root)
    adapter.apply(DARK_THEME)
    const before = root.outerHTML
    const invalid = structuredClone(LIGHT_THEME) as unknown as ThemeDefinition
    Reflect.deleteProperty(invalid.tokens, 'text')

    expect(() => adapter.apply(invalid)).toThrow('Invalid theme definition: tokens.text is required')
    expect(root.outerHTML).toBe(before)
  })

  it('applies a complete custom definition by its declared identity and appearance', () => {
    const root = document.createElement('html')
    const adapter = createThemeDocumentAdapter(root)
    const customTheme: ThemeDefinition = {
      ...DARK_THEME,
      id: 'midnight-paper',
      label: 'Midnight Paper',
      appearance: 'light',
      tokens: { ...DARK_THEME.tokens, canvas: '#FAF7F0', accent: '#8B3DFF' },
    }

    adapter.apply(customTheme)

    expect(root.dataset.theme).toBe('midnight-paper')
    expect(root.dataset.themeAppearance).toBe('light')
    expect(root.style.colorScheme).toBe('light')
    expect(root.style.getPropertyValue('--of-canvas')).toBe('#FAF7F0')
    expect(root.style.getPropertyValue('--of-accent')).toBe('#8B3DFF')
  })
})
