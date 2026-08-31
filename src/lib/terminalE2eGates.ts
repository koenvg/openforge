export type TerminalE2eGateKind = 'acquisition' | 'authoritative-read'
export type TerminalE2eGateState = 'armed' | 'reached' | 'resumed' | 'cancelled' | 'timed-out'

export interface TerminalE2eGateSnapshot {
  id: string
  kind: TerminalE2eGateKind
  shellSessionKey: string
  state: TerminalE2eGateState
  armedAt: number
  reachedAt: number | null
  completedAt: number | null
  timeoutMs: number
  details: Record<string, unknown> | null
}

interface GateWaiter {
  state: TerminalE2eGateState
  resolve(snapshot: TerminalE2eGateSnapshot): void
  reject(error: Error): void
}

interface GateRecord extends TerminalE2eGateSnapshot {
  timer: ReturnType<typeof setTimeout> | null
  releaseCheckpoint: (() => void) | null
  rejectCheckpoint: ((error: Error) => void) | null
  waiters: Set<GateWaiter>
}

interface TerminalE2eGateCoordinatorOptions {
  createId?: () => string
  now?: () => number
  setTimer?: typeof setTimeout
  clearTimer?: typeof clearTimeout
  defaultTimeoutMs?: number
}

interface ArmGateOptions {
  timeoutMs?: number
}

function gateKey(kind: TerminalE2eGateKind, shellSessionKey: string): string {
  return `${kind}\0${shellSessionKey}`
}

function serializableDetails(details: Record<string, unknown> | undefined): Record<string, unknown> | null {
  if (details === undefined) return null
  try {
    return JSON.parse(JSON.stringify(details)) as Record<string, unknown>
  } catch {
    throw new Error('Terminal E2E gate details must be serializable')
  }
}

function snapshot(record: GateRecord): TerminalE2eGateSnapshot {
  return Object.freeze({
    id: record.id,
    kind: record.kind,
    shellSessionKey: record.shellSessionKey,
    state: record.state,
    armedAt: record.armedAt,
    reachedAt: record.reachedAt,
    completedAt: record.completedAt,
    timeoutMs: record.timeoutMs,
    details: record.details === null ? null : Object.freeze({ ...record.details }),
  })
}

export function createTerminalE2eGateCoordinator(options: TerminalE2eGateCoordinatorOptions = {}) {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? setTimeout
  const clearTimer = options.clearTimer ?? clearTimeout
  const defaultTimeoutMs = options.defaultTimeoutMs ?? 10_000
  const gates = new Map<string, GateRecord>()
  const pendingByCheckpoint = new Map<string, string>()

  function requireGate(id: string): GateRecord {
    const gate = gates.get(id)
    if (!gate) throw new Error(`Unknown terminal E2E gate: ${id}`)
    return gate
  }

  function notify(record: GateRecord): void {
    for (const waiter of [...record.waiters]) {
      if (waiter.state !== record.state) continue
      record.waiters.delete(waiter)
      waiter.resolve(snapshot(record))
    }
  }

  function complete(record: GateRecord, state: 'resumed' | 'cancelled' | 'timed-out'): void {
    record.state = state
    record.completedAt = now()
    if (record.timer !== null) clearTimer(record.timer)
    record.timer = null
    pendingByCheckpoint.delete(gateKey(record.kind, record.shellSessionKey))
    notify(record)
  }

  function arm(kind: TerminalE2eGateKind, shellSessionKey: string, armOptions: ArmGateOptions = {}): TerminalE2eGateSnapshot {
    if (!shellSessionKey) throw new Error('Terminal E2E gate requires a shell session key')
    const checkpointKey = gateKey(kind, shellSessionKey)
    if (pendingByCheckpoint.has(checkpointKey)) {
      throw new Error(`A pending ${kind} gate already exists for ${shellSessionKey}`)
    }
    const timeoutMs = armOptions.timeoutMs ?? defaultTimeoutMs
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Terminal E2E gate timeout must be positive')
    }
    const record: GateRecord = {
      id: createId(),
      kind,
      shellSessionKey,
      state: 'armed',
      armedAt: now(),
      reachedAt: null,
      completedAt: null,
      timeoutMs,
      details: null,
      timer: null,
      releaseCheckpoint: null,
      rejectCheckpoint: null,
      waiters: new Set(),
    }
    if (gates.has(record.id)) throw new Error(`Duplicate terminal E2E gate ID: ${record.id}`)
    gates.set(record.id, record)
    pendingByCheckpoint.set(checkpointKey, record.id)
    return snapshot(record)
  }

  async function checkpoint(
    kind: TerminalE2eGateKind,
    shellSessionKey: string,
    details?: Record<string, unknown>,
  ): Promise<void> {
    const id = pendingByCheckpoint.get(gateKey(kind, shellSessionKey))
    if (!id) return
    const record = requireGate(id)
    if (record.state !== 'armed') return
    record.state = 'reached'
    record.reachedAt = now()
    record.details = serializableDetails(details)
    const pending = new Promise<void>((resolvePromise, rejectPromise) => {
      record.releaseCheckpoint = resolvePromise
      record.rejectCheckpoint = rejectPromise
    })
    record.timer = setTimer(() => {
      if (record.state !== 'reached') return
      const error = new Error(`Terminal E2E gate ${record.id} timed out`)
      complete(record, 'timed-out')
      record.rejectCheckpoint?.(error)
      record.releaseCheckpoint = null
      record.rejectCheckpoint = null
    }, record.timeoutMs)
    notify(record)
    return pending
  }

  function resume(id: string): void {
    const record = requireGate(id)
    if (record.state !== 'reached') {
      throw new Error(`Terminal E2E gate ${id} cannot resume from ${record.state}`)
    }
    complete(record, 'resumed')
    record.releaseCheckpoint?.()
    record.releaseCheckpoint = null
    record.rejectCheckpoint = null
  }

  function cancel(id: string): void {
    const record = requireGate(id)
    if (record.state !== 'armed' && record.state !== 'reached') {
      throw new Error(`Terminal E2E gate ${id} cannot cancel from ${record.state}`)
    }
    complete(record, 'cancelled')
    record.releaseCheckpoint?.()
    record.releaseCheckpoint = null
    record.rejectCheckpoint = null
  }

  function get(id: string): TerminalE2eGateSnapshot {
    return snapshot(requireGate(id))
  }

  function list(): TerminalE2eGateSnapshot[] {
    return [...gates.values()].map(snapshot)
  }

  function waitForState(id: string, state: TerminalE2eGateState): Promise<TerminalE2eGateSnapshot> {
    const record = requireGate(id)
    if (record.state === state) return Promise.resolve(snapshot(record))
    if (['resumed', 'cancelled', 'timed-out'].includes(record.state)) {
      return Promise.reject(new Error(`Terminal E2E gate ${id} completed as ${record.state} before reaching ${state}`))
    }
    return new Promise((resolvePromise, rejectPromise) => {
      record.waiters.add({ state, resolve: resolvePromise, reject: rejectPromise })
    })
  }

  return Object.freeze({ arm, cancel, checkpoint, get, list, resume, waitForState })
}

export type TerminalE2eGateCoordinator = ReturnType<typeof createTerminalE2eGateCoordinator>
