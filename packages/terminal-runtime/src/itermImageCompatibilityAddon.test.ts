import type { Terminal } from '@xterm/xterm'
import { describe, expect, it, vi } from 'vitest'
import type { DecodeInlineImage } from './browserInlineImageDecoder'
import {
  INLINE_IMAGE_FALLBACK_TEXT,
  createItermImageCompatibilityAddon,
} from './itermImageCompatibilityAddon'

const ONE_PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

function onePixelWebp(): Uint8Array {
  const bytes = new Uint8Array(30)
  bytes.set(Buffer.from('RIFF'), 0)
  bytes.set(Buffer.from('WEBP'), 8)
  bytes.set(Buffer.from('VP8X'), 12)
  // VP8X stores width - 1 and height - 1 as little-endian 24-bit values.
  bytes[24] = 0
  bytes[27] = 0
  return bytes
}

function createHarness(decodeImage: DecodeInlineImage) {
  let handler: ((data: string) => boolean | Promise<boolean>) | null = null
  let parserBusy = false
  const writesWhileParserBusy: string[] = []
  const parserDisposable = { dispose: vi.fn() }
  const terminal = {
    parser: {
      registerOscHandler: vi.fn((_ident: number, callback: typeof handler) => {
        handler = callback
        return parserDisposable
      }),
    },
    write: vi.fn((data: string) => {
      if (parserBusy) writesWhileParserBusy.push(data)
    }),
  } as unknown as Terminal
  const addon = createItermImageCompatibilityAddon({ decodeImage })
  addon.activate(terminal)

  return {
    addon,
    parserDisposable,
    terminal,
    writesWhileParserBusy,
    handle: async (data: string) => {
      if (!handler) throw new Error('OSC handler was not registered')
      parserBusy = true
      const handled = await handler(data)
      parserBusy = false
      await new Promise<void>(resolve => setTimeout(resolve, 0))
      return handled
    },
  }
}

describe('iTerm inline image compatibility', () => {
  it('suppresses invalid payloads and writes a readable fallback', async () => {
    const decodeImage = vi.fn<DecodeInlineImage>()
    const harness = createHarness(decodeImage)

    await expect(harness.handle('File=size=4;inline=1:!!!!')).resolves.toBe(true)

    expect(decodeImage).not.toHaveBeenCalled()
    expect(harness.writesWhileParserBusy).toEqual([])
    expect(harness.terminal.write).toHaveBeenCalledWith(INLINE_IMAGE_FALLBACK_TEXT)
  })

  it('passes validated PNG data to the image addon handler', async () => {
    const decodeImage = vi.fn<DecodeInlineImage>().mockResolvedValue({ width: 1, height: 1 })
    const harness = createHarness(decodeImage)
    const payload = toBase64(ONE_PIXEL_PNG)

    const handled = await harness.handle(`File=size=${ONE_PIXEL_PNG.length};inline=1:${payload}`)

    expect(decodeImage).toHaveBeenCalledOnce()
    expect(handled).toBe(false)
    expect(harness.terminal.write).not.toHaveBeenCalled()
  })

  it('accepts current Pi sequences with inline as the first File parameter', async () => {
    const decodeImage = vi.fn<DecodeInlineImage>().mockResolvedValue({ width: 1, height: 1 })
    const harness = createHarness(decodeImage)
    const payload = toBase64(ONE_PIXEL_PNG)
    const handled = await harness.handle(`File=inline=1;size=${ONE_PIXEL_PNG.length}:${payload}`)
    expect(decodeImage).toHaveBeenCalledOnce()
    expect(handled).toBe(false)
    expect(harness.terminal.write).not.toHaveBeenCalled()
  })

  it('converts WebP data to an in-memory PNG sequence before xterm renders it', async () => {
    const decodeImage = vi.fn<DecodeInlineImage>().mockResolvedValue({
      width: 1,
      height: 1,
      pngBytes: ONE_PIXEL_PNG,
    })
    const harness = createHarness(decodeImage)
    const webp = onePixelWebp()

    const handled = await harness.handle(`File=size=${webp.length};inline=1:${toBase64(webp)}`)

    expect(decodeImage).toHaveBeenCalledOnce()
    expect(handled).toBe(true)
    expect(harness.writesWhileParserBusy).toEqual([])
    expect(harness.terminal.write).toHaveBeenCalledWith(
      `\u001b]1337;File=size=${ONE_PIXEL_PNG.length};inline=1:${toBase64(ONE_PIXEL_PNG)}\u0007`,
    )
  })

  it('disposes its OSC handler with the terminal addon lifecycle', () => {
    const harness = createHarness(vi.fn<DecodeInlineImage>())

    harness.addon.dispose()

    expect(harness.parserDisposable.dispose).toHaveBeenCalledOnce()
  })
})
