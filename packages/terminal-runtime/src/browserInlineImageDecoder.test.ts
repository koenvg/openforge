import { afterEach, describe, expect, it, vi } from 'vitest'
import { decodeInlineImageInBrowser } from './browserInlineImageDecoder'

describe('browser inline image decoding', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reports browser-decoded dimensions and releases the bitmap', async () => {
    const close = vi.fn()
    const createBitmap = vi.fn().mockResolvedValue({ width: 3, height: 2, close })
    vi.stubGlobal('createImageBitmap', createBitmap)

    await expect(decodeInlineImageInBrowser(new Uint8Array([1, 2, 3]), 'image/png')).resolves.toEqual({
      width: 3,
      height: 2,
    })
    expect(createBitmap).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('converts browser-decoded WebP data to PNG bytes', async () => {
    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
    const close = vi.fn()
    const bitmap = { width: 2, height: 4, close }
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap))

    const drawImage = vi.fn()
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage })),
      toBlob: vi.fn((callback: BlobCallback, mimeType: string) => {
        expect(mimeType).toBe('image/png')
        callback({ arrayBuffer: async () => pngBytes.slice().buffer } as Blob)
      }),
    } as unknown as HTMLCanvasElement
    vi.spyOn(document, 'createElement').mockReturnValue(canvas)

    await expect(decodeInlineImageInBrowser(new Uint8Array([4, 5, 6]), 'image/webp')).resolves.toEqual({
      width: 2,
      height: 4,
      pngBytes,
    })
    expect(canvas.width).toBe(2)
    expect(canvas.height).toBe(4)
    expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0)
    expect(close).toHaveBeenCalledOnce()
  })
})
