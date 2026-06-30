import { describe, it, expect } from 'vitest'
import { normalizeLabelColor, labelChipStyle } from './labelColors'

describe('normalizeLabelColor', () => {
  it('returns lowercase hex for a valid 6-digit color', () => {
    expect(normalizeLabelColor('B60205')).toBe('b60205')
  })

  it('strips a leading # and surrounding whitespace', () => {
    expect(normalizeLabelColor('  #D73A4A ')).toBe('d73a4a')
  })

  it('returns null for non-hex or wrong-length values', () => {
    expect(normalizeLabelColor('')).toBeNull()
    expect(normalizeLabelColor('xyz')).toBeNull()
    expect(normalizeLabelColor('fff')).toBeNull()
    expect(normalizeLabelColor('1234567')).toBeNull()
  })
})

describe('labelChipStyle', () => {
  it('builds an inline style from a valid color', () => {
    expect(labelChipStyle('b60205')).toBe('background-color: #b6020533; border-color: #b60205;')
  })

  it('returns an empty string for invalid colors so callers can fall back', () => {
    expect(labelChipStyle('')).toBe('')
    expect(labelChipStyle('not-a-color')).toBe('')
  })
})
