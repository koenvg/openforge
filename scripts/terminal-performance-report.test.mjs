import { describe, expect, it } from 'vitest'
import {
  assertCorrectnessChecks,
  calculateThroughput,
  createEnvironmentMetadata,
  createTerminalPerformanceReport,
  serializeTerminalPerformanceReport,
  summarizeSamples,
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

  it('serializes a versioned JSON report with a trailing newline', () => {
    const report = createTerminalPerformanceReport({
      generatedAt: '2025-01-01T00:00:00.000Z',
      checks: [],
      metrics: {},
      environment: {},
      memory: {},
      fixture: {},
      artifacts: {},
    })
    const serialized = serializeTerminalPerformanceReport(report)

    expect(serialized.endsWith('\n')).toBe(true)
    expect(JSON.parse(serialized)).toMatchObject({
      schemaVersion: 1,
      scenario: 'full-app-terminal-performance',
      status: 'passed',
    })
  })
})
