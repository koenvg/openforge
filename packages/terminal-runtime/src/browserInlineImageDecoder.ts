import type { SupportedInlineImageMime } from './inlineImagePayload'

export interface DecodedInlineImage {
  width: number
  height: number
  pngBytes?: Uint8Array
}

export type DecodeInlineImage = (
  bytes: Uint8Array,
  mimeType: SupportedInlineImageMime,
) => Promise<DecodedInlineImage>

function canvasToPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error('browser could not encode inline image as PNG'))
        return
      }
      blob.arrayBuffer()
        .then(buffer => resolve(new Uint8Array(buffer)))
        .catch(reject)
    }, 'image/png')
  })
}

async function renderImageAsPng(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<DecodedInlineImage> {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('browser canvas is unavailable')
  context.drawImage(source, 0, 0)
  return { width, height, pngBytes: await canvasToPng(canvas) }
}

async function decodeWithImageBitmap(blob: Blob, mimeType: SupportedInlineImageMime): Promise<DecodedInlineImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (mimeType !== 'image/webp') return { width: bitmap.width, height: bitmap.height }
    return renderImageAsPng(bitmap, bitmap.width, bitmap.height)
  } finally {
    bitmap.close()
  }
}

function loadHtmlImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const image = new Image()
    const timeout = window.setTimeout(() => finish(() => reject(new Error('inline image decode timed out'))), 1000)
    const finish = (callback: () => void) => {
      window.clearTimeout(timeout)
      URL.revokeObjectURL(url)
      callback()
    }
    image.addEventListener('load', () => finish(() => resolve(image)), { once: true })
    image.addEventListener('error', () => finish(() => reject(new Error('inline image decode failed'))), { once: true })
    image.src = url
  })
}

export async function decodeInlineImageInBrowser(
  bytes: Uint8Array,
  mimeType: SupportedInlineImageMime,
): Promise<DecodedInlineImage> {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType })
  if (typeof createImageBitmap === 'function') return decodeWithImageBitmap(blob, mimeType)

  const image = await loadHtmlImage(blob)
  if (mimeType !== 'image/webp') return { width: image.naturalWidth, height: image.naturalHeight }
  return renderImageAsPng(image, image.naturalWidth, image.naturalHeight)
}
