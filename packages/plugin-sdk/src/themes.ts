export type ThemeAppearance = 'light' | 'dark'

export const THEME_TOKEN_NAMES = [
  'canvas', 'surface', 'surfaceSubtle', 'surfaceRaised', 'surfaceTint', 'scrim',
  'text', 'textSecondary', 'textMuted', 'textInverse', 'link', 'icon', 'iconMuted',
  'border', 'borderStrong', 'borderInteractive', 'focusRing', 'selection',
  'accent', 'accentHover', 'accentPressed', 'onAccent', 'accentSubtle', 'onAccentSubtle',
  'info', 'onInfo', 'infoSubtle', 'success', 'onSuccess', 'successSubtle',
  'warning', 'onWarning', 'warningSubtle', 'danger', 'onDanger', 'dangerSubtle',
  'control', 'controlHover', 'controlPressed', 'controlDisabled', 'controlText',
  'controlTextDisabled', 'field', 'fieldHover', 'fieldInvalid',
  'statusNeutral', 'statusNeutralSubtle', 'onStatusNeutral',
  'statusRunning', 'statusRunningSubtle', 'onStatusRunning',
  'statusWaiting', 'statusWaitingSubtle', 'onStatusWaiting',
  'statusSuccess', 'statusSuccessSubtle', 'onStatusSuccess',
  'statusWarning', 'statusWarningSubtle', 'onStatusWarning',
  'statusDanger', 'statusDangerSubtle', 'onStatusDanger',
  'codeCanvas', 'codeText', 'codeMuted', 'codeBorder',
  'diffAdded', 'diffAddedSubtle', 'diffRemoved', 'diffRemovedSubtle',
  'diffChanged', 'diffChangedSubtle',
  'terminalBackground', 'terminalForeground', 'terminalCursor', 'terminalCursorAccent',
  'terminalSelectionBackground', 'terminalSelectionForeground',
  'terminalBlack', 'terminalRed', 'terminalGreen', 'terminalYellow', 'terminalBlue',
  'terminalMagenta', 'terminalCyan', 'terminalWhite', 'terminalBrightBlack',
  'terminalBrightRed', 'terminalBrightGreen', 'terminalBrightYellow', 'terminalBrightBlue',
  'terminalBrightMagenta', 'terminalBrightCyan', 'terminalBrightWhite',
  'borderWidth', 'focusWidth', 'radiusControl', 'radiusContainer', 'radiusOverlay',
  'radiusShell', 'radiusRound', 'controlHeightCompact', 'controlHeight', 'controlHeightTouch',
  'space1', 'space2', 'space3', 'space4', 'space5', 'space6', 'space7', 'space8', 'space9',
  'fontSans', 'fontMono', 'textXs', 'textSm', 'textMd', 'textLg', 'textXl',
  'lineHeightXs', 'lineHeightSm', 'lineHeightMd', 'lineHeightLg', 'lineHeightXl',
  'weightRegular', 'weightMedium', 'weightSemibold',
  'shadowSurface', 'shadowRaised', 'shadowOverlay',
  'durationPress', 'durationFast', 'durationStandard', 'durationDeliberate',
  'easeStandard', 'easeEnter', 'easeExit',
] as const

export type ThemeTokenName = typeof THEME_TOKEN_NAMES[number]
export type ThemeTokens = Readonly<Record<ThemeTokenName, string>>

