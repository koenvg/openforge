import { writeFile } from 'node:fs/promises'
import { createRedactedEventRecorder, recordAuthenticatedSidecarEvents } from './event-recorder.mjs'
import { readSidecarConnection } from './idle-resource-sampler.mjs'
import { createDesktopTestLifecycle, assertTerminalControlAllowed, validateReuseEndpoint } from './lifecycle.mjs'
import { captureRunArtifacts, persistInvariantRunReport } from './run-report.mjs'

export const INVARIANT_SCENARIO_ORDER = Object.freeze([
  'first-attachment',
  'detach-during-recovery',
  'idle-resources',
])

const DEFAULT_OPTIONS = Object.freeze({
  scenarios: INVARIANT_SCENARIO_ORDER,
  reuseEndpoint: null,
  allowTerminalControl: false,
  retainRuntime: false,
  startupTimeoutMs: 120_000,
  scenarioTimeoutMs: 60_000,
  idleDurationSeconds: 30,
  outputDir: null,
  devMode: false,
})

function positiveNumber(value, option) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${option} must be a positive number`)
  return number
}

function optionValue(argv, index, name) {
  const argument = argv[index]
  const prefix = `${name}=`
  if (argument.startsWith(prefix)) return { value: argument.slice(prefix.length), consumed: 0 }
  if (argument === name) {
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`)
    return { value, consumed: 1 }
  }
  return null
}

export function parseInvariantOptions(argv) {
  const parsed = {
    ...DEFAULT_OPTIONS,
    scenarios: [],
  }
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === '--') continue
    if (argument === '--allow-terminal-control') parsed.allowTerminalControl = true
    else if (argument === '--retain') parsed.retainRuntime = true
    else if (argument === '--dev') parsed.devMode = true
    else {
      const scenario = optionValue(argv, index, '--scenario')
      const reuse = optionValue(argv, index, '--reuse')
      const startupTimeout = optionValue(argv, index, '--startup-timeout')
      const scenarioTimeout = optionValue(argv, index, '--scenario-timeout')
      const idleDuration = optionValue(argv, index, '--idle-duration')
      const output = optionValue(argv, index, '--output')
      const option = scenario ?? reuse ?? startupTimeout ?? scenarioTimeout ?? idleDuration ?? output
      if (!option) throw new Error(`Unknown invariant option: ${argument}`)
      index += option.consumed
      if (scenario) {
        if (!INVARIANT_SCENARIO_ORDER.includes(option.value)) {
          throw new Error(`Unsupported invariant scenario: ${option.value}`)
        }
        parsed.scenarios.push(option.value)
      } else if (reuse) parsed.reuseEndpoint = validateReuseEndpoint(option.value)
      else if (startupTimeout) parsed.startupTimeoutMs = positiveNumber(option.value, '--startup-timeout')
      else if (scenarioTimeout) parsed.scenarioTimeoutMs = positiveNumber(option.value, '--scenario-timeout')
      else if (idleDuration) parsed.idleDurationSeconds = positiveNumber(option.value, '--idle-duration')
      else if (output) parsed.outputDir = option.value
    }
  }
  const selected = new Set(parsed.scenarios.length === 0 ? INVARIANT_SCENARIO_ORDER : parsed.scenarios)
  parsed.scenarios = INVARIANT_SCENARIO_ORDER.filter(name => selected.has(name))
  return parsed
}

function errorDetails(error, phase) {
  return {
    phase,
    name: error instanceof Error ? error.name : 'Error',
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack ?? null : null,
  }
}

function withTimeout(promise, timeoutMs, name, { setTimeoutImpl = setTimeout, clearTimeoutImpl = clearTimeout } = {}) {
  let timeout
  const expired = new Promise((_, reject) => {
    timeout = setTimeoutImpl(() => reject(new Error(`Invariant scenario ${name} timed out after ${timeoutMs} ms`)), timeoutMs)
  })
  return Promise.race([promise, expired]).finally(() => clearTimeoutImpl(timeout))
}

function defaultTraceController(context) {
  const tracing = context?.page?.context?.()?.tracing
  if (!tracing) return null
  return {
    start: () => tracing.start({ screenshots: false, snapshots: false, sources: false }),
    startChunk: name => tracing.startChunk({ title: name }),
    stopChunk: path => tracing.stopChunk({ path }),
    stop: () => tracing.stop(),
  }
}

