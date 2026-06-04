import type { ITerminalOptions } from '@xterm/xterm'
import type { ThemeMode } from './theme'
import { getTerminalTheme } from './theme'

export const TERMINAL_FONT_SIZE = 13
export const TERMINAL_CELL_HEIGHT = 18
const TERMINAL_FONT_PRELOAD_TIMEOUT_MS = 3000

type TerminalFontFace = {
  family: string
  weight: 400 | 700
  style: 'normal' | 'italic'
}

export const TERMINAL_WEB_FONT_FACES: TerminalFontFace[] = [
  { family: 'JetBrains Mono', weight: 400, style: 'normal' },
  { family: 'JetBrains Mono', weight: 700, style: 'normal' },
  { family: 'JetBrains Mono', weight: 400, style: 'italic' },
  { family: 'JetBrains Mono', weight: 700, style: 'italic' },
  { family: 'NerdFontsSymbols Nerd Font', weight: 400, style: 'normal' },
]

export const TERMINAL_FONT_FAMILY = "'JetBrains Mono', 'NerdFontsSymbols Nerd Font', 'Symbols Nerd Font', 'Symbols Nerd Font Mono', 'SF Mono', 'Fira Code', 'Consolas', monospace"

export async function preloadTerminalFonts(): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts) {
    return
  }

  const fontLoads = TERMINAL_WEB_FONT_FACES.map(fontFace => {
    const stylePrefix = fontFace.style === 'italic' ? 'italic ' : ''
    return document.fonts.load(`${stylePrefix}${fontFace.weight} ${TERMINAL_FONT_SIZE}px "${fontFace.family}"`)
  })

  await Promise.race([
    Promise.allSettled(fontLoads).then(() => undefined),
    new Promise<void>(resolve => setTimeout(resolve, TERMINAL_FONT_PRELOAD_TIMEOUT_MS)),
  ])
}

export function getTerminalOptions(themeMode: ThemeMode): ITerminalOptions {
  return {
    fontFamily: TERMINAL_FONT_FAMILY,
    fontSize: TERMINAL_FONT_SIZE,
    fontWeight: 400,
    fontWeightBold: 700,
    letterSpacing: 0,
    lineHeight: TERMINAL_CELL_HEIGHT / TERMINAL_FONT_SIZE,
    cursorBlink: true,
    cursorStyle: 'block',
    scrollback: 10000,
    minimumContrastRatio: 4.5,
    theme: getTerminalTheme(themeMode),
    allowProposedApi: true,
  }
}
