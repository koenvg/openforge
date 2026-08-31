import type { TerminalGeometry } from './terminalTransport'

const MIN_PTY_DIMENSION = 1
const MAX_PTY_DIMENSION = 0xFFFF

function isValidPtyDimension(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isInteger(value)
    && value >= MIN_PTY_DIMENSION
    && value <= MAX_PTY_DIMENSION
}

export function isValidTerminalDimensions(
  dimensions: { cols: unknown; rows: unknown } | null | undefined,
): dimensions is TerminalGeometry {
  return Boolean(dimensions)
    && isValidPtyDimension(dimensions?.cols)
    && isValidPtyDimension(dimensions?.rows)
}
