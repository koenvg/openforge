import type {
  LiveModelOutputSubscriptionSnapshot,
  TerminalViewPresentationEvidence,
  TerminalPerformanceTrace,
  TerminalPerformanceTraceSnapshot,
  TerminalRuntimeDiagnostics,
  TerminalSessionDiagnostics,
} from '@openforge-app/terminal-runtime'
import { terminalDiagnostics } from './terminalSessionService'
import { shouldEnableTerminalTestProbe as shouldEnableTerminalPerformanceProbe } from './desktopTestMode'
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
  /** Execution handshakes use a whole logical line, not a substring of command echo. */
  markerMatch?: 'line'
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

export interface TerminalPerformanceProbeApi {
  terminal: {
    list(): string[]
    observe(key: string): TerminalProbeObservation
    drain(key: string, expectation?: TerminalProbeDrainExpectation): Promise<TerminalProbeDrainResult>
    performance: {
      start(): void
      finish(): TerminalPerformanceTraceSnapshot | null
      snapshot(): TerminalPerformanceTraceSnapshot | null
    }
  }
}

export interface TerminalTestProbeWindow {
  __openforgeE2e?: TerminalTestProbeApi
  __openforgeDesktopTest?: TerminalPerformanceProbeApi
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
  diagnostics?: TerminalRuntimeDiagnostics
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

interface InstallTerminalPerformanceProbeOptions {
  isDevelopment: boolean
  url: string
  performanceTrace: TerminalPerformanceTrace | undefined
  target?: TerminalTestProbeWindow
  diagnostics?: TerminalRuntimeDiagnostics
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

function toDiagnosticsObservation(diagnostics: TerminalSessionDiagnostics): TerminalProbeObservation {
  return {
    key: diagnostics.shellSessionKey,
    lifecycle: {
      attached: diagnostics.lifecycle.attached,
      attachmentGeneration: diagnostics.view.attachmentGeneration,
      authorityReadApplied: diagnostics.lifecycle.stateSource === 'ghostty-snapshot',
      authorityReadPending: diagnostics.view.authorityReadPending,
      currentPtyInstance: diagnostics.lifecycle.currentPtyInstance,
      recoveryNeeded: diagnostics.view.needsRecovery,
      ptyActive: diagnostics.lifecycle.ptyActive,
      shellExited: diagnostics.lifecycle.shellExited,
      spawnPending: diagnostics.lifecycle.spawnPending,
      stateSource: diagnostics.lifecycle.stateSource,
    },
    modelOutputSubscription: diagnostics.modelOutputSubscription,
    output: {
      firstSequence: diagnostics.output.firstSequence,
      lastSequence: diagnostics.output.lastSequence,
      modelSequence: diagnostics.output.modelSequence,
      receivedBytes: diagnostics.output.receivedBytes,
      sequenceContinuous: diagnostics.output.sequenceContinuous,
    },
    geometry: { ...diagnostics.geometry },
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

function incompleteSequenceMessage(
  key: string,
  detected: TerminalProbeObservation,
  latest: TerminalProbeObservation,
): string {
  return `Terminal ${key} has an incomplete output sequence; diagnostics=${JSON.stringify({
    detected: {
      lifecycle: {
        authorityReadPending: detected.lifecycle.authorityReadPending,
        currentPtyInstance: detected.lifecycle.currentPtyInstance,
        stateSource: detected.lifecycle.stateSource,
      },
      output: detected.output,
    },
    latest: {
      lifecycle: {
        authorityReadPending: latest.lifecycle.authorityReadPending,
        currentPtyInstance: latest.lifecycle.currentPtyInstance,
        stateSource: latest.lifecycle.stateSource,
      },
      output: latest.output,
    },
  })}`
}

interface TerminalDrainIncompleteSequencePolicy {
  deferUntilSettled: boolean
  message(
    key: string,
    detected: TerminalProbeObservation,
    latest: TerminalProbeObservation,
  ): string
}

interface CreateTerminalDrainOptions {
  diagnostics: TerminalRuntimeDiagnostics
  requireObservation: (key: string) => TerminalProbeObservation
  now: () => number
  wait: (ms: number) => Promise<void>
  incompleteSequence: TerminalDrainIncompleteSequencePolicy
}

function createTerminalDrain(options: CreateTerminalDrainOptions) {
  return async (
    key: string,
    expectation: TerminalProbeDrainExpectation = {},
  ): Promise<TerminalProbeDrainResult> => {
    const timeoutMs = expectation.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
    const deadline = options.now() + timeoutMs
    let incompleteObservation: TerminalProbeObservation | null = null

    do {
      const observation = options.requireObservation(key)
      if (!observation.output.sequenceContinuous && !incompleteObservation) {
        incompleteObservation = observation
        if (!options.incompleteSequence.deferUntilSettled) {
          throw new Error(options.incompleteSequence.message(key, observation, observation))
        }
      }

      const presentation = await options.diagnostics.drainPresentation(key)
      const lines = options.diagnostics.capturePresentation(key).lines
      const visibleText = lines.map(line => line.text).join('\n')
      const markerFound = expectation.marker === undefined || (expectation.markerMatch === 'line'
        ? lines.map((line, index) => `${index > 0 && !line.wrapped ? '\n' : ''}${line.text}`)
          .join('').split('\n').includes(expectation.marker)
        : visibleText.includes(expectation.marker))
      const receivedEnoughBytes = observation.output.receivedBytes >= (expectation.minimumReceivedBytes ?? 0)
      const reachedModelSequence = expectation.minimumModelSequence === undefined
        || (observation.output.modelSequence ?? -1) >= expectation.minimumModelSequence
      const outputComplete = markerFound && receivedEnoughBytes && reachedModelSequence

      if (outputComplete) {
        if (incompleteObservation) {
          throw new Error(options.incompleteSequence.message(key, incompleteObservation, observation))
        }
        return { observation, markerFound, presentation, visibleText }
      }
      if (options.now() >= deadline) {
        if (incompleteObservation) {
          throw new Error(options.incompleteSequence.message(key, incompleteObservation, observation))
        }
        throw new Error(missingExpectationMessage(expectation, observation, markerFound))
      }
      await options.wait(DRAIN_POLL_INTERVAL_MS)
    } while (true)
  }
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

  const diagnostics = options.diagnostics ?? terminalDiagnostics
  const observedTerminalKeys = new Set<string>()
  const now = options.now ?? Date.now
  const wait = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const currentDiagnostics = (key: string): TerminalSessionDiagnostics | null => (
    diagnostics.list().includes(key)
      ? diagnostics.observe(key)
      : getAcquiredTerminalForE2eDiagnostics(key)
  )
  const requireObservation = (key: string): TerminalProbeObservation => {
    const observation = currentDiagnostics(key)
    if (!observation) throw new Error(`Unknown terminal key: ${key}`)
    return toDiagnosticsObservation(observation)
  }

  const drain = createTerminalDrain({
    diagnostics,
    requireObservation,
    now,
    wait,
    incompleteSequence: {
      deferUntilSettled: true,
      message: incompleteSequenceMessage,
    },
  })
  const terminal = Object.freeze({
    list(): string[] {
      const keys = diagnostics.list()
      for (const key of keys) observedTerminalKeys.add(key)
      return keys
    },
    observe(key: string): TerminalProbeObservation {
      const observation = requireObservation(key)
      observedTerminalKeys.add(key)
      return observation
    },
    async emitFixtureOutput(
      key: string,
      marker: string,
      byteCount: number,
    ): Promise<E2eFixtureEmissionReceipt> {
      const observation = currentDiagnostics(key)
      if (!observation && !observedTerminalKeys.has(key)) throw new Error(`Unknown terminal key: ${key}`)
      if (observation) observedTerminalKeys.add(key)
      const sequenceBaseline = observation?.output.lastSequence ?? null
      const receipt = await emitFixtureOutput(key, marker, byteCount)
      return Object.freeze({
        ...receipt,
        operationId: createOperationId(),
        sequenceBaseline,
      })
    },
    drain,
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

export function installTerminalPerformanceProbe(
  options: InstallTerminalPerformanceProbeOptions,
): TerminalPerformanceProbeApi | null {
  const target: TerminalTestProbeWindow = options.target ?? (window as TerminalTestProbeWindow)
  if (!shouldEnableTerminalPerformanceProbe(options.isDevelopment, options.url) || !options.performanceTrace) {
    delete target.__openforgeDesktopTest
    return null
  }

  const diagnostics = options.diagnostics ?? terminalDiagnostics
  const now = options.now ?? Date.now
  const wait = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const requireObservation = (key: string): TerminalProbeObservation => {
    if (!diagnostics.list().includes(key)) throw new Error(`Unknown terminal key: ${key}`)
    return toDiagnosticsObservation(diagnostics.observe(key))
  }
  const performanceTrace = options.performanceTrace
  const performance = Object.freeze({
    start: () => performanceTrace.start(),
    finish: () => performanceTrace.finish(),
    snapshot: () => performanceTrace.snapshot(),
  })
  const drain = createTerminalDrain({
    diagnostics,
    requireObservation,
    now,
    wait,
    incompleteSequence: {
      deferUntilSettled: false,
      message: key => `Terminal ${key} has an incomplete output sequence`,
    },
  })
  const terminal = Object.freeze({
    performance,
    list(): string[] {
      return diagnostics.list()
    },
    observe(key: string): TerminalProbeObservation {
      return requireObservation(key)
    },
    drain,
  })

  const probe = Object.freeze({ terminal })
  target.__openforgeDesktopTest = probe
  return probe
}