function cssPropertyForToken(token: ThemeTokenName): `--of-${string}` {
  return `--of-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export const THEME_TOKEN_CSS_PROPERTIES = Object.freeze(Object.fromEntries(
  THEME_TOKEN_NAMES.map((token) => [token, cssPropertyForToken(token)]),
)) as Readonly<Record<ThemeTokenName, `--of-${string}`>>

export interface PluginThemeDefinition {
  readonly id: string
  readonly label: string
  readonly appearance: ThemeAppearance
  readonly tokens: ThemeTokens
  /** Package-relative .css artifacts, loaded only for the selected theme. Not frontendStyles. */
  readonly stylesheets?: readonly string[]
}

export type ThemeDefinition = PluginThemeDefinition

export type ThemeValidationResult =
  | { readonly valid: true; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly string[] }

const STABLE_THEME_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/
const COLOR_TOKENS = new Set<ThemeTokenName>(
  THEME_TOKEN_NAMES.slice(0, THEME_TOKEN_NAMES.indexOf('terminalBrightWhite') + 1),
)
const LENGTH_TOKENS = new Set<ThemeTokenName>([
  'borderWidth', 'focusWidth', 'radiusControl', 'radiusContainer', 'radiusOverlay',
  'radiusShell', 'radiusRound', 'controlHeightCompact', 'controlHeight', 'controlHeightTouch',
  'space1', 'space2', 'space3', 'space4', 'space5', 'space6', 'space7', 'space8', 'space9',
  'textXs', 'textSm', 'textMd', 'textLg', 'textXl',
])
const LINE_HEIGHT_TOKENS = new Set<ThemeTokenName>([
  'lineHeightXs', 'lineHeightSm', 'lineHeightMd', 'lineHeightLg', 'lineHeightXl',
])
const WEIGHT_TOKENS = new Set<ThemeTokenName>([
  'weightRegular', 'weightMedium', 'weightSemibold',
])
const SHADOW_TOKENS = new Set<ThemeTokenName>([
  'shadowSurface', 'shadowRaised', 'shadowOverlay',
])
const DURATION_TOKENS = new Set<ThemeTokenName>([
  'durationPress', 'durationFast', 'durationStandard', 'durationDeliberate',
])
const EASING_TOKENS = new Set<ThemeTokenName>([
  'easeStandard', 'easeEnter', 'easeExit',
])

function supportsCssValue(property: string, value: string, fallback: boolean): boolean {
  if (fallback) return true
  return typeof CSS !== 'undefined'
    && typeof CSS.supports === 'function'
    && CSS.supports(property, value)
}

function containsUnsafeCss(value: string): boolean {
  return /[;{}]/.test(value)
}

function isValidColor(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}|transparent|currentcolor)$/i.test(value)
    || /^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color|color-mix|var)\([^(){};]+\)$/i.test(value)
  return supportsCssValue('color', value, fallback)
}

function isValidLength(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:0|\d*\.?\d+(?:px|rem|em|ch|ex|vw|vh|vmin|vmax|%))$/i.test(value)
    || /^(?:calc|min|max|clamp|var)\([^{};]+\)$/i.test(value)
  return supportsCssValue('width', value, fallback)
}

function isValidLineHeight(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:\d*\.?\d+|\d*\.?\d+(?:px|rem|em|%))$/i.test(value)
    || /^(?:calc|min|max|clamp|var)\([^{};]+\)$/i.test(value)
  return supportsCssValue('line-height', value, fallback)
}

function isValidWeight(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:[1-9]\d{0,2}|1000|normal|bold|bolder|lighter)$/i.test(value)
    || /^var\([^{};]+\)$/i.test(value)
  return supportsCssValue('font-weight', value, fallback)
}

function isValidDuration(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:0|\d*\.?\d+(?:ms|s))$/i.test(value)
    || /^(?:calc|var)\([^{};]+\)$/i.test(value)
  return supportsCssValue('transition-duration', value, fallback)
}

function isValidEasing(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  const fallback = /^(?:linear|ease|ease-in|ease-out|ease-in-out)$/i.test(value)
    || /^(?:cubic-bezier|steps|linear|var)\([^{};]+\)$/i.test(value)
  return supportsCssValue('transition-timing-function', value, fallback)
}

function isValidShadow(value: string): boolean {
  if (containsUnsafeCss(value)) return false
  if (value === 'none' || /^var\([^{};]+\)$/i.test(value)) return true
  const lengths = value.match(/(?:^|\s)(?:0|\d*\.?\d+(?:px|rem|em))(?=\s|$)/gi) ?? []
  const hasColor = /#[0-9a-f]{3,8}\b/i.test(value)
    || /(?:rgb|rgba|hsl|hsla|hwb|lab|lch|oklab|oklch|color)\([^{};]+\)$/i.test(value)
  return supportsCssValue('box-shadow', value, lengths.length >= 2 && hasColor)
}

function tokenSyntaxError(token: ThemeTokenName, value: string): string | null {
  if (COLOR_TOKENS.has(token) && !isValidColor(value)) return `tokens.${token} must be a valid color`
  if (LENGTH_TOKENS.has(token) && !isValidLength(value)) return `tokens.${token} must be a valid length`
  if (LINE_HEIGHT_TOKENS.has(token) && !isValidLineHeight(value)) return `tokens.${token} must be a valid line height`
  if (WEIGHT_TOKENS.has(token) && !isValidWeight(value)) return `tokens.${token} must be a valid font weight`
  if (SHADOW_TOKENS.has(token) && !isValidShadow(value)) return `tokens.${token} must be a valid shadow`
  if (DURATION_TOKENS.has(token) && !isValidDuration(value)) return `tokens.${token} must be a valid duration`
  if (EASING_TOKENS.has(token) && !isValidEasing(value)) return `tokens.${token} must be a valid easing function`
  if ((token === 'fontSans' || token === 'fontMono') && containsUnsafeCss(value)) {
    return `tokens.${token} must be a valid font family`
  }
  return null
}

function isPackageStylesheet(path: unknown): path is string {
  if (typeof path !== 'string' || !path.endsWith('.css') || /[\\\\:%?#\u0000-\u001f\u007f]/.test(path)) return false
  const segments = path.replace(/^\.\//, '').split('/')
  return segments.every(segment => segment.trim() !== '' && segment !== '.' && segment !== '..')
}

export function validateThemeDefinition(candidate: unknown): ThemeValidationResult {
  const errors: string[] = []
  const value = candidate as Partial<PluginThemeDefinition> | null

  if (!value || typeof value !== 'object') {
    return { valid: false, errors: ['theme definition must be an object'] }
  }
  if (typeof value.id !== 'string' || !STABLE_THEME_ID.test(value.id)) {
    errors.push('id must be a stable theme identifier')
  }
  if (typeof value.label !== 'string' || value.label.trim() === '') {
    errors.push('label is required')
  }
  if (value.appearance !== 'light' && value.appearance !== 'dark') {
    errors.push('appearance must be light or dark')
  }

  const tokens = value.tokens as Partial<Record<ThemeTokenName, unknown>> | undefined
  for (const token of THEME_TOKEN_NAMES) {
    const tokenValue = tokens?.[token]
    if (typeof tokenValue !== 'string' || tokenValue.trim() === '') {
      errors.push(`tokens.${token} is required`)
      continue
    }
    const syntaxError = tokenSyntaxError(token, tokenValue)
    if (syntaxError) errors.push(syntaxError)
  }

  if (value.stylesheets !== undefined && (
    !Array.isArray(value.stylesheets)
    || value.stylesheets.some((stylesheet) => !isPackageStylesheet(stylesheet))
  )) {
    errors.push('stylesheets must contain package-relative CSS artifact paths without traversal, URLs, queries, or fragments')
  }

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors }
}

export function freezeThemeDefinition(candidate: PluginThemeDefinition): PluginThemeDefinition {
  const validation = validateThemeDefinition(candidate)
  if (!validation.valid) {
    throw new Error(`Invalid theme definition: ${validation.errors.join('; ')}`)
  }
  const tokens = Object.freeze(Object.fromEntries(
    THEME_TOKEN_NAMES.map((token) => [token, candidate.tokens[token]]),
  )) as ThemeTokens
  const stylesheets = candidate.stylesheets === undefined
    ? undefined
    : Object.freeze([...candidate.stylesheets])
  return Object.freeze({
    id: candidate.id,
    label: candidate.label,
    appearance: candidate.appearance,
    tokens,
    ...(stylesheets ? { stylesheets } : {}),
  })
}
