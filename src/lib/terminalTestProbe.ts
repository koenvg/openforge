import type {
  PoolEntry,
  LiveModelOutputSubscriptionSnapshot,
  TerminalViewPresentationEvidence,
} from '@openforge-app/terminal-runtime'
import { getTerminalEntriesForObservation } from './terminalPool'
import { createTerminalE2eGateCoordinator, type TerminalE2eGateCoordinator } from './terminalE2eGates'
import {
  configureTerminalE2eRuntime,
  getAcquiredTerminalForE2eDiagnostics,
} from './terminalE2eRuntime'
import { emitTerminalFixtureOutput, type E2eTerminalFixtureOutputReceipt } from './ipc'

const E2E_TOKEN_QUERY_PARAMETER = 'openforge-e2e-token'
const DEFAULT_DRAIN_TIMEOUT_MS = 10_000
const DRAIN_POLL_INTERVAL_MS = 16

export interface TerminalProbeObservation {
  key: string
  lifecycle: {
    attached: boolean
    attachmentGeneration: number
    authorityReadApplied: boolean
    authorityReadPending: boolean
    currentPtyInstance: number | null
    recoveryNeeded: boolean
    ptyActive: boolean
    shellExited: boolean
    spawnPending: boolean
    stateSource: string
  }
  modelOutputSubscription: LiveModelOutputSubscriptionSnapshot | null
  output: {
    firstSequence: number | null
    lastSequence: number | null
    modelSequence: number | null
    receivedBytes: number
    sequenceContinuous: boolean
  }
  geometry: { cols: number; rows: number }
}

export interface TerminalProbeDrainExpectation {
  marker?: string
  minimumReceivedBytes?: number
  minimumModelSequence?: number
  timeoutMs?: number
}

export interface TerminalProbeDrainResult {
  observation: TerminalProbeObservation
  markerFound: boolean
  presentation: TerminalViewPresentationEvidence
  visibleText: string
}

export interface E2eFixtureEmissionReceipt extends E2eTerminalFixtureOutputReceipt {
  operationId: string
  sequenceBaseline: number | null
}

export interface TerminalTestProbeApi {
  terminal: {
    list(): string[]
    observe(key: string): TerminalProbeObservation
    drain(key: string, expectation?: TerminalProbeDrainExpectation): Promise<TerminalProbeDrainResult>
    emitFixtureOutput(
      key: string,
      marker: string,
      byteCount: number,
    ): Promise<E2eFixtureEmissionReceipt>
  }
  gates: Readonly<Omit<TerminalE2eGateCoordinator, 'checkpoint'>>
}

export interface TerminalTestProbeWindow {
  __openforgeE2e?: TerminalTestProbeApi
}

