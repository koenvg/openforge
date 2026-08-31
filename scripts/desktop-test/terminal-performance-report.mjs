function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`)
  }
}

export const TERMINAL_PERFORMANCE_PHASES = Object.freeze([
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

export function createTerminalPhaseTimeline(timestamps = {}) {
  const diagnostics = []
  const marks = TERMINAL_PERFORMANCE_PHASES.map(phase => {
    const timestampMs = timestamps[phase]
    if (!Number.isFinite(timestampMs) || timestampMs < 0) {
      diagnostics.push({
        type: 'missing-phase',
        phase,
        message: `missing phase: ${phase}`,
      })
      return { phase, timestampMs: null, available: false }
    }
    return { phase, timestampMs, available: true }
  })

  let previousAvailableMark = null
  for (const mark of marks) {
    if (!mark.available) continue
    if (previousAvailableMark && mark.timestampMs < previousAvailableMark.timestampMs) {
      diagnostics.push({
        type: 'out-of-order',
        earlierPhase: previousAvailableMark.phase,
        laterPhase: mark.phase,
        message: `phase order violated: ${mark.phase} precedes ${previousAvailableMark.phase}`,
      })
    }
    if (!previousAvailableMark || mark.timestampMs >= previousAvailableMark.timestampMs) {
      previousAvailableMark = mark
    }
  }

  const segments = marks.slice(0, -1).map((start, index) => {
    const end = marks[index + 1]
    if (!start.available || !end.available) {
      return {
        startPhase: start.phase,
        endPhase: end.phase,
        durationMs: null,
        unit: 'ms',
        available: false,
      }
    }
    if (end.timestampMs < start.timestampMs) {
      return {
        startPhase: start.phase,
        endPhase: end.phase,
        durationMs: null,
        unit: 'ms',
        available: false,
      }
    }
    return {
      startPhase: start.phase,
      endPhase: end.phase,
      durationMs: end.timestampMs - start.timestampMs,
      unit: 'ms',
      available: true,
    }
  })

  return {
    clockDomain: 'renderer-performance',
    marks,
    segments,
    diagnostics,
  }
}

export function createTerminalPhaseChecks(timeline) {
  const missing = timeline.diagnostics.filter(diagnostic => diagnostic.type === 'missing-phase')
  const outOfOrder = timeline.diagnostics.filter(diagnostic => diagnostic.type === 'out-of-order')
  return [
    {
      name: 'shell-ready:phase-completeness',
      passed: missing.length === 0,
      message: missing.map(diagnostic => diagnostic.message).join('; ') || 'all phases available',
      evidence: { missingPhases: missing.map(diagnostic => diagnostic.phase) },
    },
    {
      name: 'shell-ready:phase-ordering',
      passed: outOfOrder.length === 0,
      message: outOfOrder.map(diagnostic => diagnostic.message).join('; ') || 'phase order valid',
      evidence: { violations: outOfOrder },
    },
  ]
}

export function summarizeSamples(samples, { warmupCount = 0 } = {}) {
  if (!Array.isArray(samples) || samples.length === 0) throw new Error('samples must not be empty')
  if (!Number.isSafeInteger(warmupCount) || warmupCount < 0 || warmupCount >= samples.length) {
    throw new Error('warmupCount must leave at least one measured sample')
  }
  for (const sample of samples) requireFiniteNonNegative(sample, 'sample')

  const warmupSamples = samples.slice(0, warmupCount)
  const measuredSamples = samples.slice(warmupCount)
  const sorted = [...measuredSamples].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle]
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1]

  return {
    samples: [...samples],
    warmupSamples,
    measuredSamples,
    median,
    p95,
    unit: 'ms',
  }
}

export function calculateThroughput(bytes, durationMs) {
  requireFiniteNonNegative(bytes, 'bytes')
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    throw new Error('durationMs must be greater than zero')
  }
  return {
    bytes,
    durationMs,
    bytesPerSecond: bytes / (durationMs / 1_000),
  }
}

export function unavailableMemoryMeasurement(reason) {
  return {
    available: false,
    bytes: null,
    reason,
  }
}

export function createEnvironmentMetadata({
  platform,
  arch,
  release,
  cpus = [],
  totalMemoryBytes,
  versions = {},
  appRevision = null,
}) {
  return {
    operatingSystem: { platform, release, arch },
    cpu: {
      model: cpus[0]?.model ?? 'unknown',
      logicalCores: cpus.length,
    },
    totalMemoryBytes,
    runtime: {
      node: versions.node ?? null,
      electron: versions.electron ?? null,
      chromium: versions.chrome ?? null,
    },
    appRevision,
  }
}

export function assertCorrectnessChecks(checks = []) {
  const failed = checks.filter(check => check.passed !== true)
  if (failed.length === 0) return
  throw new Error(failed
    .map(check => `${check.name}: ${check.message ?? 'correctness check failed'}`)
    .join('; '))
}

export function createTerminalPerformanceReport({
  generatedAt = new Date().toISOString(),
  checks = [],
  metrics = {},
  environment = {},
  memory = {},
  fixture = {},
  artifacts = {},
} = {}) {
  return {
    schemaVersion: 2,
    scenario: 'full-app-terminal-performance',
    generatedAt,
    status: checks.every(check => check.passed === true) ? 'passed' : 'failed',
    performanceValuesAreInformational: true,
    checks,
    metrics,
    environment,
    memory,
    fixture,
    artifacts,
  }
}

export function serializeTerminalPerformanceReport(report) {
  return `${JSON.stringify(report, (_key, value) => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      throw new Error('Terminal performance reports cannot contain non-finite numbers')
    }
    return value
  }, 2)}\n`
}
