import { beforeEach, describe, expect, it, vi } from 'vitest'
import { get } from 'svelte/store'
import { TERMINAL_FONT_SIZE } from '@openforge-app/terminal-runtime'
import { getConfig, setConfig } from './ipc'
import {
  applyTerminalFontSizeChoice,
  initTerminalFontSizeChoice,
  MAX_TERMINAL_FONT_SIZE,
  MIN_TERMINAL_FONT_SIZE,
  terminalFontSize,
} from './terminalFontSize'

vi.mock('./ipc', () => ({
  getConfig: vi.fn().mockResolvedValue(null),
  setConfig: vi.fn().mockResolvedValue(undefined),
}))

describe('terminalFontSize', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    terminalFontSize.set(TERMINAL_FONT_SIZE)
  })

  describe('terminalFontSize store', () => {
    it('defaults to TERMINAL_FONT_SIZE', () => {
      expect(get(terminalFontSize)).toBe(TERMINAL_FONT_SIZE)
    })
  })

  describe('applyTerminalFontSizeChoice', () => {
    it('updates the terminalFontSize store', () => {
      applyTerminalFontSizeChoice(16)
      expect(get(terminalFontSize)).toBe(16)
    })

    it('persists preference via setConfig', () => {
      applyTerminalFontSizeChoice(16)
      expect(setConfig).toHaveBeenCalledWith('terminalFontSize', '16')
    })

    it('clamps values above the maximum', () => {
      applyTerminalFontSizeChoice(MAX_TERMINAL_FONT_SIZE + 10)
      expect(get(terminalFontSize)).toBe(MAX_TERMINAL_FONT_SIZE)
    })

    it('clamps values below the minimum', () => {
      applyTerminalFontSizeChoice(MIN_TERMINAL_FONT_SIZE - 10)
      expect(get(terminalFontSize)).toBe(MIN_TERMINAL_FONT_SIZE)
    })
  })

  describe('initTerminalFontSizeChoice', () => {
    it('loads stored size and applies it', async () => {
      vi.mocked(getConfig).mockResolvedValue('18')
      await initTerminalFontSizeChoice()
      expect(getConfig).toHaveBeenCalledWith('terminalFontSize')
      expect(get(terminalFontSize)).toBe(18)
    })

    it('defaults to TERMINAL_FONT_SIZE when no stored size', async () => {
      vi.mocked(getConfig).mockResolvedValue(null)
      await initTerminalFontSizeChoice()
      expect(get(terminalFontSize)).toBe(TERMINAL_FONT_SIZE)
    })

    it('defaults to TERMINAL_FONT_SIZE on config error', async () => {
      vi.mocked(getConfig).mockRejectedValue(new Error('config error'))
      await initTerminalFontSizeChoice()
      expect(get(terminalFontSize)).toBe(TERMINAL_FONT_SIZE)
    })

    it('defaults to TERMINAL_FONT_SIZE when stored value is out of range', async () => {
      vi.mocked(getConfig).mockResolvedValue(String(MAX_TERMINAL_FONT_SIZE + 10))
      await initTerminalFontSizeChoice()
      expect(get(terminalFontSize)).toBe(TERMINAL_FONT_SIZE)
    })

    it('defaults to TERMINAL_FONT_SIZE when stored value is not a number', async () => {
      vi.mocked(getConfig).mockResolvedValue('comic-sans')
      await initTerminalFontSizeChoice()
      expect(get(terminalFontSize)).toBe(TERMINAL_FONT_SIZE)
    })
  })
})
