import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'

export type TerminalImageProtocol = 'iterm2'

export const TERMINAL_IMAGE_PIXEL_LIMIT = 12_000_000
export const TERMINAL_IMAGE_STORAGE_LIMIT_MB = 32
// Six raw MiB expand to eight MiB of base64, below xterm's 10 MB OSC parser cap.
export const TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES = 6 * 1024 * 1024
export const INLINE_IMAGE_FALLBACK_TEXT = '\r\n[Image: invalid or unsupported inline image]\r\n'

const ITERM_OSC_IDENTIFIER = 1337
const ITERM_SEQUENCE_PREFIX = '\u001b]1337;'
const ITERM_SEQUENCE_TERMINATOR = '\u0007'

type SupportedInlineImageMime = 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'

export interface DecodedInlineImage {
  width: number
  height: number
  pngBytes?: Uint8Array
}

export type DecodeInlineImage = (
  bytes: Uint8Array,
  mimeType: SupportedInlineImageMime,
) => Promise<DecodedInlineImage>

interface InlineImageCompatibilityOptions {
  decodeImage?: DecodeInlineImage
  payloadLimitBytes?: number
  pixelLimit?: number
}

interface InspectedImage {
  bytes: Uint8Array
  header: string
  height: number
  mimeType: SupportedInlineImageMime
  width: number
}

function readBigEndian32(bytes: Uint8Array, offset: number): number {
  return (
    bytes[offset] * 0x1000000
    + bytes[offset + 1] * 0x10000
    + bytes[offset + 2] * 0x100
    + bytes[offset + 3]
  )
}

function readLittleEndian16(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readLittleEndian24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

function asciiAt(bytes: Uint8Array, offset: number, value: string): boolean {
  if (offset + value.length > bytes.length) return false
  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    const marker = bytes[offset + 1]
    offset += 2
    if (marker === 0xd8 || marker === 0xd9) continue
    if (offset + 2 > bytes.length) return null
    const segmentLength = (bytes[offset] << 8) | bytes[offset + 1]
    if (segmentLength < 2 || offset + segmentLength > bytes.length) return null
    if (marker === 0xc0 || marker === 0xc2) {
      return {
        height: (bytes[offset + 3] << 8) | bytes[offset + 4],
        width: (bytes[offset + 5] << 8) | bytes[offset + 6],
      }
    }
    offset += segmentLength
  }
  return null
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30 || !asciiAt(bytes, 0, 'RIFF') || !asciiAt(bytes, 8, 'WEBP')) return null
  if (asciiAt(bytes, 12, 'VP8X')) {
    return {
      width: readLittleEndian24(bytes, 24) + 1,
      height: readLittleEndian24(bytes, 27) + 1,
    }
  }
  if (asciiAt(bytes, 12, 'VP8 ') && bytes.length >= 30) {
    return {
      width: readLittleEndian16(bytes, 26) & 0x3fff,
      height: readLittleEndian16(bytes, 28) & 0x3fff,
    }
  }
  if (asciiAt(bytes, 12, 'VP8L') && bytes.length >= 25 && bytes[20] === 0x2f) {
    const width = 1 + ((bytes[21] | (bytes[22] << 8)) & 0x3fff)
    const height = 1 + (((bytes[22] >> 6) | (bytes[23] << 2) | (bytes[24] << 10)) & 0x3fff)
    return { width, height }
  }
  return null
}

function imageMetrics(bytes: Uint8Array): { mimeType: SupportedInlineImageMime; width: number; height: number } | null {
  if (bytes.length >= 24 && asciiAt(bytes, 1, 'PNG') && bytes[0] === 0x89) {
    return { mimeType: 'image/png', width: readBigEndian32(bytes, 16), height: readBigEndian32(bytes, 20) }
  }
  if (bytes.length >= 10 && asciiAt(bytes, 0, 'GIF8')) {
    return { mimeType: 'image/gif', width: readLittleEndian16(bytes, 6), height: readLittleEndian16(bytes, 8) }
  }
  if (bytes.length >= 11 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    const dimensions = jpegDimensions(bytes)
    return dimensions ? { mimeType: 'image/jpeg', ...dimensions } : null
  }
  const dimensions = webpDimensions(bytes)
  return dimensions ? { mimeType: 'image/webp', ...dimensions } : null
}

function decodeBase64(payload: string, payloadLimitBytes: number): Uint8Array | null {
  if (!payload || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload)) {
    return null
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const decodedLength = (payload.length / 4) * 3 - padding
  if (decodedLength > payloadLimitBytes) return null

  try {
    const decoded = atob(payload)
    const bytes = new Uint8Array(decoded.length)
    for (let index = 0; index < decoded.length; index += 1) bytes[index] = decoded.charCodeAt(index)
    return bytes
  } catch {
    return null
  }
}

