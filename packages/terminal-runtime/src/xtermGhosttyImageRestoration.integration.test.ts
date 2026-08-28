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
})
