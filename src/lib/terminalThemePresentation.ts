import type {
  TerminalColorProfile,
  TerminalRgbColor,
  TerminalThemePalette,
  TerminalThemeSnapshot,
} from '@openforge-app/terminal-runtime'
import { LIGHT_THEME, type ThemeDefinition } from './themeContract'

export interface ResolvedCssColor extends TerminalRgbColor {
  readonly alpha: number
}

export type TerminalCssColorResolver = (value: string) => ResolvedCssColor | null

export class TerminalThemeResolutionError extends Error {
  constructor(readonly tokenValue: string) {
    super(`Could not resolve terminal colour: ${tokenValue}`)
    this.name = 'TerminalThemeResolutionError'
  }
}

const ANSI_TOKENS = [
  'terminalBlack', 'terminalRed', 'terminalGreen', 'terminalYellow',
  'terminalBlue', 'terminalMagenta', 'terminalCyan', 'terminalWhite',
  'terminalBrightBlack', 'terminalBrightRed', 'terminalBrightGreen',
  'terminalBrightYellow', 'terminalBrightBlue', 'terminalBrightMagenta',
  'terminalBrightCyan', 'terminalBrightWhite',
] as const satisfies readonly (keyof ThemeDefinition['tokens'])[]

const ANSI_THEME_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
] as const satisfies readonly (keyof TerminalThemePalette)[]

export function createTerminalThemeSnapshot(
  theme: Pick<ThemeDefinition, 'appearance' | 'tokens'>,
  resolveColor: TerminalCssColorResolver = resolveBrowserColor,
): TerminalThemeSnapshot {
  try {
    return resolveTerminalThemeSnapshot(theme, resolveColor)
  } catch (error) {
    if (!(error instanceof TerminalThemeResolutionError) || theme.tokens === LIGHT_THEME.tokens) throw error
    return resolveTerminalThemeSnapshot(LIGHT_THEME, resolveColor)
  }
}

export function resolveTerminalThemeSnapshot(
  theme: Pick<ThemeDefinition, 'appearance' | 'tokens'>,
  resolveColor: TerminalCssColorResolver = resolveBrowserColor,
): TerminalThemeSnapshot {
  const tokens = theme.tokens
  const applicationSurface = opaque(resolve(tokens.canvas), { red: 255, green: 255, blue: 255 })
  const background = opaque(resolve(tokens.terminalBackground), applicationSurface)
  const foreground = opaque(resolve(tokens.terminalForeground), background)
  const cursor = opaque(resolve(tokens.terminalCursor), background)
  const ansiColors = Object.freeze(ANSI_TOKENS.map(token => opaque(resolve(tokens[token]), background)))
  const normalizedAuthorityTheme = Object.fromEntries([
    ['background', toHex(background)],
    ['foreground', toHex(foreground)],
    ['cursor', toHex(cursor)],
    ...ANSI_THEME_KEYS.map((key, index) => [key, toHex(ansiColors[index])] as const),
  ]) as Pick<TerminalThemePalette,
    'background' | 'foreground' | 'cursor'
    | typeof ANSI_THEME_KEYS[number]>
  const terminalTheme: TerminalThemePalette = Object.freeze({
    ...normalizedAuthorityTheme,
    cursorAccent: tokens.terminalCursorAccent,
    selectionBackground: tokens.terminalSelectionBackground,
    selectionForeground: tokens.terminalSelectionForeground,
  })

  const colorProfile: TerminalColorProfile = Object.freeze({
    version: 1,
    background,
    foreground,
    cursor,
    ansiColors,
  })

  return Object.freeze({
    appearance: theme.appearance,
    terminalTheme,
    colorProfile,
  })

  function resolve(value: string): ResolvedCssColor {
    const resolved = resolveColor(value)
    if (!resolved || !validChannel(resolved.red) || !validChannel(resolved.green)
      || !validChannel(resolved.blue) || !Number.isFinite(resolved.alpha)
      || resolved.alpha < 0 || resolved.alpha > 1) {
      throw new TerminalThemeResolutionError(value)
    }
    return resolved
  }
}

function validChannel(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 255
}

function opaque(foreground: ResolvedCssColor, background: TerminalRgbColor): TerminalRgbColor {
  const mix = (front: number, back: number) => Math.round(front * foreground.alpha + back * (1 - foreground.alpha))
  return Object.freeze({
    red: mix(foreground.red, background.red),
    green: mix(foreground.green, background.green),
    blue: mix(foreground.blue, background.blue),
  })
}

function toHex(color: TerminalRgbColor): string {
  const channel = (value: number) => value.toString(16).padStart(2, '0').toUpperCase()
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`
}

function resolveBrowserColor(value: string): ResolvedCssColor | null {
  const direct = parseHex(value) ?? parseRgb(value)
  if (direct) return direct
  if (typeof document === 'undefined' || !document.defaultView) return null

  const probe = document.createElement('span')
  probe.style.color = value
  if (!probe.style.color) return null
  probe.style.display = 'none'
  document.documentElement.appendChild(probe)
  const computed = document.defaultView.getComputedStyle(probe).color
  probe.remove()
  return parseHex(computed) ?? parseRgb(computed) ?? rasterize(computed)
}

function parseHex(value: string): ResolvedCssColor | null {
  const match = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())
  if (!match) return null
  const expanded = match[1].length <= 4
    ? Array.from(match[1], digit => `${digit}${digit}`).join('')
    : match[1]
  const number = Number.parseInt(expanded, 16)
  const hasAlpha = expanded.length === 8
  return {
    red: hasAlpha ? (number >>> 24) & 0xFF : (number >>> 16) & 0xFF,
    green: hasAlpha ? (number >>> 16) & 0xFF : (number >>> 8) & 0xFF,
    blue: hasAlpha ? (number >>> 8) & 0xFF : number & 0xFF,
    alpha: hasAlpha ? (number & 0xFF) / 255 : 1,
  }
}

function parseRgb(value: string): ResolvedCssColor | null {
  const match = /^rgba?\(\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)\s*[, ]\s*(\d+(?:\.\d+)?)(?:\s*(?:,|\/)\s*(\d+(?:\.\d+)?%?))?\s*\)$/i.exec(value.trim())
  if (!match) return null
  const channels = match.slice(1, 4).map(Number)
  if (channels.some(channel => !Number.isFinite(channel) || channel < 0 || channel > 255)) return null
  const alphaValue = match[4]
  const alpha = alphaValue?.endsWith('%') ? Number.parseFloat(alphaValue) / 100 : Number(alphaValue ?? 1)
  return { red: Math.round(channels[0]), green: Math.round(channels[1]), blue: Math.round(channels[2]), alpha }
}

function rasterize(value: string): ResolvedCssColor | null {
  const canvas = document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) return null
  context.clearRect(0, 0, 1, 1)
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  const [red, green, blue, alpha] = context.getImageData(0, 0, 1, 1).data
  return { red, green, blue, alpha: alpha / 255 }
}
