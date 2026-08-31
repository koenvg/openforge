import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const MAX_PROCESS_OUTPUT_BYTES = 16 * 1024 * 1024
const REQUIRED_ROLES = new Set(['electron-main', 'sidecar', 'renderer', 'gpu', 'plugin-host'])
const REDACTED_DIAGNOSTIC_KEYS = new Set([
  'pluginId',
  'projectId',
  'repositoryPath',
  'taskId',
  'terminalKey',
  'workspacePath',
])

export const DEFAULT_IDLE_OPTIONS = Object.freeze({
  durationSeconds: 30,
  sidecarPid: null,
  maxAverageCores: 0.35,
  maxEventRate: 20,
  maxSidecarPeakMiB: 1024,
})

export function parseCpuTime(value) {
  const [daysPart, clockPart] = value.includes('-')
    ? value.trim().split('-', 2)
    : ['0', value.trim()]
  const clock = clockPart.split(':').map(Number)
  const seconds = clock.reduce((total, part) => total * 60 + part, 0)
  return Number(daysPart) * 86_400 + seconds
}

export function parseFootprintBytes(value) {
  const match = value.trim().match(/^([\d.]+)([KMG])$/i)
  if (!match) throw new Error(`Unsupported vmmap footprint: ${value}`)
  const scales = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 }
  return Number(match[1]) * scales[match[2].toUpperCase()]
}

export function parseVmmapSummary(output) {
  const current = output.match(/^Physical footprint:\s+([\d.]+[KMG])$/m)?.[1]
  const peak = output.match(/^Physical footprint \(peak\):\s+([\d.]+[KMG])$/m)?.[1]
  return {
    currentBytes: current ? parseFootprintBytes(current) : null,
    peakBytes: peak ? parseFootprintBytes(peak) : null,
  }
}

export class EventRateCounter {
  #buffer = ''
  #counts = new Map()
  events = 0
  payloadBytes = 0

  accept(chunk) {
    this.#buffer += chunk
    for (;;) {
      const boundary = this.#buffer.search(/\r?\n\r?\n/)
      if (boundary < 0) return
      const separator = this.#buffer.slice(boundary).match(/^\r?\n\r?\n/)[0]
      const frame = this.#buffer.slice(0, boundary)
      this.#buffer = this.#buffer.slice(boundary + separator.length)
      const data = frame
        .split(/\r?\n/)
        .filter(line => line.startsWith('data:'))
        .map(line => line.slice(5).trimStart())
        .join('\n')
      if (!data) continue
      try {
        const envelope = JSON.parse(data)
        if (typeof envelope.eventName !== 'string') continue
        this.events += 1
        this.payloadBytes += Buffer.byteLength(data)
        this.#counts.set(envelope.eventName, (this.#counts.get(envelope.eventName) ?? 0) + 1)
      } catch {
        // Invalid frames are not events. Stream completeness is evaluated separately.
      }
    }
  }

