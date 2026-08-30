import { execFile as execFileCallback } from 'node:child_process'
import { platform as hostPlatform } from 'node:os'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)

export function parseNativeProcessRows(output) {
  return output.split('\n').flatMap(line => {
    const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/)
    if (!match) return []
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      rssKiB: Number(match[3]),
      command: match[4],
    }]
  })
}

export async function readNativeProcessRows({
  platform = hostPlatform(),
  execFileCommand = execFile,
} = {}) {
  if (platform === 'win32') return []
  try {
    const { stdout } = await execFileCommand('ps', ['-axo', 'pid=,ppid=,rss=,command='], {
      maxBuffer: 16 * 1024 * 1024,
    })
    return parseNativeProcessRows(stdout)
  } catch {
    return []
  }
}

function selectProcessTree(rows, rootPid) {
  const selected = new Set([rootPid])
  let changed = true
  while (changed) {
    changed = false
    for (const row of rows) {
      if (selected.has(row.parentPid) && !selected.has(row.pid)) {
        selected.add(row.pid)
        changed = true
      }
    }
  }
  return rows.filter(row => selected.has(row.pid))
}

function unavailable(reason) {
  return { available: false, bytes: null, reason }
}

function rssMeasurement(rows, reason) {
  if (rows.length === 0) return unavailable(reason)
  return {
    available: true,
    bytes: rows.reduce((total, row) => total + row.rssKiB * 1024, 0),
  }
}

export async function sampleDesktopProcessMemory({
  rootPid,
  readProcessRows = readNativeProcessRows,
  readJavascriptHeapUsedBytes = async () => null,
  now = () => new Date().toISOString(),
} = {}) {
  const rows = await readProcessRows()
  const rootPresent = rootPid != null && rows.some(row => row.pid === rootPid)
  const processRows = rootPresent ? selectProcessTree(rows, rootPid) : []
  const processReason = 'Electron process information is unavailable'
  const javascriptHeapUsedBytes = await readJavascriptHeapUsedBytes()

  return {
    capturedAt: now(),
    native: {
      app: rootPresent
        ? rssMeasurement(processRows.filter(row => row.pid === rootPid), processReason)
        : unavailable(processReason),
      processTree: rssMeasurement(processRows, processReason),
      renderer: rootPresent
        ? rssMeasurement(
            processRows.filter(row => /--type=renderer|\(Renderer\)/i.test(row.command)),
            'Electron renderer process information is unavailable',
          )
        : unavailable(processReason),
      gpu: rootPresent
        ? rssMeasurement(
            processRows.filter(row => /--type=gpu-process|\(GPU\)/i.test(row.command)),
            'Electron GPU process information is unavailable',
          )
        : unavailable(processReason),
    },
    javascriptHeap: javascriptHeapUsedBytes == null
      ? unavailable('JavaScript heap information is unavailable')
      : { available: true, bytes: javascriptHeapUsedBytes },
    processCount: processRows.length,
  }
}
