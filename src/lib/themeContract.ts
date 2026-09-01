export const BUILTIN_LIGHT_THEME_ID = 'openforge-light'
export const BUILTIN_DARK_THEME_ID = 'openforge-dark'

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

export interface ThemeDefinition {
  readonly id: string
  readonly label: string
  readonly appearance: ThemeAppearance
  readonly tokens: ThemeTokens
  readonly stylesheets?: readonly string[]
}

export type ThemeValidationResult =
  | { readonly valid: true; readonly errors: readonly [] }
  | { readonly valid: false; readonly errors: readonly string[] }

const STABLE_THEME_ID = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/

function cssPropertyForToken(token: ThemeTokenName): `--of-${string}` {
  return `--of-${token.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`
}

export const THEME_TOKEN_CSS_PROPERTIES = Object.freeze(Object.fromEntries(
  THEME_TOKEN_NAMES.map((token) => [token, cssPropertyForToken(token)]),
)) as Readonly<Record<ThemeTokenName, `--of-${string}`>>

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

export function validateThemeDefinition(candidate: unknown): ThemeValidationResult {
  const errors: string[] = []
  const value = candidate as Partial<ThemeDefinition> | null

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
    || value.stylesheets.some((stylesheet) => typeof stylesheet !== 'string' || stylesheet.trim() === '')
  )) {
    errors.push('stylesheets must contain non-empty paths')
  }

  return errors.length === 0
    ? { valid: true, errors: [] }
    : { valid: false, errors }
}

