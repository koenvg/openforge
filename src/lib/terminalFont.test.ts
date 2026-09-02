import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { TERMINAL_FONT_FAMILY } from '@openforge-app/terminal-runtime'
import { getConfig, setConfig } from './ipc'
import {
  applyTerminalFontChoice,
  initTerminalFontChoice,
  TERMINAL_FONT_OPTIONS,
  terminalFont,
  terminalFontFamily,
} from './terminalFont'

vi.mock('./ipc', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}))

describe('terminalFont', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalFont.set('jetbrains-mono')
  })

  describe('terminalFont store', () => {
    it('defaults to jetbrains-mono', () => {
      expect(get(terminalFont)).toBe('jetbrains-mono')
    })
  })

  describe('TERMINAL_FONT_OPTIONS', () => {
    it('lists jetbrains-mono plus the curated terminal fonts', () => {
      expect(TERMINAL_FONT_OPTIONS.map((font) => font.id)).toEqual([
        'jetbrains-mono',
        'ibm-plex-mono',
        'cascadia-code',
        'vt323',
        'martian-mono',
        'overpass-mono',
        'courier-prime',
        'space-mono',
      ])
    })

    it('uses the shared TERMINAL_FONT_FAMILY stack for the default option', () => {
      expect(TERMINAL_FONT_OPTIONS[0].fontFamily).toBe(TERMINAL_FONT_FAMILY)
    })
  })

  describe('terminalFontFamily', () => {
    it('derives the font-family stack for the selected font', () => {
      applyTerminalFontChoice('vt323')
      expect(get(terminalFontFamily)).toContain("'VT323'")
    })
  })

  describe('applyTerminalFontChoice', () => {
    it('updates the terminalFont store', () => {
      applyTerminalFontChoice('cascadia-code')
      expect(get(terminalFont)).toBe('cascadia-code')
    })

    it('persists preference via setConfig', () => {
      applyTerminalFontChoice('ibm-plex-mono')
      expect(setConfig).toHaveBeenCalledWith('terminalFont', 'ibm-plex-mono')
    })
  })

  describe('initTerminalFontChoice', () => {
    it('loads stored font and applies it', async () => {
      vi.mocked(getConfig).mockResolvedValue('vt323')
      await initTerminalFontChoice()
      expect(getConfig).toHaveBeenCalledWith('terminalFont')
      expect(get(terminalFont)).toBe('vt323')
    })

    it('defaults to jetbrains-mono when no stored font', async () => {
      vi.mocked(getConfig).mockResolvedValue(null)
      await initTerminalFontChoice()
      expect(get(terminalFont)).toBe('jetbrains-mono')
    })

    it('defaults to jetbrains-mono on config error', async () => {
      vi.mocked(getConfig).mockRejectedValue(new Error('config error'))
      await initTerminalFontChoice()
      expect(get(terminalFont)).toBe('jetbrains-mono')
    })

    it('defaults to jetbrains-mono when stored value is not a known font', async () => {
      vi.mocked(getConfig).mockResolvedValue('comic-sans')
      await initTerminalFontChoice()
      expect(get(terminalFont)).toBe('jetbrains-mono')
    })
  })
})
