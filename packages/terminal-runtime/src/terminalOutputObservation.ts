import type { TerminalViewData } from './terminalView'

export interface TerminalOutputObservation {
  ptyInstanceId: number | null
  receivedBytes: number
  firstSequence: number | null
  lastSequence: number | null
  sequenceContinuous: boolean
}

export interface ObservedTerminalOutput {
  data: TerminalViewData
  ptyInstanceId: number
  startSequence: number
  sequence: number
}

export function createTerminalOutputObservation(
  ptyInstanceId: number | null = null,
): TerminalOutputObservation {
  return {
    ptyInstanceId,
    receivedBytes: 0,
    firstSequence: null,
    lastSequence: null,
    sequenceContinuous: true,
  }
}

function resetObservation(
  observation: TerminalOutputObservation,
  ptyInstanceId: number | null,
): void {
  observation.ptyInstanceId = ptyInstanceId
  observation.receivedBytes = 0
  observation.firstSequence = null
  observation.lastSequence = null
  observation.sequenceContinuous = true
}

export function synchronizeTerminalOutputObservation(
  observation: TerminalOutputObservation,
  ptyInstanceId: number | null,
  watermark: number | null = null,
): void {
  if (observation.ptyInstanceId !== ptyInstanceId) {
    resetObservation(observation, ptyInstanceId)
  }
  if (watermark !== null) {
    observation.lastSequence = Math.max(observation.lastSequence ?? watermark, watermark)
  }
}

function terminalDataByteLength(data: TerminalViewData): number {
  return typeof data === 'string' ? new TextEncoder().encode(data).byteLength : data.byteLength
}

export function recordTerminalOutput(
  observation: TerminalOutputObservation,
  output: ObservedTerminalOutput,
): void {
  if (observation.ptyInstanceId !== output.ptyInstanceId) return
  if (observation.lastSequence !== null && output.sequence <= observation.lastSequence) return

  // An authority snapshot can overlap a coalesced live event; only a forward gap loses coverage.
  if (observation.lastSequence !== null && output.startSequence > observation.lastSequence + 1) {
    observation.sequenceContinuous = false
  }
  observation.receivedBytes += terminalDataByteLength(output.data)
  observation.firstSequence ??= output.startSequence
  observation.lastSequence = output.sequence
}
