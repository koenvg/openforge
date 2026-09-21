import { ImageAddon } from '@xterm/addon-image'
import { INLINE_IMAGE_COMPATIBILITY_REPLAY } from './terminalView.testUtils'
import { describe, expect, it, vi } from 'vitest'
import { createXtermTerminalView } from './xtermTerminalView'

const bytes = (text: string) => new TextEncoder().encode(text)

describe('real xterm presentation recovery', () => {
  it('a newer replacement cancels the remaining writes of an older snapshot', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'replacement', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    try {
      await Promise.all([
        view.replaceSnapshot({ compatibilityData: bytes('OLD HISTORY'), data: bytes('OLD SCREEN'), ptyInstanceId: null, sequence: 0 }),
        view.replaceSnapshot({ data: bytes('NEW SCREEN'), ptyInstanceId: null, sequence: 0 }),
      ])
      expect(view.capturePresentation().lines[0]?.text).toBe('NEW SCREEN')
    } finally {
      view.dispose()
    }
  })

  it.each(['hide', 'detach'] as const)('%s cancels an in-flight snapshot before it can overwrite a reopened view', async action => {
    const view = createXtermTerminalView({
      terminalKey: 'cancellation', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    try {
      const pending = view.replaceSnapshot({ data: bytes('STALE'), ptyInstanceId: null, sequence: 0 })
      if (action === 'hide') view.setVisible(false)
      else view.unmount()
      await pending
      expect(view.capturePresentation().lines).toEqual([])
      await view.replaceSnapshot({ data: bytes('CURRENT'), ptyInstanceId: null, sequence: 0 })
      expect(view.capturePresentation().lines[0]?.text).toBe('CURRENT')
    } finally {
      view.dispose()
    }
  })

  it('settles a pending replacement when its view is disposed', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'dispose-replay', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    const pending = view.replaceSnapshot({ data: bytes('NEVER PRESENT'), ptyInstanceId: null, sequence: 0 })
    view.dispose()
    await pending
  }, 1000)

  it('refuses incomplete live recovery without clearing the existing presentation', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'recovery', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    try {
      await view.replaceSnapshot({ data: 'existing', ptyInstanceId: null, sequence: 0 })
      await expect(view.replaceSnapshot({
        data: 'incomplete', ptyInstanceId: 1, sequence: 1,
      })).rejects.toThrow('parser continuation')
      expect(view.capturePresentation().lines[0]?.text).toBe('existing')
    } finally {
      view.dispose()
    }
  })

  it('continues a split CSI after repainting the authoritative presentation', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'recovery',
      themeMode: 'dark',
      openLink: async () => undefined,
      fontReadiness: { status: 'ready' },
      enableImages: false,
    })
    try {
      await view.replaceSnapshot({
        compatibilityData: bytes('BEFORE\x1b[31'),
        data: bytes('\x1b[HBEFORE\x1b[1;7H'),
        continuationData: bytes('\x1b[31'),
        ptyInstanceId: 1,
        sequence: 1,
      })
      view.writeLive({ data: bytes('mRED'), ptyInstanceId: 1, sequence: 2 })
      await vi.waitFor(() => {
        const presentation = view.capturePresentation()
        expect(presentation.lines[0]?.text).toBe('BEFORERED')
        expect(presentation.lines[0]?.cells[6]?.foreground.value).toBe(1)
        expect(presentation.cursor).toEqual({ x: 9, y: 0 })
      })
    } finally {
      view.dispose()
    }
  })
  it.each([
    { name: 'UTF-8', prefix: new Uint8Array([0xf0, 0x9f]), suffix: new Uint8Array([0x98, 0x80]), expected: 'BEFORE😀' },
    { name: 'query', prefix: bytes('\x1b['), suffix: bytes('6n'), expected: 'BEFORE' },
  ])('continues split $name without leaking renderer replies', async ({ prefix, suffix, expected }) => {
    const view = createXtermTerminalView({
      terminalKey: 'recovery', openLink: async () => undefined,
      themeMode: 'dark',
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    const input = vi.fn()
    view.onUserInput(input)
    try {
      await view.replaceSnapshot({
        compatibilityData: new Uint8Array([...bytes('BEFORE'), ...prefix]),
        data: bytes('\x1b[HBEFORE\x1b[1;7H'),
        continuationData: prefix, ptyInstanceId: 1, sequence: 1,
      })
      view.writeLive({ data: new Uint8Array([...suffix, ...bytes('END')]), ptyInstanceId: 1, sequence: 2 })
      await vi.waitFor(() => expect(view.capturePresentation().lines[0]?.text).toBe(`${expected}END`))
      expect(input).not.toHaveBeenCalled()
    } finally {
      view.dispose()
    }
  })
  it('keeps a supported image while restoring a split CSI through the real view', async () => {
    const activate = vi.spyOn(ImageAddon.prototype, 'activate')
    const bitmap = { width: 1, height: 1, close() {} } as ImageBitmap
    vi.stubGlobal('createImageBitmap', vi.fn(async () => bitmap))
    const view = createXtermTerminalView({
      terminalKey: 'images', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: true,
    })
    try {
      const addon = activate.mock.contexts[0] as ImageAddon
      await view.replaceSnapshot({
        compatibilityData: bytes(`BEFORE${INLINE_IMAGE_COMPATIBILITY_REPLAY}\x1b[31`),
        data: bytes('\x1b[HBEFORE\x1b[1;7H'),
        continuationData: bytes('\x1b[31'), ptyInstanceId: 1, sequence: 1,
      })
      expect(addon.getImageAtBufferCell(6, 0)).toBeDefined()
      view.writeLive({ data: bytes('m\r\nRED'), ptyInstanceId: 1, sequence: 2 })
      await vi.waitFor(() => expect(view.capturePresentation().lines[1]?.text).toBe('RED'))
      expect(addon.getImageAtBufferCell(6, 0)).toBeDefined()
    } finally {
      view.dispose()
      activate.mockRestore()
      vi.unstubAllGlobals()
    }
  })
  it('returns to the saved primary screen after alternate-screen recovery', async () => {
    const view = createXtermTerminalView({
      terminalKey: 'alternate', themeMode: 'dark', openLink: async () => undefined,
      fontReadiness: { status: 'ready' }, enableImages: false,
    })
    try {
      await view.replaceSnapshot({
        compatibilityData: bytes('PRIMARY\x1b[?1049hALT\x1b[31'),
        data: bytes('\x1b[?1049h\x1b[HALT\x1b[1;4H'),
        continuationData: bytes('\x1b[31'), ptyInstanceId: 1, sequence: 1,
      })
      expect(view.capturePresentation().activeBuffer).toBe('alternate')
      view.writeLive({ data: bytes('m\x1b[?1049lAFTER'), ptyInstanceId: 1, sequence: 2 })
      await vi.waitFor(() => expect(view.capturePresentation().lines[0]?.text).toBe('PRIMARYAFTER'))
      expect(view.capturePresentation().activeBuffer).toBe('normal')
    } finally {
      view.dispose()
    }
  })
})
