import type { IDisposable, ITerminalAddon, Terminal } from '@xterm/xterm'
import {
  decodeInlineImageInBrowser,
  type DecodeInlineImage,
} from './browserInlineImageDecoder'
import {
  inspectInlineImagePayload,
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
} from './inlineImagePayload'

const ITERM_OSC_IDENTIFIER = 1337
const ITERM_SEQUENCE_PREFIX = '\u001b]1337;'
const ITERM_SEQUENCE_TERMINATOR = '\u0007'

export const INLINE_IMAGE_FALLBACK_TEXT = '\r\n[Image: invalid or unsupported inline image]\r\n'

interface InlineImageCompatibilityOptions {
  decodeImage?: DecodeInlineImage
  payloadLimitBytes?: number
  pixelLimit?: number
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
  const decodeImage = options.decodeImage ?? decodeInlineImageInBrowser
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
        const inspected = inspectInlineImagePayload(data, { payloadLimitBytes, pixelLimit })
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