async function defaultEventRecording(context) {
  const processIdentity = context?.readiness?.process
  const outputPath = context?.paths?.artifactRoot ? `${context.paths.artifactRoot}/events.ndjson` : null
  if (!processIdentity || !outputPath) return null
  await writeFile(outputPath, '', 'utf8')
  const connection = await readSidecarConnection(processIdentity.pid, processIdentity.command)
  const recorder = createRedactedEventRecorder({ outputPath })
  const controller = new AbortController()
  let failure = null
  const completion = recordAuthenticatedSidecarEvents({
    connection,
    recorder,
    signal: controller.signal,
  }).catch((error) => {
    failure = error
    return null
  })
  return {
    outputPath,
    async stop() {
      controller.abort()
      const summary = await completion
      if (failure) throw failure
      return summary
    },
  }
}

function installRunnerSignalHandlers(target, abortController, shutdown) {
  const handlers = new Map([
    ['SIGINT', () => { abortController.abort(new Error('Interrupted by SIGINT')); void shutdown() }],
    ['SIGTERM', () => { abortController.abort(new Error('Interrupted by SIGTERM')); void shutdown() }],
  ])
  for (const [signal, handler] of handlers) target.once(signal, handler)
  return () => {
    for (const [signal, handler] of handlers) target.off(signal, handler)
  }
}
function discoveredProcessIdentities(context) {
  const identities = []
  const readinessProcess = context?.readiness?.process
  if (readinessProcess) identities.push({ role: 'sidecar', ...readinessProcess })
  const children = context?.launcher?.children?.() ?? {}
  for (const [role, child] of Object.entries(children)) {
    if (Number.isInteger(child?.pid)) identities.push({ role, pid: child.pid, parentPid: null })
  }
  return identities
}

export async function finalizeInvariantRunReport(result, { options, context, lifecycle } = {}, dependencies = {}) {
  const artifactRoot = options.outputDir ?? context?.paths?.artifactRoot ?? lifecycle?.getPaths?.()?.artifactRoot
  if (!artifactRoot) throw new Error('Invariant report finalization requires an artifact root')
  const idleScenario = result.scenarioResults.find(entry => entry.name === 'idle-resources')
  const idleEvidence = idleScenario?.idleEvidence ?? {
    status: options.scenarios.includes('idle-resources') ? 'not-run' : 'not-selected',
    complete: false,
    evidenceFailures: [],
    thresholdFailures: [],
  }
  const processIdentities = discoveredProcessIdentities(context)
  const manifest = await captureRunArtifacts({
    artifactRoot,
    childLogs: context?.launcher?.output
      ? [{ name: 'children.log', content: context.launcher.output() }]
      : [],
    traceChunks: result.scenarioResults
      .filter(entry => entry.traceCaptured !== false)
      .map(entry => ({ name: `${entry.name}.zip`, path: `${artifactRoot}/${entry.name}.zip` })),
    screenshots: result.scenarioResults.flatMap(entry => entry.artifacts?.screenshots ?? []),
    eventTimelinePath: `${artifactRoot}/events.ndjson`,
    eventCounts: result.eventSummary ?? null,
    processSnapshots: [{ name: 'processes-final.json', value: processIdentities }],
    idleResults: idleScenario ? [{ name: 'idle.json', value: idleEvidence }] : [],
    errors: result.errors.map((error, index) => ({ name: `error-${index}.json`, value: error })),
  }, dependencies)

  const cleanupFailed = result.errors.some(error => error.phase === 'cleanup')
  const readiness = context?.readiness
    ? {
        complete: context.readiness.durableStartupResumeEvidence === true,
        health: context.readiness.health,
        startupResume: context.readiness.readiness?.startupResume,
        eventStream: context.readiness.eventStream,
      }
    : null
  const report = {
    schemaVersion: 1,
    runId: result.runId,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    status: result.status,
    mode: context?.policy?.mode ?? (options.reuseEndpoint ? 'reuse' : 'isolated'),
    filters: { scenarios: options.scenarios },
    environment: {
      platform: process.platform,
      architecture: process.arch,
      appDataDir: context?.paths?.appDataDir ?? null,
      databasePath: context?.fixture?.manifest?.databasePath ?? null,
      repositoryPath: context?.fixture?.repository?.repoPath ?? null,
    },
    readiness,
    scenarios: result.scenarioResults.map(({ artifacts: _artifacts, ...entry }) => entry),
    processIdentities,
    idleEvidence,
    cleanup: {
      status: cleanupFailed ? 'failed' : 'passed',
      processExitVerified: context?.policy?.ownsProcesses ? !cleanupFailed : false,
      removedPaths: context?.policy?.ownsData && !options.retainRuntime ? [context.paths?.runRoot].filter(Boolean) : [],
      failures: result.errors.filter(error => error.phase === 'cleanup').map(error => error.message),
    },
    artifacts: manifest,
  }
  await persistInvariantRunReport(report, { ...dependencies, reportPath: manifest.report })
  return report
}


