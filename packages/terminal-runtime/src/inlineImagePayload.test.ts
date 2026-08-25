import { describe, expect, it } from 'vitest'
import { inspectInlineImagePayload } from './inlineImagePayload'

const ONE_PIXEL_PNG = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
])

function inlinePayload(bytes: Uint8Array, header = `File=size=${bytes.length};inline=1`): string {
  return `${header}:${Buffer.from(bytes).toString('base64')}`
}

describe('inline image payload inspection', () => {
  it('returns validated bytes, metadata, and the original iTerm header', () => {
    const inspected = inspectInlineImagePayload(
      inlinePayload(ONE_PIXEL_PNG),
      { payloadLimitBytes: ONE_PIXEL_PNG.length, pixelLimit: 2 },
    )

    expect(inspected).toEqual({
      bytes: ONE_PIXEL_PNG,
      header: `File=size=${ONE_PIXEL_PNG.length};inline=1`,
      height: 1,
      mimeType: 'image/png',
      width: 1,
    })
  })

  it.each([
    ['invalid base64', `File=size=4;inline=1:!!!!`],
    ['a mismatched declared size', inlinePayload(ONE_PIXEL_PNG, 'File=size=23;inline=1')],
    ['a non-inline image', inlinePayload(ONE_PIXEL_PNG, `File=size=${ONE_PIXEL_PNG.length}`)],
  ])('rejects %s', (_description, payload) => {
    expect(inspectInlineImagePayload(payload, { payloadLimitBytes: 100, pixelLimit: 2 })).toBeNull()
  })

  it('rejects images at the configured pixel limit', () => {
    expect(inspectInlineImagePayload(
      inlinePayload(ONE_PIXEL_PNG),
      { payloadLimitBytes: ONE_PIXEL_PNG.length, pixelLimit: 1 },
    )).toBeNull()
  })
})
