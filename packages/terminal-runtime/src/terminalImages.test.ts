import { describe, expect, it } from 'vitest'
import * as terminalImages from './terminalImages'
import type {
  DecodedInlineImage,
  DecodeInlineImage,
  TerminalImageProtocol,
} from './terminalImages'

describe('terminalImages public exports', () => {
  it('keeps the existing runtime export contract', () => {
    expect(Object.keys(terminalImages).sort()).toEqual([
      'INLINE_IMAGE_FALLBACK_TEXT',
      'TERMINAL_IMAGE_PAYLOAD_LIMIT_BYTES',
      'TERMINAL_IMAGE_PIXEL_LIMIT',
      'TERMINAL_IMAGE_STORAGE_LIMIT_MB',
      'createItermImageCompatibilityAddon',
    ])
  })

  it('keeps the existing image protocol and decoder types', async () => {
    const protocol: TerminalImageProtocol = 'iterm2'
    const decode: DecodeInlineImage = async () => ({ width: 1, height: 1 })
    const decoded: DecodedInlineImage = await decode(new Uint8Array(), 'image/png')

    expect(protocol).toBe('iterm2')
    expect(decoded).toEqual({ width: 1, height: 1 })
  })
})
