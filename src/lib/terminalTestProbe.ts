import type {
  TerminalPerformanceTrace,
  TerminalPerformanceTraceSnapshot,
  TerminalRuntimeDiagnostics,
  TerminalSessionDiagnostics,
  TerminalViewPresentationEvidence,
} from '@openforge-app/terminal-runtime'
import { terminalDiagnostics } from './terminalPool'
import { shouldEnableTerminalTestProbe } from './desktopTestMode'

export { shouldEnableTerminalTestProbe } from './desktopTestMode'

const DEFAULT_DRAIN_TIMEOUT_MS = 10_000
const DRAIN_POLL_INTERVAL_MS = 16

export interface TerminalProbeObservation {
  key: string
  lifecycle: {
    attached: boolean
    currentPtyInstance: number | null
    ptyActive: boolean
    shellExited: boolean
    spawnPending: boolean
    stateSource: string
  }
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

export interface TerminalTestProbeApi {
  terminal: {
    list(): string[]
    observe(key: string): TerminalProbeObservation
    drain(key: string, expectation?: TerminalProbeDrainExpectation): Promise<TerminalProbeDrainResult>
    performance?: {
      start(): void
      finish(): TerminalPerformanceTraceSnapshot | null
      snapshot(): TerminalPerformanceTraceSnapshot | null
    }
  }
}

export interface TerminalTestProbeWindow {
  __openforgeDesktopTest?: TerminalTestProbeApi
}

interface InstallTerminalTestProbeOptions {
  isDevelopment: boolean
  url: string
  target?: TerminalTestProbeWindow
  diagnostics?: TerminalRuntimeDiagnostics
  now?: () => number
  delay?: (ms: number) => Promise<void>
  performanceTrace?: TerminalPerformanceTrace
}


function toObservation(diagnostics: TerminalSessionDiagnostics): TerminalProbeObservation {
  return {
    key: diagnostics.shellSessionKey,
    lifecycle: {
      attached: diagnostics.lifecycle.attached,
      currentPtyInstance: diagnostics.lifecycle.currentPtyInstance,
      ptyActive: diagnostics.lifecycle.ptyActive,
      shellExited: diagnostics.lifecycle.shellExited,
      spawnPending: diagnostics.lifecycle.spawnPending,
      stateSource: diagnostics.lifecycle.stateSource,
    },
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

export function installTerminalTestProbe(options: InstallTerminalTestProbeOptions): TerminalTestProbeApi | null {
  const target: TerminalTestProbeWindow = options.target ?? (window as TerminalTestProbeWindow)
  if (!shouldEnableTerminalTestProbe(options.isDevelopment, options.url)) {
    delete target.__openforgeDesktopTest
    return null
  }

  const diagnostics = options.diagnostics ?? terminalDiagnostics
  const now = options.now ?? Date.now
  const wait = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const requireObservation = (key: string): TerminalProbeObservation => {
    if (!diagnostics.list().includes(key)) throw new Error(`Unknown terminal key: ${key}`)
    return toObservation(diagnostics.observe(key))
  }

  const performance = options.performanceTrace && Object.freeze({
    start: () => options.performanceTrace!.start(),
    finish: () => options.performanceTrace!.finish(),
    snapshot: () => options.performanceTrace!.snapshot(),
  })
  const terminal = Object.freeze({
    ...(performance ? { performance } : {}),
    list(): string[] {
      return diagnostics.list()
    },
    observe(key: string): TerminalProbeObservation {
      return requireObservation(key)
    },
    async drain(
      key: string,
      expectation: TerminalProbeDrainExpectation = {},
    ): Promise<TerminalProbeDrainResult> {
      const timeoutMs = expectation.timeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
      const deadline = now() + timeoutMs

      do {
        const observation = requireObservation(key)
        if (!observation.output.sequenceContinuous) {
          throw new Error(`Terminal ${key} has an incomplete output sequence`)
        }

        const presentation = await diagnostics.drainPresentation(key)
        const visibleText = diagnostics.capturePresentation(key).lines.map(line => line.text).join('\n')
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

  const probe = Object.freeze({ terminal })
  target.__openforgeDesktopTest = probe
  return probe
}
