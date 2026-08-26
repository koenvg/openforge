import { describe, expect, it, vi } from 'vitest'
import { isValidTerminalDimensions, safeFit } from './terminalAttachment'
import type { PoolEntry } from './terminalRuntimeTypes'

function createEntry(dimensions: { cols: number; rows: number } | null): PoolEntry {
  return {
    view: { fit: vi.fn(() => dimensions) },
  } as unknown as PoolEntry
}

describe('terminal attachment sizing', () => {
  it('accepts positive integer terminal dimensions within the PTY u16 range', () => {
    expect(isValidTerminalDimensions({ cols: 1, rows: 1 })).toBe(true)
    expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true)
    expect(isValidTerminalDimensions({ cols: 65_535, rows: 65_535 })).toBe(true)
  })

  it.each([
    ['NaN', Number.NaN],
    ['positive infinity', Number.POSITIVE_INFINITY],
    ['negative infinity', Number.NEGATIVE_INFINITY],
    ['fractional', 1.5],
    ['zero', 0],
    ['negative', -1],
    ['above the PTY u16 range', 65_536],
  ])('rejects %s column and row counts', (_description, invalidDimension) => {
    expect(isValidTerminalDimensions({ cols: invalidDimension, rows: 24 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80, rows: invalidDimension })).toBe(false)
  })

  it('rejects incomplete and non-numeric terminal dimensions', () => {
    expect(isValidTerminalDimensions({ cols: 80, rows: undefined })).toBe(false)
    expect(isValidTerminalDimensions(undefined)).toBe(false)
  })

  it('delegates fitting to the renderer-neutral terminal view', () => {
    const measurable = createEntry({ cols: 80, rows: 24 })
    const unmeasurable = createEntry(null)

    expect(safeFit(measurable)).toBe(true)
    expect(measurable.view.fit).toHaveBeenCalledOnce()
    expect(safeFit(unmeasurable)).toBe(false)
  })
})
