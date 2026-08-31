import { performance } from 'node:perf_hooks'
import { createTerminalPerformanceTrace, type TerminalPerformanceTrace } from './terminalPerformanceTrace'

export interface TerminalPerformanceOverheadBenchmarkResult {
  comparisonMethod: 'alternating-warmed-median'
  iterationsPerTrial: number
  payloadBytes: number
  baselineSamplesMs: number[]
  inactiveObserverSamplesMs: number[]
  baselineMedianMs: number
  inactiveObserverMedianMs: number
  overheadPercent: number
  limitPercent: number
  passed: boolean
  checksum: number
}

interface BenchmarkOptions {
  now?: () => number
  trials?: number
  warmupTrials?: number
  iterationsPerTrial?: number
  payloadBytes?: number
  limitPercent?: number
  createInactiveObserver?: () => TerminalPerformanceTrace
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!
}

function runOutputWorkload(
  observer: TerminalPerformanceTrace | undefined,
  payload: Uint8Array,
  iterations: number,
): number {
  let checksum = 0
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    observer?.mark('firstOutput', { terminalKey: 'benchmark-shell', ptyInstanceId: 1 })
    for (const byte of payload) checksum = (checksum + byte + iteration) & 0xFFFF_FFFF
  }
  return checksum
}

export function runTerminalPerformanceOverheadBenchmark(
  options: BenchmarkOptions = {},
): TerminalPerformanceOverheadBenchmarkResult {
  const now = options.now ?? performance.now.bind(performance)
  const trials = options.trials ?? 15
  const warmupTrials = options.warmupTrials ?? 4
  const iterationsPerTrial = options.iterationsPerTrial ?? 50_000
  const payloadBytes = options.payloadBytes ?? 512
  const limitPercent = options.limitPercent ?? 2
  const inactiveObserver = options.createInactiveObserver?.() ?? createTerminalPerformanceTrace({
    now: () => {
      throw new Error('Inactive terminal performance observer read the monotonic clock')
    },
  })
  const payload = Uint8Array.from({ length: payloadBytes }, (_, index) => index % 251)
  let checksum = 0

  function measure(observer: TerminalPerformanceTrace | undefined): number {
    const startedAt = now()
    checksum ^= runOutputWorkload(observer, payload, iterationsPerTrial)
    return now() - startedAt
  }

  for (let index = 0; index < warmupTrials; index += 1) {
    if (index % 2 === 0) {
      measure(undefined)
      measure(inactiveObserver)
    } else {
      measure(inactiveObserver)
      measure(undefined)
    }
  }

  const baselineSamplesMs: number[] = []
  const inactiveObserverSamplesMs: number[] = []
  for (let index = 0; index < trials; index += 1) {
    if (index % 2 === 0) {
      baselineSamplesMs.push(measure(undefined))
      inactiveObserverSamplesMs.push(measure(inactiveObserver))
    } else {
      inactiveObserverSamplesMs.push(measure(inactiveObserver))
      baselineSamplesMs.push(measure(undefined))
    }
  }

  const baselineMedianMs = median(baselineSamplesMs)
  const inactiveObserverMedianMs = median(inactiveObserverSamplesMs)
  const overheadPercent = ((inactiveObserverMedianMs - baselineMedianMs) / baselineMedianMs) * 100
  return {
    comparisonMethod: 'alternating-warmed-median',
    iterationsPerTrial,
    payloadBytes,
    baselineSamplesMs,
    inactiveObserverSamplesMs,
    baselineMedianMs,
    inactiveObserverMedianMs,
    overheadPercent,
    limitPercent,
    passed: overheadPercent < limitPercent,
    checksum,
  }
}
