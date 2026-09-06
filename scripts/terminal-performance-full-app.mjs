#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { parseDesktopTestOptions } from './desktop-test/cli-options.mjs'
import { createDesktopAppDriver } from './desktop-test/driver.mjs'
import { createDesktopTestLifecycle } from './desktop-test/lifecycle.mjs'
import { sampleDesktopProcessMemory } from './desktop-test/memory.mjs'
import {
  createEnvironmentMetadata,
  createTerminalPerformanceReport,
  serializeTerminalPerformanceReport,
} from './desktop-test/terminal-performance-report.mjs'
import { runTerminalPerformanceScenario } from './desktop-test/terminal-performance-scenario.mjs'

const execFile = promisify(execFileCallback)

async function appRevision() {
  try {
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'])
    return stdout.trim() || null
  } catch {
    return null
  }
}


async function appTrackedWorkingTreeDirty() {
  try {
    await execFile('git', ['diff', '--quiet', 'HEAD', '--'])
    return false
  } catch (error) {
    return Number(error?.code) === 1 ? true : null
  }
}

export async function createAppSourceState() {
  const [revision, trackedWorkingTreeDirty] = await Promise.all([
    appRevision(),
    appTrackedWorkingTreeDirty(),
  ])
  return { revision, trackedWorkingTreeDirty }
}
export async function createFullAppEnvironment(context, provenance = {}) {
  const sourceState = provenance.sourceState ?? await createAppSourceState()
  const terminalModelBuild = provenance.terminalModelBuild ?? {
    optimizeMode: process.env.LIBGHOSTTY_VT_SYS_OPTIMIZE ?? null,
    cpuTarget: process.env.LIBGHOSTTY_VT_SYS_CPU ?? 'baseline',
  }
  let userAgent = ''
  try {
    userAgent = await context?.page?.evaluate(() => navigator.userAgent) ?? ''
  } catch {
    // Environment metadata is best-effort and does not affect correctness.
  }
  return createEnvironmentMetadata({
    platform: platform(),
    arch: arch(),
    release: release(),
    cpus: cpus(),
    totalMemoryBytes: totalmem(),
    versions: {
      node: process.versions.node,
      electron: userAgent.match(/Electron\/([^ ]+)/)?.[1] ?? null,
      chrome: userAgent.match(/Chrome\/([^ ]+)/)?.[1] ?? null,
    },
    appRevision: sourceState.revision,
    sourceState,
    terminalModelBuild,
  })
}

function artifactPaths(paths, succeeded) {
  const artifacts = {
    report: paths.reportPath,
    childLog: paths.childLogPath,
  }
  if (succeeded) artifacts.screenshot = join(paths.artifactRoot, 'terminal-performance.png')
  else artifacts.failureScreenshot = paths.failureScreenshotPath
  return artifacts
}

export async function runFullAppTerminalPerformance(options = {}, dependencies = {}) {
  const createLifecycle = dependencies.createLifecycle ?? createDesktopTestLifecycle
  const createDriver = dependencies.createDriver ?? createDesktopAppDriver
  const runScenario = dependencies.runScenario ?? runTerminalPerformanceScenario
  const sampleMemory = dependencies.sampleMemory ?? (async ({ rootPid, page }) => sampleDesktopProcessMemory({
    rootPid,
    readJavascriptHeapUsedBytes: async () => page.evaluate(() => performance.memory?.usedJSHeapSize ?? null),
  }))
  const createEnvironment = dependencies.createEnvironment ?? createFullAppEnvironment
  const createSourceState = dependencies.createSourceState ?? createAppSourceState
  const terminalModelBuild = {
    optimizeMode: 'ReleaseFast',
    cpuTarget: process.env.LIBGHOSTTY_VT_SYS_CPU ?? 'baseline',
  }
  const sourceState = await createSourceState()
  const provenance = { sourceState, terminalModelBuild }
  const persist = dependencies.writeFile ?? writeFile
  const log = dependencies.log ?? console.log
  const lifecycle = createLifecycle({
    ...options,
    ghosttyOptimizeMode: terminalModelBuild.optimizeMode,
  })
  let scenarioResult = null
  let environment = null
  let failure = null

  try {
    const completed = await lifecycle.runScenario(async context => {
      const driver = createDriver(context.page, { timeoutMs: options.timeoutMs, terminalProbe: 'performance' })
      const rootPid = context.launcher.children().electron?.pid ?? null
      const result = await runScenario(context, {
        driver,
        sampleMemory: label => sampleMemory({ label, rootPid, page: context.page }),
      })
      const screenshotPath = join(context.paths.artifactRoot, 'terminal-performance.png')
      await context.page.screenshot({ path: screenshotPath, fullPage: true })
      return { result, environment: await createEnvironment(context, provenance) }
    })
    scenarioResult = completed.result
    environment = completed.environment
  } catch (error) {
    failure = error instanceof Error ? error : new Error(String(error))
    environment = await createEnvironment(lifecycle.getContext?.(), provenance).catch(() => ({}))
  }

  const fallbackArtifactRoot = resolve(options.outputDir ?? 'artifacts/desktop-test/terminal-performance')
  const paths = lifecycle.getPaths?.() ?? {
    artifactRoot: fallbackArtifactRoot,
    childLogPath: join(fallbackArtifactRoot, 'children.log'),
    failureScreenshotPath: join(fallbackArtifactRoot, 'failure.png'),
    reportPath: join(fallbackArtifactRoot, 'report.json'),
  }
  const checks = scenarioResult?.checks ?? [{
    name: 'scenario',
    passed: false,
    message: failure?.message ?? 'scenario did not complete',
    evidence: failure?.stack ? { stack: failure.stack } : {},
  }]
  const report = createTerminalPerformanceReport({
    checks,
    metrics: scenarioResult?.metrics ?? {},
    environment: environment ?? {},
    memory: scenarioResult?.memory ?? {},
    fixture: scenarioResult?.fixture ?? {},
    artifacts: artifactPaths(paths, failure == null),
  })
  await persist(paths.reportPath, serializeTerminalPerformanceReport(report))

  log(`Full-app terminal performance ${report.status}: ${paths.reportPath}`)
  const shellReady = report.metrics.shellReady?.durationMs
  if (shellReady != null) log(`Shell ready: ${shellReady.toFixed(1)} ms`)
  for (const segment of report.metrics.shellReady?.phaseTimeline?.segments ?? []) {
    const label = `  ${segment.startPhase} -> ${segment.endPhase}`
    log(segment.available
      ? `${label}: ${segment.durationMs.toFixed(1)} ms`
      : `${label}: unavailable`)
  }
  if (report.status === 'passed') {
    const throughput = report.metrics.ptyOutput?.bytesPerSecond
    if (throughput != null) log(`Painted PTY throughput: ${(throughput / 1024 / 1024).toFixed(2)} MiB/s`)
  } else {
    log(`Failure: ${failure?.message ?? 'correctness checks failed'}`)
  }
  return { exitCode: report.status === 'passed' ? 0 : 1, report, reportPath: paths.reportPath }
}

export const parseFullAppTerminalPerformanceOptions = parseDesktopTestOptions

export async function main(argv = process.argv.slice(2)) {
  const options = parseFullAppTerminalPerformanceOptions(argv)
  const result = await runFullAppTerminalPerformance(options)
  process.exitCode = result.exitCode
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error)
    process.exitCode = 1
  })
}
