import { parsePtySessionKey } from './ptySessionKey'

export const TERMINAL_PERFORMANCE_PHASES = [
  'lifecycleStart',
  'terminalAttachment',
  'xtermMount',
  'shellSpawnRequest',
  'ptyCreation',
  'inputAcceptance',
  'firstOutput',
  'modelPublication',
  'xtermParse',
  'renderCallback',
  'presentationProof',
] as const

export type TerminalPerformancePhase = typeof TERMINAL_PERFORMANCE_PHASES[number]

export interface TerminalPerformanceMarkContext {
  terminalKey: string
  ptyInstanceId?: number | null
  writeGeneration?: number
}

export interface TerminalPerformanceTraceSnapshot {
  clockDomain: 'renderer-performance'
  terminalKey: string | null
  ptyInstanceId: number | null
  timestamps: Partial<Record<TerminalPerformancePhase, number>>
}

export interface TerminalPerformanceTrace {
  start(): void
  mark(phase: TerminalPerformancePhase, context: TerminalPerformanceMarkContext): void
  recordWrite(context: Required<Pick<TerminalPerformanceMarkContext, 'terminalKey' | 'ptyInstanceId' | 'writeGeneration'>>): void
  finish(): TerminalPerformanceTraceSnapshot | null
  snapshot(): TerminalPerformanceTraceSnapshot | null
}

interface ActiveTrace {
  terminalKey: string | null
  ptyInstanceId: number | null
  writeGeneration: number | null
  timestamps: Partial<Record<TerminalPerformancePhase, number>>
}

const PTY_PHASES = new Set<TerminalPerformancePhase>([
  'inputAcceptance',
  'firstOutput',
  'modelPublication',
])
const PRESENTATION_PHASES = new Set<TerminalPerformancePhase>([
  'xtermParse',
  'renderCallback',
  'presentationProof',
])

function copySnapshot(trace: ActiveTrace): TerminalPerformanceTraceSnapshot {
  return {
    clockDomain: 'renderer-performance',
    terminalKey: trace.terminalKey,
    ptyInstanceId: trace.ptyInstanceId,
    timestamps: { ...trace.timestamps },
  }
}

export function createTerminalPerformanceTrace({
  now = performance.now.bind(performance),
}: { now?: () => number } = {}): TerminalPerformanceTrace {
  let active: ActiveTrace | null = null
  let completed: TerminalPerformanceTraceSnapshot | null = null

  function acceptsContext(phase: TerminalPerformancePhase, context: TerminalPerformanceMarkContext): boolean {
    if (!active) return false
    if (active.terminalKey === null) {
      if (phase !== 'terminalAttachment') return false
      if (parsePtySessionKey(context.terminalKey).kind !== 'indexed-shell') return false
      active.terminalKey = context.terminalKey
    }
    if (active.terminalKey !== context.terminalKey) return false

    if (phase === 'ptyCreation') {
      if (context.ptyInstanceId === null || context.ptyInstanceId === undefined) return false
      if (active.ptyInstanceId === null) active.ptyInstanceId = context.ptyInstanceId
      return active.ptyInstanceId === context.ptyInstanceId
    }
    if (PTY_PHASES.has(phase)) {
      if (active.ptyInstanceId === null || context.ptyInstanceId !== active.ptyInstanceId) return false
    }
    if (phase === 'firstOutput' && active.timestamps.inputAcceptance === undefined) return false
    if (phase === 'modelPublication' && active.timestamps.firstOutput === undefined) return false
    if (PRESENTATION_PHASES.has(phase)) {
      if (active.writeGeneration === null || context.writeGeneration === undefined) return false
      if (context.writeGeneration < active.writeGeneration) return false
    }
    if (phase === 'renderCallback' && active.timestamps.xtermParse === undefined) return false
    if (phase === 'presentationProof' && active.timestamps.renderCallback === undefined) return false
    return true
  }

  return {
    start() {
      active = {
        terminalKey: null,
        ptyInstanceId: null,
        writeGeneration: null,
        timestamps: { lifecycleStart: now() },
      }
      completed = null
    },
    mark(phase, context) {
      if (!active || active.timestamps[phase] !== undefined) return
      if (!acceptsContext(phase, context)) return
      active.timestamps[phase] = now()
    },
    recordWrite(context) {
      if (!active
        || active.writeGeneration !== null
        || active.timestamps.modelPublication === undefined
        || active.terminalKey !== context.terminalKey
        || active.ptyInstanceId !== context.ptyInstanceId) return
      active.writeGeneration = context.writeGeneration
    },
    finish() {
      if (!active) return completed && {
        ...completed,
        timestamps: { ...completed.timestamps },
      }
      completed = copySnapshot(active)
      active = null
      return copySnapshot({ ...completed, writeGeneration: null })
    },
    snapshot() {
      if (active) return copySnapshot(active)
      return completed && {
        ...completed,
        timestamps: { ...completed.timestamps },
      }
    },
  }
}
