import { describe, expect, it } from 'vitest'
import {
  BUILTIN_DARK_THEME_ID,
  BUILTIN_LIGHT_THEME_ID,
  DARK_THEME,
  LIGHT_THEME,
  THEME_TOKEN_CSS_PROPERTIES,
  THEME_TOKEN_NAMES,
  validateThemeDefinition,
  type ThemeDefinition,
} from './themeContract'

describe('theme contract', () => {
  it('publishes stable built-in identities with explicit appearance', () => {
    expect(LIGHT_THEME).toMatchObject({
      id: BUILTIN_LIGHT_THEME_ID,
      label: 'OpenForge Light',
      appearance: 'light',
    })
    expect(DARK_THEME).toMatchObject({
      id: BUILTIN_DARK_THEME_ID,
      label: 'OpenForge Dark',
      appearance: 'dark',
    })
    expect(BUILTIN_LIGHT_THEME_ID).toBe('openforge-light')
    expect(BUILTIN_DARK_THEME_ID).toBe('openforge-dark')
  })

  it('defines a CSS property for every required semantic token', () => {
    expect(Object.keys(LIGHT_THEME.tokens)).toEqual(THEME_TOKEN_NAMES)
    expect(Object.keys(DARK_THEME.tokens)).toEqual(THEME_TOKEN_NAMES)
    expect(Object.keys(THEME_TOKEN_CSS_PROPERTIES)).toEqual(THEME_TOKEN_NAMES)
    expect(new Set(Object.values(THEME_TOKEN_CSS_PROPERTIES)).size).toBe(THEME_TOKEN_NAMES.length)
    expect(Object.values(THEME_TOKEN_CSS_PROPERTIES).every((property) => property.startsWith('--of-'))).toBe(true)
  })

  it('rejects a definition missing any required semantic token', () => {
    const incomplete = structuredClone(LIGHT_THEME) as unknown as ThemeDefinition
    Reflect.deleteProperty(incomplete.tokens, 'focusRing')

    expect(validateThemeDefinition(incomplete)).toEqual({
      valid: false,
      errors: ['tokens.focusRing is required'],
    })
  })

  it.each([
    [{ ...LIGHT_THEME, id: 'contains spaces' }, 'id must be a stable theme identifier'],
    [{ ...LIGHT_THEME, label: '' }, 'label is required'],
    [{ ...LIGHT_THEME, appearance: 'dim' }, 'appearance must be light or dark'],
    [{ ...LIGHT_THEME, tokens: { ...LIGHT_THEME.tokens, canvas: '' } }, 'tokens.canvas is required'],
  ])('rejects invalid theme metadata and values', (candidate, message) => {
    const result = validateThemeDefinition(candidate)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(message)
  })

  it.each([
    ['canvas', 'not-a-color', 'tokens.canvas must be a valid color'],
    ['borderWidth', 'wide', 'tokens.borderWidth must be a valid length'],
    ['durationFast', 'yesterday', 'tokens.durationFast must be a valid duration'],
    ['easeStandard', 'wiggle', 'tokens.easeStandard must be a valid easing function'],
    ['shadowRaised', 'sparkles', 'tokens.shadowRaised must be a valid shadow'],
  ] as const)('rejects invalid CSS grammar for %s', (token, value, message) => {
    const candidate = {
      ...LIGHT_THEME,
      tokens: { ...LIGHT_THEME.tokens, [token]: value },
    }

    const result = validateThemeDefinition(candidate)
    expect(result.valid).toBe(false)
    expect(result.errors).toContain(message)
  })
})
