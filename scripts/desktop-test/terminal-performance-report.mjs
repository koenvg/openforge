function requireFiniteNonNegative(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a finite non-negative number`)
  }
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
    schemaVersion: 1,
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