export function freezeThemeDefinition(candidate: ThemeDefinition): ThemeDefinition {
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

const sharedMetrics = {
  borderWidth: '1px',
  focusWidth: '2px',
  radiusControl: '3px',
  radiusContainer: '2px',
  radiusOverlay: '4px',
  radiusShell: '24px',
  radiusRound: '9999px',
  controlHeightCompact: '28px',
  controlHeight: '36px',
  controlHeightTouch: '44px',
  space1: '2px',
  space2: '4px',
  space3: '6px',
  space4: '8px',
  space5: '12px',
  space6: '16px',
  space7: '24px',
  space8: '32px',
  space9: '48px',
  fontSans: "'Inter', ui-sans-serif, system-ui, -apple-system, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, monospace",
  textXs: '11px',
  textSm: '12px',
  textMd: '14px',
  textLg: '16px',
  textXl: '20px',
  lineHeightXs: '1.35',
  lineHeightSm: '1.35',
  lineHeightMd: '1.5',
  lineHeightLg: '1.5',
  lineHeightXl: '1.2',
  weightRegular: '400',
  weightMedium: '500',
  weightSemibold: '600',
  durationPress: '80ms',
  durationFast: '140ms',
  durationStandard: '200ms',
  durationDeliberate: '280ms',
  easeStandard: 'cubic-bezier(0.2, 0, 0, 1)',
  easeEnter: 'cubic-bezier(0.16, 1, 0.3, 1)',
  easeExit: 'cubic-bezier(0.4, 0, 1, 1)',
} as const

const lightTokens = {
  canvas: '#FBFBFA', surface: '#FFFFFF', surfaceSubtle: '#F4F5F5', surfaceRaised: '#FFFFFF',
  surfaceTint: '#F0F3FF', scrim: 'rgb(13 15 20 / 48%)',
  text: '#111318', textSecondary: '#434954', textMuted: '#626872', textInverse: '#FFFFFF',
  link: '#2947FF', icon: '#434954', iconMuted: '#626872',
  border: '#E1E3E6', borderStrong: '#C9CDD2', borderInteractive: '#8D95A0',
  focusRing: '#2947FF', selection: 'rgb(41 71 255 / 22%)',
  accent: '#2947FF', accentHover: '#1830C9', accentPressed: '#10249F', onAccent: '#FFFFFF',
  accentSubtle: '#E8ECFF', onAccentSubtle: '#1830C9',
  info: '#2947FF', onInfo: '#FFFFFF', infoSubtle: '#E8ECFF',
  success: '#087F5B', onSuccess: '#FFFFFF', successSubtle: '#E6F7F1',
  warning: '#A15C00', onWarning: '#FFFFFF', warningSubtle: '#FFF3DE',
  danger: '#C52632', onDanger: '#FFFFFF', dangerSubtle: '#FDEBEC',
  control: '#FFFFFF', controlHover: '#F4F5F5', controlPressed: '#E8EAEC', controlDisabled: '#ECEEEF',
  controlText: '#111318', controlTextDisabled: '#7B818A', field: '#FFFFFF', fieldHover: '#FBFBFA', fieldInvalid: '#C52632',
  statusNeutral: '#626872', statusNeutralSubtle: '#ECEEEF', onStatusNeutral: '#434954',
  statusRunning: '#2947FF', statusRunningSubtle: '#E8ECFF', onStatusRunning: '#1830C9',
  statusWaiting: '#A15C00', statusWaitingSubtle: '#FFF3DE', onStatusWaiting: '#7A4300',
  statusSuccess: '#087F5B', statusSuccessSubtle: '#E6F7F1', onStatusSuccess: '#056346',
  statusWarning: '#A15C00', statusWarningSubtle: '#FFF3DE', onStatusWarning: '#7A4300',
  statusDanger: '#C52632', statusDangerSubtle: '#FDEBEC', onStatusDanger: '#991D27',
  codeCanvas: '#F7F8F8', codeText: '#24272D', codeMuted: '#626872', codeBorder: '#E1E3E6',
  diffAdded: '#087F5B', diffAddedSubtle: '#DDF3EA', diffRemoved: '#C52632', diffRemovedSubtle: '#FBE2E4',
  diffChanged: '#8A5200', diffChangedSubtle: '#FFF0CF',
  terminalBackground: '#FFFFFF', terminalForeground: '#1F2328', terminalCursor: '#0969DA', terminalCursorAccent: '#FFFFFF',
  terminalSelectionBackground: '#0969DA33', terminalSelectionForeground: '#1F2328',
  terminalBlack: '#24292F', terminalRed: '#CF222E', terminalGreen: '#116329', terminalYellow: '#4D2D00',
  terminalBlue: '#0969DA', terminalMagenta: '#8250DF', terminalCyan: '#1B7C83', terminalWhite: '#6E7781',
  terminalBrightBlack: '#57606A', terminalBrightRed: '#A40E26', terminalBrightGreen: '#1A7F37',
  terminalBrightYellow: '#633C01', terminalBrightBlue: '#218BFF', terminalBrightMagenta: '#A475F9',
  terminalBrightCyan: '#3192AA', terminalBrightWhite: '#8C959F',
  ...sharedMetrics,
  shadowSurface: '0 1px 2px rgb(17 19 24 / 6%)',
  shadowRaised: '0 4px 12px rgb(17 19 24 / 10%)',
  shadowOverlay: '0 18px 48px rgb(17 19 24 / 18%)',
} satisfies ThemeTokens

const darkTokens = {
  canvas: '#0D0F14', surface: '#14171D', surfaceSubtle: '#1B1F27', surfaceRaised: '#20252E',
  surfaceTint: '#171D32', scrim: 'rgb(0 0 0 / 64%)',
  text: '#F3F5F7', textSecondary: '#C5CBD3', textMuted: '#9AA3AE', textInverse: '#0D0F14',
  link: '#A3ADFF', icon: '#C5CBD3', iconMuted: '#9AA3AE',
  border: '#2D333D', borderStrong: '#434B57', borderInteractive: '#687383',
  focusRing: '#8494FF', selection: 'rgb(132 148 255 / 30%)',
  accent: '#8494FF', accentHover: '#A3ADFF', accentPressed: '#BBC3FF', onAccent: '#0D0F14',
  accentSubtle: '#252D55', onAccentSubtle: '#C8CEFF',
  info: '#8494FF', onInfo: '#0D0F14', infoSubtle: '#252D55',
  success: '#5ED6B2', onSuccess: '#0D0F14', successSubtle: '#173A31',
  warning: '#FFBE5C', onWarning: '#0D0F14', warningSubtle: '#402F17',
  danger: '#FF7A86', onDanger: '#0D0F14', dangerSubtle: '#452128',
  control: '#20252E', controlHover: '#292F39', controlPressed: '#333A46', controlDisabled: '#242932',
  controlText: '#F3F5F7', controlTextDisabled: '#77818D', field: '#14171D', fieldHover: '#1B1F27', fieldInvalid: '#FF7A86',
  statusNeutral: '#9AA3AE', statusNeutralSubtle: '#242932', onStatusNeutral: '#C5CBD3',
  statusRunning: '#8494FF', statusRunningSubtle: '#252D55', onStatusRunning: '#C8CEFF',
  statusWaiting: '#FFBE5C', statusWaitingSubtle: '#402F17', onStatusWaiting: '#FFD28F',
  statusSuccess: '#5ED6B2', statusSuccessSubtle: '#173A31', onStatusSuccess: '#91E5CC',
  statusWarning: '#FFBE5C', statusWarningSubtle: '#402F17', onStatusWarning: '#FFD28F',
  statusDanger: '#FF7A86', statusDangerSubtle: '#452128', onStatusDanger: '#FFADB5',
  codeCanvas: '#101319', codeText: '#E6E9ED', codeMuted: '#9AA3AE', codeBorder: '#2D333D',
  diffAdded: '#5ED6B2', diffAddedSubtle: '#173A31', diffRemoved: '#FF7A86', diffRemovedSubtle: '#452128',
  diffChanged: '#FFBE5C', diffChangedSubtle: '#402F17',
  terminalBackground: '#0D0F14', terminalForeground: '#F3F5F7', terminalCursor: '#8494FF', terminalCursorAccent: '#0D0F14',
  terminalSelectionBackground: '#394573', terminalSelectionForeground: '#F3F5F7',
  terminalBlack: '#454B55', terminalRed: '#FF7A86', terminalGreen: '#5ED6B2', terminalYellow: '#FFBE5C',
  terminalBlue: '#8494FF', terminalMagenta: '#C69BFF', terminalCyan: '#5DD5E0', terminalWhite: '#C5CBD3',
  terminalBrightBlack: '#737D89', terminalBrightRed: '#FFADB5', terminalBrightGreen: '#91E5CC',
  terminalBrightYellow: '#FFD28F', terminalBrightBlue: '#AAB5FF', terminalBrightMagenta: '#DCC1FF',
  terminalBrightCyan: '#91E7EE', terminalBrightWhite: '#F3F5F7',
  ...sharedMetrics,
  shadowSurface: 'none',
  shadowRaised: '0 6px 18px rgb(0 0 0 / 28%)',
  shadowOverlay: '0 20px 56px rgb(0 0 0 / 46%)',
} satisfies ThemeTokens

export const LIGHT_THEME = freezeThemeDefinition({
  id: BUILTIN_LIGHT_THEME_ID,
  label: 'OpenForge Light',
  appearance: 'light',
  tokens: lightTokens,
})

export const DARK_THEME = freezeThemeDefinition({
  id: BUILTIN_DARK_THEME_ID,
  label: 'OpenForge Dark',
  appearance: 'dark',
  tokens: darkTokens,
})

export const BUILTIN_THEMES = Object.freeze([LIGHT_THEME, DARK_THEME])
