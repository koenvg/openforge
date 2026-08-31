import { join } from 'node:path'
import {
  assertCorrectnessChecks,
  calculateThroughput,
  createTerminalPhaseChecks,
  createTerminalPhaseTimeline,
  summarizeSamples,
} from './terminal-performance-report.mjs'

const DEFAULT_ECHO_SAMPLE_COUNT = 8
const DEFAULT_ECHO_WARMUP_COUNT = 2
const DEFAULT_BULK_INPUT_BYTES = 2_048
const DEFAULT_PTY_OUTPUT_BYTES = 256 * 1_024
const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

function byteLength(text) {
  return new TextEncoder().encode(text).byteLength
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function correctnessChecks(name, baseline, expectedBytes, drained) {
  const observation = drained.observation
  const receivedByteDelta = observation.output.receivedBytes - baseline.output.receivedBytes
  return [
    {
      name: `${name}:completion-marker`,
      passed: drained.markerFound === true,
      message: 'completion marker was not presented',
      evidence: { markerFound: drained.markerFound, visibleText: drained.visibleText },
    },
    {
      name: `${name}:sequence-continuity`,
      passed: observation.output.sequenceContinuous === true,
      message: 'output sequence is incomplete',
      evidence: {
        firstSequence: observation.output.firstSequence,
        lastSequence: observation.output.lastSequence,
        modelSequence: observation.output.modelSequence,
      },
    },
    {
      name: `${name}:expected-bytes`,
      passed: receivedByteDelta >= expectedBytes,
      message: `expected at least ${expectedBytes} received bytes, observed ${receivedByteDelta}`,
      evidence: { expectedBytes, receivedByteDelta },
    },
    {
      name: `${name}:presentation-drain`,
      passed: drained.presentation.renderFrame > 0
        && drained.presentation.parsedGeneration >= drained.presentation.writeGeneration,
      message: 'no presented renderer frame covered the completed write generation',
      evidence: drained.presentation,
    },
  ]
}

export async function runTerminalPerformanceScenario(context, options = {}) {
  const driver = options.driver
  if (!driver) throw new Error('driver is required')
  const now = options.now ?? performance.now.bind(performance)
  const sampleMemory = options.sampleMemory ?? (async () => null)
  const echoSampleCount = options.echoSampleCount ?? DEFAULT_ECHO_SAMPLE_COUNT
  const echoWarmupCount = options.echoWarmupCount ?? DEFAULT_ECHO_WARMUP_COUNT
  const bulkInputBytes = options.bulkInputBytes ?? DEFAULT_BULK_INPUT_BYTES
  const ptyOutputBytes = options.ptyOutputBytes ?? DEFAULT_PTY_OUTPUT_BYTES
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  const checks = []
  await driver.startTerminalPerformanceTrace()
  const scenarioStartedAt = now()

  await driver.verifyDesktopBridge()
  const { region, terminalKey } = await driver.openSeededTerminal(context.fixture.manifest)

  async function executeMeasurement(name, command, marker, expectedBytes, typeCommand) {
    const baseline = await driver.observeTerminal(terminalKey)
    if (!baseline) throw new Error(`Terminal observation is unavailable for ${terminalKey}`)
    const startedAt = now()
    await typeCommand(region, command)
    const drained = await driver.drainTerminal(terminalKey, {
      marker,
      minimumReceivedBytes: baseline.output.receivedBytes + expectedBytes,
      minimumModelSequence: (baseline.output.modelSequence ?? 0) + 1,
      timeoutMs: drainTimeoutMs,
    })
    const durationMs = now() - startedAt
    const measurementChecks = correctnessChecks(name, baseline, expectedBytes, drained)
    checks.push(...measurementChecks)
    assertCorrectnessChecks(measurementChecks)
    return { baseline, drained, durationMs }
  }

  const shellReadyMarker = 'OPENFORGE_PERF_SHELL_READY'
  const shellReady = await executeMeasurement(
    'shell-ready',
    `printf '${shellReadyMarker}\\n'`,
    shellReadyMarker,
    byteLength(`${shellReadyMarker}\n`),
    driver.typeTerminalCommand,
  )
  const shellReadyDurationMs = now() - scenarioStartedAt
  const phaseTrace = await driver.finishTerminalPerformanceTrace()
  const phaseTimeline = createTerminalPhaseTimeline(phaseTrace?.timestamps)
  const phaseChecks = createTerminalPhaseChecks(phaseTimeline)
  checks.push(...phaseChecks)

  const loadedMemory = await sampleMemory('after-shell-ready')
  const echoDurations = []
  const fullDriverMarker = 'OPENFORGE_PERF_FULL_DRIVER_ECHO'
  const fullDriverEcho = await executeMeasurement(
    'full-driver-echo',
    `printf '${fullDriverMarker}\\n'`,
    fullDriverMarker,
    byteLength(`${fullDriverMarker}\n`),
    driver.typeTerminalCommand,
  )
  await driver.focusTerminal()
  for (let index = 0; index < echoSampleCount; index += 1) {
    const marker = `OPENFORGE_PERF_ECHO_${index}`
    const echo = await executeMeasurement(
      `echo-${index}`,
      `printf '${marker}\\n'`,
      marker,
      byteLength(`${marker}\n`),
      driver.typeFocusedTerminalCommand,
    )
    echoDurations.push(echo.durationMs)
  }

  const bulkMarker = 'OPENFORGE_PERF_BULK_INPUT_DONE'
  const bulkPayload = 'b'.repeat(bulkInputBytes)
  const bulkCommand = `printf %s ${shellQuote(bulkPayload)} >/dev/null; printf '${bulkMarker}\\n'`
  const bulk = await executeMeasurement(
    'bulk-input',
    bulkCommand,
    bulkMarker,
    byteLength(`${bulkMarker}\n`),
    driver.typeFocusedTerminalCommand,
  )
  const bulkInput = calculateThroughput(byteLength(bulkCommand), bulk.durationMs)

  const ptyMarker = 'OPENFORGE_PERF_PTY_OUTPUT_DONE'
  const generatorPath = context.fixture.repository?.outputGeneratorPath
    ?? join(context.fixture.manifest.workspacePath, 'terminal-output.mjs')
  const ptyCommand = `node ${shellQuote(generatorPath)} --bytes=${ptyOutputBytes} --marker=${ptyMarker}`
  const expectedPtyBytes = ptyOutputBytes + byteLength(`\n${ptyMarker}\n`)
  const ptyOutput = await executeMeasurement(
    'pty-output',
    ptyCommand,
    ptyMarker,
    expectedPtyBytes,
    driver.typeFocusedTerminalCommand,
  )

  const recoveryStartedAt = now()
  await driver.selectTaskView('Agent')
  await driver.selectTaskView('Terminal')
  await region.waitFor({ state: 'visible' })
  const recoveryDrain = await driver.drainTerminal(terminalKey, {
    marker: ptyMarker,
    timeoutMs: drainTimeoutMs,
  })
  const recoveryDurationMs = now() - recoveryStartedAt
  const recoveryChecks = correctnessChecks(
    'view-recovery',
    recoveryDrain.observation,
    0,
    recoveryDrain,
  )
  checks.push(...recoveryChecks)
  assertCorrectnessChecks(recoveryChecks)
  const postWorkloadMemory = await sampleMemory('after-workload')

  const finalPresentation = recoveryDrain.presentation
  return {
    checks,
    metrics: {
      shellReady: { durationMs: shellReadyDurationMs, unit: 'ms', phaseTimeline },
      driverToPaintedEcho: {
        ...summarizeSamples(echoDurations, { warmupCount: echoWarmupCount }),
        mode: 'already-focused',
      },
      fullDriverToPaintedEcho: { durationMs: fullDriverEcho.durationMs, unit: 'ms' },
      bulkInput,
      ptyOutput: calculateThroughput(ptyOutputBytes, ptyOutput.durationMs),
      viewRecovery: { durationMs: recoveryDurationMs, unit: 'ms' },
    },
    memory: {
      afterShellReady: loadedMemory,
      afterWorkload: postWorkloadMemory,
    },
    fixture: {
      cols: finalPresentation.geometry.cols,
      rows: finalPresentation.geometry.rows,
      renderer: finalPresentation.renderer,
      devicePixelRatio: finalPresentation.devicePixelRatio,
      terminalKey,
      workspacePath: context.fixture.manifest.workspacePath,
    },
    evidence: {
      shellReady: shellReady.drained,
      fullDriverEcho: fullDriverEcho.drained,
      bulkInput: bulk.drained,
      ptyOutput: ptyOutput.drained,
      recovery: recoveryDrain,
    },
  }
}
