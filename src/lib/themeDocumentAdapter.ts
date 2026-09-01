import {
  THEME_TOKEN_CSS_PROPERTIES,
  THEME_TOKEN_NAMES,
  validateThemeDefinition,
  type ThemeDefinition,
} from './themeContract'

export interface ThemeDocumentAdapter {
  apply(theme: ThemeDefinition): void
}

export function createThemeDocumentAdapter(root: HTMLElement): ThemeDocumentAdapter {
  function apply(theme: ThemeDefinition): void {
    const validation = validateThemeDefinition(theme)
    if (!validation.valid) {
      throw new Error(`Invalid theme definition: ${validation.errors.join('; ')}`)
    }

    const nextStyle = root.ownerDocument.createElement('div').style
    nextStyle.cssText = root.style.cssText
    for (const token of THEME_TOKEN_NAMES) {
      nextStyle.setProperty(THEME_TOKEN_CSS_PROPERTIES[token], theme.tokens[token])
    }
    nextStyle.colorScheme = theme.appearance

    root.setAttribute('style', nextStyle.cssText)
    root.dataset.theme = theme.id
    root.dataset.themeAppearance = theme.appearance
  }

  return Object.freeze({ apply })
}
