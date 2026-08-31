import { createDesktopAppDriver } from './driver.mjs'
import {
  fetchProcessMemoryDiagnostics,
  readSidecarConnection,
  sampleIdleResources,
} from './idle-resource-sampler.mjs'

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
  const durationSeconds = options.idleDurationSeconds ?? 30
  if (!reuseMode) {
    const driver = createDriver(context.page, { timeoutMs: Math.min(options.scenarioTimeoutMs, 20_000) })
    await driver.verifyDesktopBridge()
    await driver.selectSeededTask(manifest)
    const attached = await driver.attachTerminalView(manifest.taskId)
    await driver.detachTerminalView(attached.region, { projectName: manifest.projectName })
    await driver.waitForUiQuiescence()
  }

  const idle = await sampleIdle({ durationSeconds, sidecarPid: sidecarProcess.pid })
  assertIdleSample(idle)
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
    idleEvidence: { status: 'passed', complete: true, ...idle },
    diagnostics: { idle, memory },
  }
}
