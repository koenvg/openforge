import { describe, expect, it } from 'vitest'
import { TERMINAL_PERFORMANCE_PHASES as RUNTIME_TERMINAL_PERFORMANCE_PHASES } from '../packages/terminal-runtime/src/terminalPerformanceTrace.ts'
import {
  assertCorrectnessChecks,
  calculateThroughput,
  createEnvironmentMetadata,
  createTerminalPerformanceReport,
  createTerminalPhaseTimeline,
  serializeTerminalPerformanceReport,
  summarizeSamples,
  TERMINAL_PERFORMANCE_PHASES,
  unavailableMemoryMeasurement,
} from './desktop-test/terminal-performance-report.mjs'

describe('terminal performance report', () => {
  it('excludes warm-up values and calculates median and nearest-rank p95', () => {
    expect(summarizeSamples([100, 10, 20, 30, 40], { warmupCount: 1 })).toEqual({
      samples: [100, 10, 20, 30, 40],
      warmupSamples: [100],
      measuredSamples: [10, 20, 30, 40],
      median: 25,
      p95: 40,
      unit: 'ms',
    })
  })

  it('calculates byte throughput without rounding away raw values', () => {
    expect(calculateThroughput(5_000, 250)).toEqual({
      bytes: 5_000,
      durationMs: 250,
      bytesPerSecond: 20_000,
    })
    expect(() => calculateThroughput(1, 0)).toThrow('durationMs must be greater than zero')
  })

  it('records comparable environment metadata and unavailable memory explicitly', () => {
    expect(createEnvironmentMetadata({
      platform: 'darwin',
      arch: 'arm64',
      release: '24.1.0',
      cpus: [{ model: 'Test CPU' }, { model: 'Test CPU' }],
      totalMemoryBytes: 16_000,
      versions: { node: '24.0.0', electron: '43.0.0', chrome: '142.0.0' },
      appRevision: 'abc123',
    })).toEqual({
      operatingSystem: { platform: 'darwin', release: '24.1.0', arch: 'arm64' },
      cpu: { model: 'Test CPU', logicalCores: 2 },
      totalMemoryBytes: 16_000,
      runtime: { node: '24.0.0', electron: '43.0.0', chromium: '142.0.0' },
      appRevision: 'abc123',
    })
    expect(unavailableMemoryMeasurement('unsupported platform')).toEqual({
      available: false,
      bytes: null,
      reason: 'unsupported platform',
    })
  })

  it('keeps timings informational while correctness determines scenario status', () => {
    const report = createTerminalPerformanceReport({
      generatedAt: '2025-01-01T00:00:00.000Z',
      checks: [
        { name: 'completion-marker', passed: true, evidence: { marker: 'DONE' } },
        { name: 'sequence-continuity', passed: true, evidence: { sequenceContinuous: true } },
      ],
      metrics: {
        driverToPaintedEcho: { median: 9_999, p95: 99_999, unit: 'ms' },
      },
      environment: { appRevision: 'abc123' },
      memory: { processTree: unavailableMemoryMeasurement('not sampled') },
      fixture: { rows: 24, cols: 80, renderer: 'canvas' },
      artifacts: { report: '/artifacts/report.json' },
    })

    expect(report.status).toBe('passed')
    expect(report.metrics.driverToPaintedEcho.p95).toBe(99_999)
    expect(report.performanceValuesAreInformational).toBe(true)
  })

  it('fails missing markers, incomplete sequences, byte mismatches, and missing presentation evidence', () => {
    const failedChecks = [
      { name: 'completion-marker', passed: false, message: 'completion marker missing' },
      { name: 'sequence-continuity', passed: false, message: 'incomplete sequence' },
      { name: 'expected-bytes', passed: false, message: 'expected 100 bytes, received 90' },
      { name: 'presentation-drain', passed: false, message: 'no presented renderer frame' },
    ]

    expect(() => assertCorrectnessChecks(failedChecks)).toThrow(
      'completion-marker: completion marker missing; sequence-continuity: incomplete sequence; expected-bytes: expected 100 bytes, received 90; presentation-drain: no presented renderer frame',
    )
    expect(createTerminalPerformanceReport({ checks: failedChecks }).status).toBe('failed')
  })

  it('serializes the version 2 phase schema with preserved shell readiness evidence', () => {
    const phaseTimeline = createTerminalPhaseTimeline(Object.fromEntries(
      TERMINAL_PERFORMANCE_PHASES.map((phase, index) => [phase, index + 1]),
    ))
    const report = createTerminalPerformanceReport({
      generatedAt: '2025-01-01T00:00:00.000Z',
      checks: [],
      metrics: {
        shellReady: { durationMs: 42, unit: 'ms', phaseTimeline },
        driverToPaintedEcho: { mode: 'already-focused', median: 8, p95: 11, unit: 'ms' },
        fullDriverToPaintedEcho: { durationMs: 17, unit: 'ms' },
      },
      environment: {},
      memory: {},
      fixture: {},
      artifacts: {},
    })
    const serialized = serializeTerminalPerformanceReport(report)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: 2,
      scenario: 'full-app-terminal-performance',
      status: 'passed',
      metrics: {
        shellReady: { durationMs: 42, phaseTimeline: { clockDomain: 'renderer-performance' } },
        driverToPaintedEcho: { mode: 'already-focused' },
        fullDriverToPaintedEcho: { durationMs: 17 },
      },
    })
  })

  it('normalizes renderer phase marks and derives every adjacent segment', () => {
    expect(TERMINAL_PERFORMANCE_PHASES).toEqual(RUNTIME_TERMINAL_PERFORMANCE_PHASES)
    expect(TERMINAL_PERFORMANCE_PHASES).toEqual([
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
    ])
    const timestamps = Object.fromEntries(
      TERMINAL_PERFORMANCE_PHASES.map((phase, index) => [phase, 100 + index * 5]),
    )

    const timeline = createTerminalPhaseTimeline(timestamps)

    expect(timeline.clockDomain).toBe('renderer-performance')
    expect(timeline.marks).toEqual(
      TERMINAL_PERFORMANCE_PHASES.map((phase, index) => ({
        phase,
        timestampMs: 100 + index * 5,
        available: true,
      })),
    )
    expect(timeline.segments).toHaveLength(TERMINAL_PERFORMANCE_PHASES.length - 1)
    expect(timeline.segments[0]).toEqual({
      startPhase: 'lifecycleStart',
      endPhase: 'terminalAttachment',
      durationMs: 5,
      unit: 'ms',
      available: true,
    })
    expect(timeline.diagnostics).toEqual([])
  })

  it('keeps missing and out-of-order phase evidence diagnostic instead of inventing durations', () => {
    const missing = createTerminalPhaseTimeline({
      lifecycleStart: 10,
      terminalAttachment: 12,
    })

    expect(missing.marks.find(mark => mark.phase === 'xtermMount')).toEqual({
      phase: 'xtermMount',
      timestampMs: null,
      available: false,
    })
    expect(missing.segments[1]).toEqual({
      startPhase: 'terminalAttachment',
      endPhase: 'xtermMount',
      durationMs: null,
      unit: 'ms',
      available: false,
    })
    expect(missing.diagnostics).toContainEqual({
      type: 'missing-phase',
      phase: 'xtermMount',
      message: 'missing phase: xtermMount',
    })

    const reversedAcrossMissingPhase = createTerminalPhaseTimeline({
      lifecycleStart: 20,
      xtermMount: 19,
    })
    expect(reversedAcrossMissingPhase.diagnostics).toContainEqual({
      type: 'out-of-order',
      earlierPhase: 'lifecycleStart',
      laterPhase: 'xtermMount',
      message: 'phase order violated: xtermMount precedes lifecycleStart',
    })
    const reversed = createTerminalPhaseTimeline({
      lifecycleStart: 20,
      terminalAttachment: 19,
    })
    expect(reversed.marks.slice(0, 2)).toEqual([
      { phase: 'lifecycleStart', timestampMs: 20, available: true },
      { phase: 'terminalAttachment', timestampMs: 19, available: true },
    ])
    expect(reversed.segments[0]).toMatchObject({ available: false, durationMs: null })
    expect(reversed.diagnostics).toContainEqual({
      type: 'out-of-order',
      earlierPhase: 'lifecycleStart',
      laterPhase: 'terminalAttachment',
      message: 'phase order violated: terminalAttachment precedes lifecycleStart',
    })
  })
})
