import { describe, expect, it, vi } from 'vitest'
import { isValidTerminalDimensions, safeFit } from './terminalAttachment'
import type { PoolEntry } from './terminalRuntimeTypes'

function createEntry(dimensions: { cols: number; rows: number } | null): PoolEntry {
  return {
    view: { fit: vi.fn(() => dimensions) },
  } as unknown as PoolEntry
}

describe('terminal attachment sizing', () => {
  it('accepts numeric terminal dimensions and rejects incomplete measurements', () => {
    expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true)
    expect(isValidTerminalDimensions({ cols: Number.NaN, rows: 24 })).toBe(false)
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