function inspectImage(data: string, payloadLimitBytes: number, pixelLimit: number): InspectedImage | null {
  const separatorIndex = data.indexOf(':')
  if (separatorIndex < 0) return null
  const header = data.slice(0, separatorIndex)
  const fields = header.split(';')
  if (!fields.some(field => field === 'inline=1')) return null

  const sizeField = fields.find(field => field.startsWith('File=size=') || field.startsWith('size='))
  const sizePrefix = sizeField?.startsWith('File=') ? 'File=size=' : 'size='
  const declaredSize = sizeField ? Number(sizeField.slice(sizePrefix.length)) : Number.NaN
  if (!Number.isSafeInteger(declaredSize) || declaredSize < 1 || declaredSize > payloadLimitBytes) return null

  const bytes = decodeBase64(data.slice(separatorIndex + 1), payloadLimitBytes)
  if (!bytes || bytes.length !== declaredSize) return null
  const metrics = imageMetrics(bytes)
  if (!metrics || metrics.width < 1 || metrics.height < 1 || metrics.width * metrics.height >= pixelLimit) return null
  return { bytes, header, ...metrics }
}

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

async function decodeWithImageBitmap(blob: Blob, mimeType: SupportedInlineImageMime): Promise<DecodedInlineImage> {
  const bitmap = await createImageBitmap(blob)
  try {
    if (mimeType !== 'image/webp') return { width: bitmap.width, height: bitmap.height }
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const context = canvas.getContext('2d')
    if (!context) throw new Error('browser canvas is unavailable')
    context.drawImage(bitmap, 0, 0)
    return { width: bitmap.width, height: bitmap.height, pngBytes: await canvasToPng(canvas) }
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

async function defaultDecodeInlineImage(bytes: Uint8Array, mimeType: SupportedInlineImageMime): Promise<DecodedInlineImage> {
  const blob = new Blob([bytes.slice().buffer], { type: mimeType })
  if (typeof createImageBitmap === 'function') return decodeWithImageBitmap(blob, mimeType)

  const image = await loadHtmlImage(blob)
  if (mimeType !== 'image/webp') return { width: image.naturalWidth, height: image.naturalHeight }
  const canvas = document.createElement('canvas')
  canvas.width = image.naturalWidth
  canvas.height = image.naturalHeight
  const context = canvas.getContext('2d')
  if (!context) throw new Error('browser canvas is unavailable')
  context.drawImage(image, 0, 0)
  return { width: image.naturalWidth, height: image.naturalHeight, pngBytes: await canvasToPng(canvas) }
}

function replaceDeclaredSize(header: string, byteLength: number): string {
  return header
    .split(';')
    .map((field) => {
      if (field.startsWith('File=size=')) return `File=size=${byteLength}`
      if (field.startsWith('size=')) return `size=${byteLength}`
      return field
    })
    .join(';')
}

function encodeBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

export function createItermImageCompatibilityAddon(options: InlineImageCompatibilityOptions = {}): ITerminalAddon {
  const decodeImage = options.decodeImage ?? defaultDecodeInlineImage
  const payloadLimitBytes = options.payloadLimitBytes ?? TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES
  const pixelLimit = options.pixelLimit ?? TERMINAL_IMAGE_PIXEL_LIMIT
  let terminal: Terminal | null = null
  let parserDisposable: IDisposable | null = null

  const queueWrite = (data: string) => {
    const target = terminal
    setTimeout(() => {
      if (terminal === target) target?.write(data)
    }, 0)
  }

  return {
    activate(targetTerminal) {
      terminal = targetTerminal
      parserDisposable = targetTerminal.parser.registerOscHandler(ITERM_OSC_IDENTIFIER, async (data) => {
        if (!data.startsWith('File=')) return false
        const inspected = inspectImage(data, payloadLimitBytes, pixelLimit)
        if (!inspected) {
          queueWrite(INLINE_IMAGE_FALLBACK_TEXT)
          return true
        }

        try {
          const decoded = await decodeImage(inspected.bytes, inspected.mimeType)
          if (
            decoded.width < 1
            || decoded.height < 1
            || decoded.width * decoded.height >= pixelLimit
          ) {
            throw new Error('decoded inline image exceeds pixel limit')
          }
          if (inspected.mimeType !== 'image/webp') return false
          if (!decoded.pngBytes || decoded.pngBytes.length > payloadLimitBytes) {
            throw new Error('WebP conversion did not produce a bounded PNG')
          }

          const pngHeader = replaceDeclaredSize(inspected.header, decoded.pngBytes.length)
          queueWrite(`${ITERM_SEQUENCE_PREFIX}${pngHeader}:${encodeBase64(decoded.pngBytes)}${ITERM_SEQUENCE_TERMINATOR}`)
          return true
        } catch {
          queueWrite(INLINE_IMAGE_FALLBACK_TEXT)
          return true
        }
      })
    },
    dispose() {
      parserDisposable?.dispose()
      parserDisposable = null
      terminal = null
    },
  }
}
