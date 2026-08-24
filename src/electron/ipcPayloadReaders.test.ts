import { describe, expect, it } from 'vitest'
import { payloadNumber, payloadString } from './ipcPayloadReaders'

describe('IPC payload readers', () => {
  it('returns non-blank string fields without changing their value', () => {
    expect(payloadString({ path: '  /repo  ' }, 'path')).toBe('  /repo  ')
  })

  it('rejects missing, blank, and non-string fields', () => {
    expect(payloadString(null, 'path')).toBeNull()
    expect(payloadString({}, 'path')).toBeNull()
    expect(payloadString({ path: '   ' }, 'path')).toBeNull()
    expect(payloadString({ path: 42 }, 'path')).toBeNull()
  })

  it('returns finite numeric fields', () => {
    expect(payloadNumber({ limit: 0 }, 'limit')).toBe(0)
    expect(payloadNumber({ limit: 42.5 }, 'limit')).toBe(42.5)
  })

  it('rejects missing, non-numeric, and non-finite fields', () => {
    expect(payloadNumber(null, 'limit')).toBeUndefined()
    expect(payloadNumber({}, 'limit')).toBeUndefined()
    expect(payloadNumber({ limit: '42' }, 'limit')).toBeUndefined()
    expect(payloadNumber({ limit: Number.NaN }, 'limit')).toBeUndefined()
    expect(payloadNumber({ limit: Number.POSITIVE_INFINITY }, 'limit')).toBeUndefined()
  })
})