  topEventTypes(limit = 10) {
    return [...this.#counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([eventName, count]) => ({ eventName, count }))
  }
}

export function parseIdleOptions(argv) {
  const options = { ...DEFAULT_IDLE_OPTIONS }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--') continue
    const nextNumber = () => {
      const next = Number(argv[index += 1])
      if (!Number.isFinite(next) || next <= 0) throw new Error(`Invalid value for ${value}`)
      return next
    }
    if (value === '--duration') options.durationSeconds = nextNumber()
    else if (value === '--sidecar-pid') options.sidecarPid = nextNumber()
    else if (value === '--max-average-cores') options.maxAverageCores = nextNumber()
    else if (value === '--max-event-rate') options.maxEventRate = nextNumber()
    else if (value === '--max-sidecar-peak-mib') options.maxSidecarPeakMiB = nextNumber()
    else if (value === '--no-thresholds') {
      options.maxAverageCores = null
      options.maxEventRate = null
      options.maxSidecarPeakMiB = null
    } else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

export function parseProcessRows(output) {
  return output.split('\n').flatMap(line => {
    const match = line.match(/^\s*(\d+)\s+(\d+)\s+([\d:.-]+)\s+(\d+)\s+(.*)$/)
    return match ? [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      cpuSeconds: parseCpuTime(match[3]),
      rssBytes: Number(match[4]) * 1024,
      command: match[5],
    }] : []
  })
}
export function isOpenForgeSidecarCommand(command) {
  return /(?:^|\/)openforge(?:-sidecar)?\s+.*?--port(?:=|\s+)\d+(?:\s|$)/.test(command)
}


export function idleProcessRole(command) {
  if (isOpenForgeSidecarCommand(command)) return 'sidecar'
  if (command.includes('plugin-host')) return 'plugin-host'
  if (command.includes('(Renderer)')) return 'renderer'
  if (command.includes('gpu-process')) return 'gpu'
  if (command.includes('--type=utility')) return 'utility'
  return 'electron-main'
}
export function discoverSidecarForElectron(rows, electronPid, expectedPort = null) {
  const sidecars = expectedPort === null
    ? rows.filter(row => row.parentPid === electronPid && isOpenForgeSidecarCommand(row.command))
    : rows.filter(row => {
        if (!isOpenForgeSidecarCommand(row.command)) return false
        const escapedPort = String(expectedPort).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        return new RegExp(`--port(?:=|\\s+)${escapedPort}(?:\\s|$)`).test(row.command)
      })
  if (sidecars.length === 0) {
    if (expectedPort !== null) {
      throw new Error(`No Sidecar on allocated port ${expectedPort} for Electron PID ${electronPid}`)
    }
    throw new Error(`No Sidecar owned by Electron PID ${electronPid}`)
  }
  if (sidecars.length !== 1) {
    const identity = expectedPort === null
      ? `owned by Electron PID ${electronPid}`
      : `on allocated port ${expectedPort} for Electron PID ${electronPid}`
    throw new Error(`Expected one Sidecar ${identity}, found ${sidecars.length}`)
  }
  return sidecars[0]
}


export function discoverIdleProcessSet(rows, requestedSidecarPid = null) {
  const sidecars = rows.filter(row => isOpenForgeSidecarCommand(row.command))
  const sidecar = requestedSidecarPid === null
    ? (sidecars.length === 1 ? sidecars[0] : null)
    : sidecars.find(row => row.pid === requestedSidecarPid)
  if (!sidecar) {
    throw new Error(requestedSidecarPid === null
      ? `Expected one OpenForge sidecar, found ${sidecars.length}; pass --sidecar-pid`
      : `OpenForge sidecar PID ${requestedSidecarPid} was not found`)
  }

  const electronPid = sidecar.parentPid
  const selected = rows
    .filter(row => (
      row.pid === electronPid
      || row.pid === sidecar.pid
      || row.parentPid === electronPid
      || (row.parentPid === sidecar.pid && row.command.includes('plugin-host'))
    ))
    .map(row => ({ ...row, role: row.pid === sidecar.pid ? 'sidecar' : idleProcessRole(row.command) }))

  const roleOrder = ['electron-main', 'sidecar', 'renderer', 'gpu', 'plugin-host']
  const required = selected
    .filter(row => REQUIRED_ROLES.has(row.role))
    .sort((left, right) => roleOrder.indexOf(left.role) - roleOrder.indexOf(right.role) || left.pid - right.pid)
  const optional = selected.filter(row => !REQUIRED_ROLES.has(row.role))

  for (const role of ['electron-main', 'sidecar', 'renderer', 'gpu']) {
    if (!required.some(row => row.role === role)) {
      throw new Error(`Required idle process role ${role} was not discovered`)
    }
  }
  return { sidecar: required.find(row => row.role === 'sidecar'), required, optional }
}

function evidenceFailureForMetric(process, name, value, phase) {
  return Number.isFinite(value) ? null : `${process.role} PID ${process.pid} has no ${phase} ${name}`
}

export function evaluateIdleSample({
  processSet,
  afterRows,
  durationSeconds,
  eventEvidence,
  footprints,
  thresholds,
}) {
  const afterByPid = new Map(afterRows.map(row => [row.pid, row]))
  const evidenceFailures = []
  const processes = []

  for (const before of processSet.required) {
    const after = afterByPid.get(before.pid)
    if (!after || after.command !== before.command) {
      evidenceFailures.push(`${before.role} PID ${before.pid} exited or changed identity during the sample`)
      continue
    }
    for (const failure of [
      evidenceFailureForMetric(before, 'CPU counter', before.cpuSeconds, 'starting'),
      evidenceFailureForMetric({ ...after, role: before.role }, 'CPU counter', after.cpuSeconds, 'ending'),
      evidenceFailureForMetric({ ...after, role: before.role }, 'RSS', after.rssBytes, 'ending'),
    ]) {
      if (failure) evidenceFailures.push(failure)
    }
    if (!Number.isFinite(before.cpuSeconds) || !Number.isFinite(after.cpuSeconds) || !Number.isFinite(after.rssBytes)) continue
    const cpuDeltaSeconds = Math.max(0, after.cpuSeconds - before.cpuSeconds)
    processes.push({
      role: before.role,
      label: before.role,
      pid: before.pid,
      cpuDeltaSeconds,
      averageCores: cpuDeltaSeconds / durationSeconds,
      rssBytes: after.rssBytes,
      vmmap: footprints.get(before.pid) ?? { currentBytes: null, peakBytes: null },
    })
  }

  const sidecar = processSet.sidecar
  const sidecarFootprint = footprints.get(sidecar.pid)
  if (!sidecarFootprint || !Number.isFinite(sidecarFootprint.currentBytes)) {
    evidenceFailures.push(`sidecar PID ${sidecar.pid} has no current footprint`)
  }
  if (!sidecarFootprint || !Number.isFinite(sidecarFootprint.peakBytes)) {
    evidenceFailures.push(`sidecar PID ${sidecar.pid} has no peak footprint`)
  }

  const requiredDurationMs = durationSeconds * 1000
  if (!eventEvidence?.complete || !Number.isFinite(eventEvidence.durationMs) || eventEvidence.durationMs < requiredDurationMs - 250) {
    evidenceFailures.push(`event stream covered ${eventEvidence?.durationMs ?? 0} ms of required ${requiredDurationMs} ms`)
  }

  const averageCores = processes.reduce((total, process) => total + process.averageCores, 0)
  const eventCount = Number.isFinite(eventEvidence?.eventCount) ? eventEvidence.eventCount : 0
  const eventRate = eventCount / durationSeconds
  const thresholdFailures = []
  if (thresholds.maxAverageCores !== null && averageCores > thresholds.maxAverageCores) {
    thresholdFailures.push(`average cores ${averageCores.toFixed(3)} > ${thresholds.maxAverageCores}`)
  }
  if (thresholds.maxEventRate !== null && eventRate > thresholds.maxEventRate) {
    thresholdFailures.push(`event rate ${eventRate.toFixed(1)}/s > ${thresholds.maxEventRate}/s`)
  }
  if (Number.isFinite(sidecarFootprint?.peakBytes)) {
    const peakMiB = sidecarFootprint.peakBytes / (1024 ** 2)
    if (thresholds.maxSidecarPeakMiB !== null && peakMiB > thresholds.maxSidecarPeakMiB) {
      thresholdFailures.push(`sidecar peak ${peakMiB.toFixed(1)} MiB > ${thresholds.maxSidecarPeakMiB} MiB`)
    }
  }

  return {
    durationSeconds,
    averageCores,
    eventRate,
    eventCount,
    eventPayloadBytes: eventEvidence?.payloadBytes ?? 0,
    topEventTypes: eventEvidence?.topEventTypes ?? [],
    processes,
    optionalProcesses: processSet.optional,
    thresholds,
    evidenceFailures,
    thresholdFailures,
    failures: [...evidenceFailures, ...thresholdFailures],
    passed: evidenceFailures.length === 0 && thresholdFailures.length === 0,
  }
}

export async function readProcessRows({ execFileImpl = execFile } = {}) {
  const { stdout } = await execFileImpl('ps', ['-axo', 'pid=,ppid=,time=,rss=,command='], {
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  })
  return parseProcessRows(stdout)
}

export async function readSidecarConnection(sidecarPid, command, {
  execFileImpl = execFile,
  environment = process.env,
} = {}) {
  const { stdout } = await execFileImpl('ps', ['eww', '-p', String(sidecarPid)], {
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  })
  const token = stdout.match(/OPENFORGE_BACKEND_TOKEN=([^\s]+)/)?.[1]
    ?? environment.OPENFORGE_IDLE_BACKEND_TOKEN
    ?? null
  if (!token) throw new Error('Could not read the sidecar event token; set OPENFORGE_IDLE_BACKEND_TOKEN')
  const port = Number(command.match(/--port\s+(\d+)/)?.[1])
  if (!Number.isInteger(port)) throw new Error('Could not read the sidecar event port from its command')
  return { port, token }
}

export async function collectEventEvidence(sidecar, durationSeconds, {
  fetchImpl = fetch,
  readConnection = readSidecarConnection,
  nowMs = Date.now,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  const connection = await readConnection(sidecar.pid, sidecar.command)
  const controller = new AbortController()
  const startedAt = nowMs()
  const timeout = setTimeoutImpl(() => controller.abort(), durationSeconds * 1000)
  const counter = new EventRateCounter()
  let complete = false
  try {
    const response = await fetchImpl(`http://127.0.0.1:${connection.port}/app/events`, {
      headers: { Authorization: `Bearer ${connection.token}` },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`Event stream returned HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        complete = nowMs() - startedAt >= durationSeconds * 1000 - 250
        break
      }
      if (value) counter.accept(decoder.decode(value, { stream: true }))
    }
  } catch (error) {
    if (error?.name === 'AbortError') complete = true
    else throw error
  } finally {
    clearTimeoutImpl(timeout)
  }
  return {
    complete,
    durationMs: Math.min(nowMs() - startedAt, durationSeconds * 1000),
    eventCount: counter.events,
    payloadBytes: counter.payloadBytes,
    topEventTypes: counter.topEventTypes(),
  }
}

export async function collectVmmapFootprint(pid, { execFileImpl = execFile } = {}) {
  const { stdout } = await execFileImpl('vmmap', ['-summary', String(pid)], {
    maxBuffer: MAX_PROCESS_OUTPUT_BYTES,
  })
  return parseVmmapSummary(stdout)
}

export async function sampleIdleResources(options = {}, dependencies = {}) {
  const resolved = { ...DEFAULT_IDLE_OPTIONS, ...options }
  const {
    readProcesses = readProcessRows,
    collectEvents = collectEventEvidence,
    collectFootprint = collectVmmapFootprint,
    wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
    now = () => new Date(),
    platform = process.platform,
  } = dependencies

  if (platform !== 'darwin') {
    return {
      measuredAt: now().toISOString(),
      durationSeconds: resolved.durationSeconds,
      processes: [],
      evidenceFailures: [`Sidecar peak footprint is unsupported on ${platform}`],
      thresholdFailures: [],
      failures: [`Sidecar peak footprint is unsupported on ${platform}`],
      passed: false,
    }
  }

  const beforeRows = await readProcesses()
  const processSet = discoverIdleProcessSet(beforeRows, resolved.sidecarPid)
  const [eventEvidence, afterRows] = await Promise.all([
    collectEvents(processSet.sidecar, resolved.durationSeconds),
    wait(resolved.durationSeconds * 1000).then(() => readProcesses()),
  ])
  const footprints = new Map(await Promise.all(processSet.required.map(async process => {
    try {
      return [process.pid, await collectFootprint(process.pid)]
    } catch (error) {
      return [process.pid, {
        currentBytes: null,
        peakBytes: null,
        error: error instanceof Error ? error.message : String(error),
      }]
    }
  })))
  return {
    measuredAt: now().toISOString(),
    ...evaluateIdleSample({
      processSet,
      afterRows,
      durationSeconds: resolved.durationSeconds,
      eventEvidence,
      footprints,
      thresholds: {
        maxAverageCores: resolved.maxAverageCores,
        maxEventRate: resolved.maxEventRate,
        maxSidecarPeakMiB: resolved.maxSidecarPeakMiB,
      },
    }),
  }
}

function redactDiagnostics(value) {
  if (Array.isArray(value)) return value.map(redactDiagnostics)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    REDACTED_DIAGNOSTIC_KEYS.has(key) ? '[redacted]' : redactDiagnostics(nested),
  ]))
}

export async function fetchProcessMemoryDiagnostics(connection, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`http://127.0.0.1:${connection.port}/debug/process-memory`, {
    headers: { Authorization: `Bearer ${connection.token}` },
  })
  if (!response.ok) throw new Error(`Process-memory diagnostics returned HTTP ${response.status}`)
  return redactDiagnostics(await response.json())
}
