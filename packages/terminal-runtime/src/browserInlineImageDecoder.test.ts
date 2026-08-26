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

  it('converts WebP data through the HTML image fallback', async () => {
    vi.stubGlobal('createImageBitmap', undefined)
    const createObjectURL = vi.fn(() => 'blob:inline-image')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL })

    let loadedImage: HTMLImageElement | undefined
    class LoadedImage {
      naturalWidth = 5
      naturalHeight = 6
      private loadListener?: EventListener

      constructor() {
        loadedImage = this as unknown as HTMLImageElement
      }

      addEventListener(type: string, listener: EventListener) {
        if (type === 'load') this.loadListener = listener
      }

      set src(value: string) {
        expect(value).toBe('blob:inline-image')
        queueMicrotask(() => this.loadListener?.(new Event('load')))
      }
    }
    vi.stubGlobal('Image', LoadedImage)

    const pngBytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47])
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

    await expect(decodeInlineImageInBrowser(new Uint8Array([7, 8, 9]), 'image/webp')).resolves.toEqual({
      width: 5,
      height: 6,
      pngBytes,
    })
    expect(canvas.width).toBe(5)
    expect(canvas.height).toBe(6)
    expect(drawImage).toHaveBeenCalledWith(loadedImage, 0, 0)
    expect(createObjectURL).toHaveBeenCalledOnce()
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:inline-image')
  })
})