interface InstallTerminalTestProbeOptions {
  isDevelopment: boolean
  environmentEnabled: boolean
  launchToken: string | undefined
  coordinator?: TerminalE2eGateCoordinator
  emitFixtureOutput?: typeof emitTerminalFixtureOutput
  createOperationId?: () => string
  url: string
  target?: TerminalTestProbeWindow
  entries?: () => ReadonlyMap<string, PoolEntry>
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

export function shouldEnableTerminalTestProbe(
  isDevelopment: boolean,
  environmentEnabled: boolean,
  url: string,
  launchToken: string | undefined,
): boolean {
  if (!isDevelopment || !environmentEnabled || !launchToken) return false
  try {
    return new URL(url).searchParams.get(E2E_TOKEN_QUERY_PARAMETER) === launchToken
  } catch {
    return false
  }
}

function observeEntry(key: string, entry: PoolEntry): TerminalProbeObservation {
  const output = entry.terminalOutputObservation
  return {
    key,
    lifecycle: {
      attached: entry.attached,
      attachmentGeneration: entry.attachmentGeneration,
      authorityReadApplied: entry.terminalStateSource === 'ghostty-snapshot',
      authorityReadPending: entry.terminalReplayRecovery !== null,
      currentPtyInstance: entry.currentPtyInstance,
      recoveryNeeded: entry.viewNeedsRecovery,
      ptyActive: entry.ptyActive,
      shellExited: entry.shellExited,
      spawnPending: entry.spawnPending,
      stateSource: entry.terminalStateSource,
    },
    modelOutputSubscription: entry.transportSubscription?.snapshot?.() ?? null,
    output: {
      firstSequence: output.firstSequence,
      lastSequence: output.lastSequence,
      modelSequence: entry.terminalModelSequence,
      receivedBytes: output.receivedBytes,
      sequenceContinuous: output.sequenceContinuous,
    },
    geometry: {
      cols: entry.view.geometry.cols,
      rows: entry.view.geometry.rows,
    },
  }
}

function missingExpectationMessage(
  expectation: TerminalProbeDrainExpectation,
  observation: TerminalProbeObservation,
  markerFound: boolean,
): string {
  if (expectation.marker && !markerFound) {
    return `Terminal marker "${expectation.marker}" was not presented`
  }
  if ((expectation.minimumReceivedBytes ?? 0) > observation.output.receivedBytes) {
    return `Terminal received ${observation.output.receivedBytes} bytes; expected at least ${expectation.minimumReceivedBytes}`
  }
  return `Terminal model sequence ${observation.output.modelSequence ?? 'unavailable'} did not reach ${expectation.minimumModelSequence}`
}

export function installTerminalTestProbe(options: InstallTerminalTestProbeOptions): TerminalTestProbeApi | null {
  const target: TerminalTestProbeWindow = options.target ?? (window as TerminalTestProbeWindow)
  if (!shouldEnableTerminalTestProbe(
    options.isDevelopment,
    options.environmentEnabled,
    options.url,
    options.launchToken,
  )) {
    delete target.__openforgeE2e
    configureTerminalE2eRuntime(null)
    return null
  }
  const coordinator = options.coordinator ?? createTerminalE2eGateCoordinator()
  const emitFixtureOutput = options.emitFixtureOutput ?? emitTerminalFixtureOutput
  const createOperationId = options.createOperationId ?? (() => crypto.randomUUID())
  configureTerminalE2eRuntime(coordinator)

  const entries = options.entries ?? getTerminalEntriesForObservation
  const observedTerminalKeys = new Set<string>()
  const now = options.now ?? Date.now
  const wait = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const requireEntry = (key: string): PoolEntry => {
    const entry = entries().get(key) ?? getAcquiredTerminalForE2eDiagnostics(key)
    if (!entry) throw new Error(`Unknown terminal key: ${key}`)
    return entry
  }

  const terminal = Object.freeze({
    list(): string[] {
      const keys = [...entries().keys()].sort()
      for (const key of keys) observedTerminalKeys.add(key)
      return keys
    },
    observe(key: string): TerminalProbeObservation {
      const entry = requireEntry(key)
      observedTerminalKeys.add(key)
      return observeEntry(key, entry)
    },
    async emitFixtureOutput(
      key: string,
      marker: string,
      byteCount: number,
    ): Promise<E2eFixtureEmissionReceipt> {
      const entry = entries().get(key) ?? getAcquiredTerminalForE2eDiagnostics(key)
      if (!entry && !observedTerminalKeys.has(key)) throw new Error(`Unknown terminal key: ${key}`)
      if (entry) observedTerminalKeys.add(key)
      const sequenceBaseline = entry?.terminalOutputObservation.lastSequence ?? null
      const receipt = await emitFixtureOutput(key, marker, byteCount)
      return Object.freeze({
        ...receipt,
        operationId: createOperationId(),
        sequenceBaseline,
      })
    },
    async drain(
      key: string,
      expectation: TerminalProbeDrainExpectation = {},
    ): Promise<TerminalProbeDrainResult> {
      const timeoutMs = expectation.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
      const deadline = now() + timeoutMs

      do {
        const entry = requireEntry(key)
        const observation = observeEntry(key, entry)
        if (!observation.output.sequenceContinuous) {
          throw new Error(`Terminal ${key} has an incomplete output sequence`)
        }

        const presentation = await entry.view.drainPresentation()
        const visibleText = entry.view.capturePresentation().lines.map(line => line.text).join('\n')
        const markerFound = expectation.marker === undefined || visibleText.includes(expectation.marker)
        const receivedEnoughBytes = observation.output.receivedBytes >= (expectation.minimumReceivedBytes ?? 0)
        const reachedModelSequence = expectation.minimumModelSequence === undefined
          || (observation.output.modelSequence ?? -1) >= expectation.minimumModelSequence

        if (markerFound && receivedEnoughBytes && reachedModelSequence) {
          return { observation, markerFound, presentation, visibleText }
        }
        if (now() >= deadline) {
          throw new Error(missingExpectationMessage(expectation, observation, markerFound))
        }
        await wait(DRAIN_POLL_INTERVAL_MS)
      } while (true)
    },
  })

  const gates = Object.freeze({
    arm: coordinator.arm,
    cancel: coordinator.cancel,
    get: coordinator.get,
    list: coordinator.list,
    resume: coordinator.resume,
    waitForState: coordinator.waitForState,
  })
  const probe = Object.freeze({ gates, terminal })
  target.__openforgeE2e = probe
  return probe
}
