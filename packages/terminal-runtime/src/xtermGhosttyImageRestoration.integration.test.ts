import { ImageAddon } from '@xterm/addon-image'
import { Terminal } from '@xterm/xterm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { INLINE_IMAGE_COMPATIBILITY_REPLAY } from './terminalView.testUtils'

describe('xterm Ghostty image restoration compatibility', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('retains an inline image when portable VT repaints parsed text after compatibility replay', async () => {
    const bitmap = { width: 1, height: 1, close() {} } as ImageBitmap
    const createImageBitmap = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(window, 'createImageBitmap')
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: createImageBitmap,
    })

    const terminal = new Terminal({ cols: 80, rows: 24 })
    const imageAddon = new ImageAddon({
      iipSupport: true,
      sixelSupport: false,
      iipSizeLimit: 1024,
      pixelLimit: 1024,
    })
    terminal.loadAddon(imageAddon)

    try {
      await new Promise<void>(resolve => terminal.write(`bootstrap${INLINE_IMAGE_COMPATIBILITY_REPLAY}`, resolve))
      await vi.waitFor(() => expect(imageAddon.getImageAtBufferCell(9, 0)).toBeDefined())

      // Ghostty portable VT repaints the authoritative text and restores its cursor.
      await new Promise<void>(resolve => terminal.write('\u001b[Hbootstrap\u001b[1;10H', resolve))

      expect(imageAddon.getImageAtBufferCell(9, 0)).toBeDefined()
      expect(terminal.buffer.active.cursorX).toBe(9)
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(window, 'createImageBitmap', originalCreateImageBitmap)
      } else {
        Reflect.deleteProperty(window, 'createImageBitmap')
      }
      terminal.dispose()
    }
  })

  it('preserves one multiline transcript while portable VT repaints an image-bearing viewport', async () => {
    const bitmap = { width: 1, height: 1, close() {} } as ImageBitmap
    const createImageBitmap = vi.fn(async () => bitmap)
    vi.stubGlobal('createImageBitmap', createImageBitmap)
    const originalCreateImageBitmap = Object.getOwnPropertyDescriptor(window, 'createImageBitmap')
    Object.defineProperty(window, 'createImageBitmap', {
      configurable: true,
      value: createImageBitmap,
    })

    const terminal = new Terminal({ cols: 80, rows: 3, scrollback: 100 })
    const imageAddon = new ImageAddon({
      iipSupport: true,
      sixelSupport: false,
      iipSizeLimit: 1024,
      pixelLimit: 1024,
    })
    terminal.loadAddon(imageAddon)

    try {
      const compatibilityReplay = [
        'history',
        'visible one',
        'visible two',
        `visible three${INLINE_IMAGE_COMPATIBILITY_REPLAY}`,
      ].join('\r\n')
      await new Promise<void>(resolve => terminal.write(compatibilityReplay, resolve))
      await vi.waitFor(() => expect(imageAddon.getImageAtBufferCell(13, 3)).toBeDefined())

      const portableSnapshot = [
        '\u001b[Hvisible one',
        '\u001b[2;1Hvisible two',
        '\u001b[3;1Hvisible three',
        '\u001b[3;14H',
      ].join('')
      await new Promise<void>(resolve => terminal.write(portableSnapshot, resolve))

      const transcript = Array.from(
        { length: terminal.buffer.active.length },
        (_, row) => terminal.buffer.active.getLine(row)?.translateToString(true) ?? '',
      ).filter(Boolean)
      expect(transcript).toEqual(['history', 'visible one', 'visible two', 'visible three'])
      expect(imageAddon.getImageAtBufferCell(13, 3)).toBeDefined()
      expect(terminal.buffer.active.cursorX).toBe(13)
      expect(terminal.buffer.active.cursorY).toBe(2)
    } finally {
      if (originalCreateImageBitmap) {
        Object.defineProperty(window, 'createImageBitmap', originalCreateImageBitmap)
      } else {
        Reflect.deleteProperty(window, 'createImageBitmap')
      }
      terminal.dispose()
    }
  })
})
