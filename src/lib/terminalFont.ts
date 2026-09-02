import { derived, writable } from 'svelte/store'
import { TERMINAL_FONT_FAMILY } from '@openforge-app/terminal-runtime'
import { getConfig, setConfig } from './ipc'

export type TerminalFontId =
  | 'jetbrains-mono'
  | 'ibm-plex-mono'
  | 'cascadia-code'
  | 'vt323'
  | 'martian-mono'
  | 'overpass-mono'
  | 'courier-prime'
  | 'space-mono'

export interface TerminalFontOption {
  id: TerminalFontId
  label: string
  description: string
  fontFamily: string
}

const DEFAULT_TERMINAL_FONT: TerminalFontId = 'jetbrains-mono'

export const TERMINAL_FONT_OPTIONS: TerminalFontOption[] = [
  {
    id: 'jetbrains-mono',
    label: 'JetBrains Mono (default)',
    description: 'The current default terminal font.',
    fontFamily: TERMINAL_FONT_FAMILY,
  },
  {
    id: 'ibm-plex-mono',
    label: 'IBM Plex Mono',
    description: "IBM's clean, screen-friendly monospace font.",
    fontFamily: "'IBM Plex Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'cascadia-code',
    label: 'Cascadia Code',
    description: "Microsoft's terminal font, tuned for on-screen clarity.",
    fontFamily: "'Cascadia Code', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'vt323',
    label: 'VT323 (exotic)',
    description: 'A retro pixel terminal font — obvious at a glance whether the setting is working.',
    fontFamily: "'VT323', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'martian-mono',
    label: 'Martian Mono',
    description: 'A geometric grotesk monospace font, free alternative in the spirit of Bambino New.',
    fontFamily: "'Martian Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'overpass-mono',
    label: 'Overpass Mono',
    description: 'A humanist monospace font derived from highway signage, free alternative in the spirit of SmytheSoft Pro.',
    fontFamily: "'Overpass Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'courier-prime',
    label: 'Courier Prime',
    description: 'A cleaned-up typewriter/slab monospace font, free alternative in the spirit of Okojo Slab Pro.',
    fontFamily: "'Courier Prime', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
  {
    id: 'space-mono',
    label: 'Space Mono',
    description: 'A distinctive geometric monospace font, free alternative in the spirit of Averta.',
    fontFamily: "'Space Mono', 'Symbols Nerd Font Mono', 'Symbols Nerd Font', monospace",
  },
]

export const terminalFont = writable<TerminalFontId>(DEFAULT_TERMINAL_FONT)

export const terminalFontFamily = derived(terminalFont, (id) => fontFamilyFor(id))

function isTerminalFontId(value: string): value is TerminalFontId {
  return TERMINAL_FONT_OPTIONS.some((font) => font.id === value)
}

function fontFamilyFor(id: TerminalFontId): string {
  return TERMINAL_FONT_OPTIONS.find((font) => font.id === id)?.fontFamily ?? TERMINAL_FONT_FAMILY
}

/**
 * Apply a terminal font choice: updates the reactive store (which live-propagates
 * to every open terminal via terminalSessionService) and persists the preference.
 */
export function applyTerminalFontChoice(font: TerminalFontId): void {
  terminalFont.set(font)
  setConfig('terminalFont', font).catch((e) =>
    console.error('Failed to persist terminal font:', e)
  )
}

/**
 * Load stored terminal font preference from backend config and apply it.
 * Falls back to the default font if no preference is stored or on error.
 */
export async function initTerminalFontChoice(): Promise<void> {
  let font: TerminalFontId = DEFAULT_TERMINAL_FONT
  try {
    const stored = await getConfig('terminalFont')
    if (stored && isTerminalFontId(stored)) {
      font = stored
    }
  } catch {
    // fallthrough: use default font
  }
  terminalFont.set(font)
}