export async function runInvariantSuite(options, dependencies = {}) {
  const createLifecycle = dependencies.createLifecycle ?? createDesktopTestLifecycle
  const scenarios = dependencies.scenarios ?? {}
  const createTraceController = dependencies.createTraceController ?? defaultTraceController
  const startEventRecording = dependencies.startEventRecording ?? defaultEventRecording
  const finalizeReport = dependencies.finalizeReport
    ?? ((result, metadata) => finalizeInvariantRunReport(result, metadata, dependencies))
  const targetProcess = dependencies.process ?? process
  const abortController = new AbortController()
  const now = dependencies.now ?? (() => new Date().toISOString())
  const runId = dependencies.createRunId?.() ?? crypto.randomUUID()
  const startedAt = now()
  const lifecycle = createLifecycle({
    reuseEndpoint: options.reuseEndpoint,
    allowTerminalControl: options.allowTerminalControl,
    retainRuntime: options.retainRuntime,
    timeoutMs: options.startupTimeoutMs,
    outputDir: options.outputDir,
    requireSidecarReadiness: true,
    playwrightElectron: options.reuseEndpoint === null,
  })
  let shutdownPromise = null
  const shutdown = () => {
    shutdownPromise ??= Promise.resolve().then(() => lifecycle.shutdown())
    return shutdownPromise
  }
  const removeSignalHandlers = installRunnerSignalHandlers(targetProcess, abortController, shutdown)
  const scenarioResults = []
  const errors = []
  let context = null
  let cleanup = null
  let trace = null

  let eventRecording = null
  let eventSummary = null
  try {
    context = await lifecycle.start()
    eventRecording = await startEventRecording(context)
    trace = createTraceController(context, options)
    await trace?.start?.()
    for (const name of options.scenarios) {
      if (abortController.signal.aborted) break
      const definition = scenarios[name]
      if (!definition?.run) throw new Error(`Invariant scenario is not implemented: ${name}`)
      if (definition.mutating) {
        assertTerminalControlAllowed(context.policy, {
          rendererE2eEnabled: context.rendererIdentity?.e2eEnabled ?? context.policy.mode === 'isolated',
        })
      }
      const tracePath = context.paths?.artifactRoot ? `${context.paths.artifactRoot}/${name}.zip` : `${name}.zip`
      await trace?.startChunk?.(name)
      try {
        const result = await withTimeout(
          Promise.resolve(definition.run({ context, options, signal: abortController.signal })),
          options.scenarioTimeoutMs,
          name,
          dependencies,
        )
        scenarioResults.push({ name, status: 'passed', ...result })
      } catch (error) {
        const details = errorDetails(error, `scenario:${name}`)
        errors.push(details)
        const screenshots = []
        if (context?.page?.screenshot) {
          const content = await context.page.screenshot({ fullPage: true }).catch(() => null)
          if (content) screenshots.push({ name: `${name}-failure.png`, content })
        }
        scenarioResults.push({
          name,
          status: 'failed',
          error: details,
          artifacts: { screenshots },
        })
        if (definition.mutating) break
      } finally {
        await trace?.stopChunk?.(tracePath)
      }
    }
  } catch (error) {
    errors.push(errorDetails(error, context ? 'orchestration' : 'launch'))
  } finally {
    if (abortController.signal.aborted && !errors.some(error => error.phase === 'signal')) {
      errors.push(errorDetails(abortController.signal.reason ?? new Error('Invariant run interrupted'), 'signal'))
    }
    try {
      eventSummary = await eventRecording?.stop?.() ?? null
    } catch (error) {
      errors.push(errorDetails(error, 'event-recorder-cleanup'))
    }
    try {
      await trace?.stop?.()
    } catch (error) {
      errors.push(errorDetails(error, 'trace-cleanup'))
    }
    try {
      cleanup = await shutdown()
    } catch (error) {
      errors.push(errorDetails(error, 'cleanup'))
      cleanup = { status: 'failed', failures: [error instanceof Error ? error.message : String(error)] }
    }
    removeSignalHandlers()
  }

  const result = {
    runId,
    startedAt,
    finishedAt: now(),
    status: errors.length === 0 && scenarioResults.every(entry => entry.status === 'passed') ? 'passed' : 'failed',
    scenarioResults,
    errors,
    eventSummary,
    cleanup,
    context,
  }
  await finalizeReport(result, { options, context, lifecycle })
  return result
}
