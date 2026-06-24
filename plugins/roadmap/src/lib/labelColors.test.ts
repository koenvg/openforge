import { describe, expect, it } from 'vitest'
import { LABEL_SWATCHES, normalizeLabelColor } from './labelColors'

describe('roadmap label color helpers', () => {
  it('offers GitHub label color presets without leading hashes', () => {
    expect(LABEL_SWATCHES).toHaveLength(16)
    expect(LABEL_SWATCHES).toContain('0e8a16')
    expect(LABEL_SWATCHES.every((hex) => /^[0-9a-f]{6}$/.test(hex))).toBe(true)
  })

  it('normalizes pasted colors to six lowercase hex digits', () => {
    expect(normalizeLabelColor('#0E8A16')).toBe('0e8a16')
    expect(normalizeLabelColor(' c5def5 ')).toBe('c5def5')
    expect(normalizeLabelColor('nothex')).toBeNull()
    expect(normalizeLabelColor('fff')).toBeNull()
  })
})
