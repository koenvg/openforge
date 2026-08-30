import type {
  PoolEntry,
  TerminalViewPresentationEvidence,
} from '@openforge-app/terminal-runtime'
import { getTerminalEntriesForObservation } from './terminalPool'

const DESKTOP_TEST_QUERY_PARAMETER = 'openforge-desktop-test'
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
  }
}

export interface TerminalTestProbeWindow {
  __openforgeDesktopTest?: TerminalTestProbeApi
}

interface InstallTerminalTestProbeOptions {
  isDevelopment: boolean
  url: string
  target?: TerminalTestProbeWindow
  entries?: () => ReadonlyMap<string, PoolEntry>
  now?: () => number
  delay?: (ms: number) => Promise<void>
}

export function shouldEnableTerminalTestProbe(isDevelopment: boolean, url: string): boolean {
  if (!isDevelopment) return false
  try {
    return new URL(url).searchParams.get(DESKTOP_TEST_QUERY_PARAMETER) === '1'
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
      currentPtyInstance: entry.currentPtyInstance,
      ptyActive: entry.ptyActive,
      shellExited: entry.shellExited,
      spawnPending: entry.spawnPending,
      stateSource: entry.terminalStateSource,
    },
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
  if (!shouldEnableTerminalTestProbe(options.isDevelopment, options.url)) {
    delete target.__openforgeDesktopTest
    return null
  }

  const entries = options.entries ?? getTerminalEntriesForObservation
  const now = options.now ?? Date.now
  const wait = options.delay ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const requireEntry = (key: string): PoolEntry => {
    const entry = entries().get(key)
    if (!entry) throw new Error(`Unknown terminal key: ${key}`)
    return entry
  }

  const terminal = Object.freeze({
    list(): string[] {
      return [...entries().keys()].sort()
    },
    observe(key: string): TerminalProbeObservation {
      return observeEntry(key, requireEntry(key))
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

  const probe = Object.freeze({ terminal })
  target.__openforgeDesktopTest = probe
  return probe
}
