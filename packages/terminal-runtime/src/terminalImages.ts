export type TerminalImageProtocol = 'iterm2'

export const TERMINAL_IMAGE_STORAGE_LIMIT_MB = 32

export {
  TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES,
  TERMINAL_IMAGE_PIXEL_LIMIT,
} from './inlineImagePayload'
export {
  INLINE_IMAGE_FALLBACK_TEXT,
  createItermImageCompatibilityAddon,
} from './itermImageCompatibilityAddon'
export type {
  DecodedInlineImage,
  DecodeInlineImage,
} from './browserInlineImageDecoder'
