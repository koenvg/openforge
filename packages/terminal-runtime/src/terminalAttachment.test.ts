import { describe, expect, it, vi } from 'vitest'
import { isValidTerminalDimensions, safeFit } from './terminalAttachment'
import type { PoolEntry } from './terminalRuntimeTypes'

vi.mock('./terminalRendering', () => ({ loadWebglAddon: vi.fn() }))

function createEntry(dimensions: { cols: number; rows: number } | undefined): PoolEntry {
  return {
    hostDiv: { clientWidth: 800, clientHeight: 500 },
    fitAddon: {
      proposeDimensions: vi.fn(() => dimensions),
      fit: vi.fn(),
    },
  } as unknown as PoolEntry
}

describe('terminal attachment sizing', () => {
  it('accepts numeric terminal dimensions and rejects incomplete measurements', () => {
    expect(isValidTerminalDimensions({ cols: 80, rows: 24 })).toBe(true)
    expect(isValidTerminalDimensions({ cols: Number.NaN, rows: 24 })).toBe(false)
    expect(isValidTerminalDimensions({ cols: 80, rows: undefined })).toBe(false)
    expect(isValidTerminalDimensions(undefined)).toBe(false)
  })

  it('fits only when the host and proposed dimensions are measurable', () => {
    const measurable = createEntry({ cols: 80, rows: 24 })
    const unmeasurable = createEntry(undefined)
    const hidden = createEntry({ cols: 80, rows: 24 })
    Object.defineProperty(hidden.hostDiv, 'clientWidth', { value: 0 })

    expect(safeFit(measurable)).toBe(true)
    expect(measurable.fitAddon.fit).toHaveBeenCalledOnce()
    expect(safeFit(unmeasurable)).toBe(false)
    expect(safeFit(hidden)).toBe(false)
  })
})
