import { join } from 'node:path'
import { createDesktopAppDriver } from './driver.mjs'
import {
  discoverSessionDaemon,
  fetchProcessMemoryDiagnostics,
  readProcessRows,
  readSidecarConnection,
  sampleIdleResources,
} from './idle-resource-sampler.mjs'

const QUIET_SHELL_CPU_SECONDS = 0.02

const REQUIRED_IDLE_PROCESS_ROLES = ['electron-main', 'sidecar', 'renderer', 'gpu']

function assertIdleSample(sample) {
  if (!sample?.passed) {
    const failures = sample?.failures?.length ? sample.failures.join('; ') : 'idle sample did not pass'
    throw new Error(`Idle resource evidence failed: ${failures}`)
  }
  for (const role of REQUIRED_IDLE_PROCESS_ROLES) {
    const process = sample.processes?.find(candidate => candidate.role === role)
    if (!process) throw new Error(`Idle sample is missing required stable process role ${role}`)
    if (!Number.isInteger(process.pid)
      || !Number.isFinite(process.averageCores)
      || !Number.isFinite(process.rssBytes)
      || !Number.isFinite(process.vmmap?.currentBytes)
      || !Number.isFinite(process.vmmap?.peakBytes)) {
      throw new Error(`Idle ${role} metrics are unavailable`)
    }
  }
  if (!Number.isFinite(sample.durationSeconds) || sample.durationSeconds <= 0
    || !Number.isFinite(sample.eventRate) || !Number.isFinite(sample.eventCount)) {
    throw new Error('Idle event duration or rate evidence is unavailable')
  }
}

function assertMemoryEvidence(memory, sidecarPid) {
  if (memory?.sidecar?.pid !== sidecarPid || !Number.isFinite(memory.sidecar.rssBytes) || memory.sidecar.rssBytes <= 0) {
    throw new Error('Sidecar debug-memory RSS is unavailable')
  }
  if (!Number.isFinite(memory.totals?.electronTotalTreeRssBytes)
    || !Number.isFinite(memory.totals?.trackedUniqueRssBytes)) {
    throw new Error('Debug-memory aggregate metrics are unavailable')
  }
  if (!Array.isArray(memory.ptyProcessTrees)) {
    throw new Error('Debug-memory PTY process-tree evidence is unavailable')
  }
}

export async function waitForQuietSessionDaemonShells({ scope, count, timeoutMs, pollMs = 1_000 }, {
  readProcesses = readProcessRows,
  wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  now = Date.now,
} = {}) {
  const deadline = now() + timeoutMs
  let previous = null
  for (;;) {
    const rows = await readProcesses()
    const daemon = discoverSessionDaemon(rows, scope)
    if (daemon && daemon.childPids.length >= count) {
      const identity = daemon.childPids.join(',')
      const cpuSeconds = rows
        .filter(row => row.parentPid === daemon.pid)
        .reduce((total, row) => total + row.cpuSeconds, 0)
      if (previous?.identity === identity && cpuSeconds - previous.cpuSeconds < QUIET_SHELL_CPU_SECONDS) {
        return { pid: daemon.pid, childCount: daemon.childPids.length }
      }
      previous = { identity, cpuSeconds }
    } else {
      previous = null
    }
    if (now() >= deadline) {
      throw new Error(`Expected ${count} quiet shells in the isolated session daemon within ${timeoutMs} ms`)
    }
    await wait(pollMs)
  }
}

export async function runIdleResourceScenario({ context, options }, dependencies = {}) {
  const manifest = context?.fixture?.manifest
  const sidecarProcess = context?.readiness?.process
  const reuseMode = context?.policy?.mode === 'reuse'
  if (!reuseMode && !manifest?.taskId) throw new Error('Idle-resource scenario requires an isolated fixture task')
  if (!Number.isInteger(sidecarProcess?.pid) || typeof sidecarProcess.command !== 'string') {
    throw new Error('Idle-resource scenario requires authenticated Sidecar process evidence')
  }
  const createDriver = dependencies.createDriver ?? createDesktopAppDriver
  const sampleIdle = dependencies.sampleIdle ?? sampleIdleResources
  const readConnection = dependencies.readConnection ?? readSidecarConnection
  const fetchMemory = dependencies.fetchMemory ?? fetchProcessMemoryDiagnostics
  const waitForIdleShells = dependencies.waitForIdleShells ?? waitForQuietSessionDaemonShells
  const durationSeconds = options.idleDurationSeconds ?? 30
  const idleShellCount = options.idleShells ?? 0
  if (reuseMode && idleShellCount > 0) throw new Error('Idle shells require an isolated fixture')
  const sessionDaemonScope = !reuseMode && context?.paths?.appDataDir
    ? join(context.paths.appDataDir, 'session-daemon')
    : null
  const instanceIds = []
  if (!reuseMode) {
    const driver = createDriver(context.page, { timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000) })
    await driver.verifyDesktopBridge()
    await driver.selectSeededTask(manifest)
    const attached = await driver.attachTerminalView(manifest.taskId)
    await driver.detachTerminalView(attached.region, { projectName: manifest.projectName })
    await driver.waitForUiQuiescence()
    if (idleShellCount > 0) {
      for (let terminalIndex = 1; terminalIndex <= idleShellCount; terminalIndex += 1) {
        instanceIds.push(await driver.spawnShellPty({
          taskId: manifest.taskId,
          cwd: manifest.workspacePath,
          terminalIndex,
        }))
      }
      await waitForIdleShells({
        scope: sessionDaemonScope,
        count: idleShellCount,
        timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000),
      })
      await driver.waitForUiQuiescence()
    }
  }

  const idle = await sampleIdle({ durationSeconds, sidecarPid: sidecarProcess.pid, sessionDaemonScope })
  assertIdleSample(idle)
  if (idleShellCount > 0 && !(idle.sessionDaemon?.childCount >= idleShellCount)) {
    throw new Error('Idle shells were not sampled in the isolated session daemon')
  }
  const connection = await readConnection(sidecarProcess.pid, sidecarProcess.command)
  const memory = await fetchMemory(connection)
  assertMemoryEvidence(memory, sidecarProcess.pid)

  return {
    assertions: [
      { name: 'required processes remained stable', passed: true },
      { name: 'event stream covered idle window', passed: true },
      { name: 'idle thresholds passed', passed: true },
      { name: 'debug memory evidence available', passed: true },
    ],
    idleEvidence: {
      status: 'passed',
      complete: true,
      ...idle,
      ...(idleShellCount > 0 ? { idleShells: { requested: idleShellCount, instanceIds } } : {}),
    },
    diagnostics: { idle, memory },
  }
}
