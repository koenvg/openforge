import { describe, expect, it } from 'vitest'
import { runTerminalPerformanceOverheadBenchmark } from './terminalPerformanceOverheadBenchmark'

describe('terminal performance profiler-off overhead', () => {
  it('alternates equivalent workloads, retains raw samples, and avoids the inactive observer clock', () => {
    let time = 0
    const result = runTerminalPerformanceOverheadBenchmark({
      now: () => time++,
      trials: 3,
      warmupTrials: 0,
      iterationsPerTrial: 1,
      payloadBytes: 1,
    })

    expect(result).toMatchObject({
      comparisonMethod: 'alternating-warmed-median',
      baselineSamplesMs: [1, 1, 1],
      inactiveObserverSamplesMs: [1, 1, 1],
      baselineMedianMs: 1,
      inactiveObserverMedianMs: 1,
      overheadPercent: 0,
      limitPercent: 2,
      passed: true,
    })
  })

  it.runIf(process.env.RUN_TERMINAL_PERFORMANCE_OVERHEAD === '1')(
    'keeps measured inactive-observer median overhead below two percent',
    () => {
      const result = runTerminalPerformanceOverheadBenchmark()
      console.log(JSON.stringify(result, null, 2))
      expect(result.overheadPercent).toBeLessThan(result.limitPercent)
    },
    60_000,
  )
})
