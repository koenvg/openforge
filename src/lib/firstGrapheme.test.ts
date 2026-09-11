import { describe, it, expect } from 'vitest'
import { firstGrapheme } from './firstGrapheme'

describe('firstGrapheme', () => {
  it('returns the first plain ASCII character', () => {
    expect(firstGrapheme('Prism')).toBe('P')
  })

  it('keeps a leading emoji intact instead of splitting its surrogate pair', () => {
    // 🌈 is a UTF-16 surrogate pair; charAt(0) would return a lone surrogate.
    expect(firstGrapheme('🌈prism')).toBe('🌈')
  })

  it('keeps a zero-width-joiner emoji sequence together', () => {
    expect(firstGrapheme('👨‍👩‍👧 family')).toBe('👨‍👩‍👧')
  })

  it('keeps a flag emoji together', () => {
    expect(firstGrapheme('🇮🇱 flag')).toBe('🇮🇱')
  })

  it('returns an empty string for an empty input', () => {
    expect(firstGrapheme('')).toBe('')
  })
})
