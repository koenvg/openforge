#!/usr/bin/env node
import { execFile as execFileCallback } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'

const execFile = promisify(execFileCallback)
const DEFAULTS = {
  durationSeconds: 30,
  maxAverageCores: 0.35,
  maxEventRate: 20,
  maxSidecarPeakMiB: 1024,
}

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
        // A malformed SSE frame should not invalidate the rest of the measurement.
      }
    }
  }

  topEventTypes(limit = 10) {
    return [...this.#counts.entries()]
      .sort((left, right) => right[1] - left[1])
      .slice(0, limit)
      .map(([eventName, count]) => ({ eventName, count }))
  }
}

function parseArgs(argv) {
  const options = { ...DEFAULTS, sidecarPid: null }
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

async function processRows() {
  const { stdout } = await execFile('ps', ['-axo', 'pid=,ppid=,time=,rss=,command='], { maxBuffer: 16 * 1024 * 1024 })
  return stdout.split('\n').flatMap(line => {
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

function discoverCoreProcesses(rows, requestedSidecarPid) {
  const sidecars = rows.filter(row => row.command.includes('openforge-sidecar'))
  const sidecar = requestedSidecarPid
    ? rows.find(row => row.pid === requestedSidecarPid)
    : sidecars.length === 1 ? sidecars[0] : null
  if (!sidecar) {
    throw new Error(requestedSidecarPid
      ? `OpenForge sidecar PID ${requestedSidecarPid} was not found`
      : `Expected one OpenForge sidecar, found ${sidecars.length}; pass --sidecar-pid`)
  }
  const rootPid = sidecar.parentPid
  const core = rows.filter(row => (
    row.pid === rootPid
    || row.pid === sidecar.pid
    || row.parentPid === rootPid
    || (row.parentPid === sidecar.pid && row.command.includes('plugin-host'))
  ))
  return { sidecar, core }
}

async function backendToken(sidecarPid) {
  const { stdout } = await execFile('ps', ['eww', '-p', String(sidecarPid)], { maxBuffer: 16 * 1024 * 1024 })
  return stdout.match(/OPENFORGE_BACKEND_TOKEN=([^\s]+)/)?.[1]
    ?? process.env.OPENFORGE_IDLE_BACKEND_TOKEN
    ?? null
}

async function sampleEvents(sidecar, durationSeconds) {
  const token = await backendToken(sidecar.pid)
  if (!token) throw new Error('Could not read the sidecar event token; set OPENFORGE_IDLE_BACKEND_TOKEN')
  const port = sidecar.command.match(/--port\s+(\d+)/)?.[1]
  if (!port) throw new Error('Could not read the sidecar event port from its command')
  const controller = new AbortController()
  const startedAt = Date.now()
  const timeout = setTimeout(() => controller.abort(), durationSeconds * 1000)
  const counter = new EventRateCounter()
  try {
    const response = await fetch(`http://127.0.0.1:${port}/app/events`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    })
    if (!response.ok || !response.body) throw new Error(`Event stream returned HTTP ${response.status}`)
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        const elapsedMs = Date.now() - startedAt
        if (elapsedMs < durationSeconds * 1000 - 250) {
          throw new Error(`Event stream ended after ${elapsedMs} ms; refusing a partial sample`)
        }
        break
      }
      if (value) counter.accept(decoder.decode(value, { stream: true }))
    }
  } catch (error) {
    if (error?.name !== 'AbortError') throw error
  } finally {
    clearTimeout(timeout)
  }
  return counter
}

async function vmmapSummary(pid) {
  const { stdout } = await execFile('vmmap', ['-summary', String(pid)], { maxBuffer: 16 * 1024 * 1024 })
  return parseVmmapSummary(stdout)
}

function processLabel(command) {
  if (command.includes('openforge-sidecar')) return 'sidecar'
  if (command.includes('plugin-host')) return 'plugin-host'
  if (command.includes('(Renderer)')) return 'renderer'
  if (command.includes('gpu-process')) return 'gpu'
  if (command.includes('--type=utility')) return 'utility'
  return 'electron-main'
}

async function run() {
  if (process.platform !== 'darwin') throw new Error('This check currently requires macOS ps and vmmap')
  const options = parseArgs(process.argv.slice(2))
  const beforeRows = await processRows()
  const { sidecar, core } = discoverCoreProcesses(beforeRows, options.sidecarPid)
  const eventPromise = sampleEvents(sidecar, options.durationSeconds)
  const afterRowsPromise = new Promise(resolve => {
    setTimeout(resolve, options.durationSeconds * 1000)
  }).then(() => processRows())
  const [counter, afterRows] = await Promise.all([eventPromise, afterRowsPromise])
  const afterByPid = new Map(afterRows.map(row => [row.pid, row]))
  if (!afterByPid.has(sidecar.pid)) {
    throw new Error(`Sidecar PID ${sidecar.pid} exited during the sample`)
  }
  const processes = await Promise.all(core.map(async before => {
    const after = afterByPid.get(before.pid)
    if (!after) return null
    const cpuDeltaSeconds = Math.max(0, after.cpuSeconds - before.cpuSeconds)
    return {
      label: after.pid === sidecar.pid ? 'sidecar' : processLabel(after.command),
      pid: after.pid,
      cpuDeltaSeconds,
      averageCores: cpuDeltaSeconds / options.durationSeconds,
      rssBytes: after.rssBytes,
      vmmap: await vmmapSummary(after.pid),
    }
  }))
  const liveProcesses = processes.filter(Boolean)
  const averageCores = liveProcesses.reduce((total, process) => total + process.averageCores, 0)
  const eventRate = counter.events / options.durationSeconds
  const sidecarResult = liveProcesses.find(process => process.pid === sidecar.pid)
  const failures = []
  if (options.maxAverageCores !== null && averageCores > options.maxAverageCores) {
    failures.push(`average cores ${averageCores.toFixed(3)} > ${options.maxAverageCores}`)
  }
  if (options.maxEventRate !== null && eventRate > options.maxEventRate) {
    failures.push(`event rate ${eventRate.toFixed(1)}/s > ${options.maxEventRate}/s`)
  }
  if (!sidecarResult) throw new Error('Sidecar process was omitted from the measurement')
  if (sidecarResult.vmmap.peakBytes === null) {
    throw new Error('vmmap did not report the Sidecar peak physical footprint')
  }
  const peakMiB = sidecarResult.vmmap.peakBytes / (1024 ** 2)
  if (options.maxSidecarPeakMiB !== null && peakMiB > options.maxSidecarPeakMiB) {
    failures.push(`sidecar peak ${peakMiB.toFixed(1)} MiB > ${options.maxSidecarPeakMiB} MiB`)
  }
  console.log(JSON.stringify({
    measuredAt: new Date().toISOString(),
    durationSeconds: options.durationSeconds,
    averageCores,
    eventRate,
    eventCount: counter.events,
    eventPayloadBytes: counter.payloadBytes,
    topEventTypes: counter.topEventTypes(),
    processes: liveProcesses,
    thresholds: {
      maxAverageCores: options.maxAverageCores,
      maxEventRate: options.maxEventRate,
      maxSidecarPeakMiB: options.maxSidecarPeakMiB,
    },
    failures,
  }, null, 2))
  if (failures.length > 0) process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().catch(error => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
