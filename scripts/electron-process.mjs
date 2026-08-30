import { createServer } from 'node:net'

const LOOPBACK_HOST = '127.0.0.1'
const DEFAULT_READY_TIMEOUT_MS = 30_000
const DEFAULT_READY_INTERVAL_MS = 250
const DEFAULT_STOP_GRACE_MS = 2_000

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function allocateLoopbackPort(host = LOOPBACK_HOST) {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.unref()
    server.once('error', reject)
    server.listen(0, host, () => {
      const address = server.address()
      const port = typeof address === 'object' && address ? address.port : null
      server.close((error) => {
        if (error) reject(error)
        else if (port === null) reject(new Error('Failed to allocate a loopback port'))
        else resolve(port)
      })
    })
  })
}

export function captureChildOutput(child, options = {}) {
  const maxBytes = options.maxBytes ?? 1_000_000
  let output = ''
  const append = (chunk) => {
    output += String(chunk)
    if (output.length > maxBytes) output = output.slice(output.length - maxBytes)
  }
  child?.stdout?.on?.('data', append)
  child?.stderr?.on?.('data', append)
  return () => output
}

export async function waitForDevTools(port, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const intervalMs = options.intervalMs ?? DEFAULT_READY_INTERVAL_MS
  const fetchImpl = options.fetchImpl ?? fetch
  const startedAt = Date.now()
  let lastError = null

  while (Date.now() - startedAt < timeoutMs) {
    options.assertRunning?.()
    try {
      const response = await fetchImpl(`http://${LOOPBACK_HOST}:${port}/json/version`)
      if (response.ok) return response.json()
      lastError = new Error(`HTTP ${response.status}`)
    } catch (error) {
      lastError = error
    }
    await delay(intervalMs)
  }

  throw new Error(`Electron DevTools endpoint did not become ready: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

export async function waitForPlaywrightPage(browser, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_READY_TIMEOUT_MS
  const startedAt = Date.now()
  let blankPage = null

  while (Date.now() - startedAt < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const candidate of context.pages()) {
        if (candidate.url().startsWith('devtools://')) continue
        if (candidate.url() !== 'about:blank') return candidate
        blankPage ??= candidate
      }
    }
    await delay(DEFAULT_READY_INTERVAL_MS)
  }

  if (blankPage) return blankPage
  throw new Error('Electron renderer page did not appear in DevTools')
}


function hasExited(child) {
  return child.exitCode !== null && child.exitCode !== undefined
    || child.signalCode !== null && child.signalCode !== undefined
}

function waitForChildExit(child, graceMs, deps = {}) {
  if (hasExited(child)) return Promise.resolve('exited')

  const scheduleTimeout = deps.setTimeout ?? setTimeout
  const cancelTimeout = deps.clearTimeout ?? clearTimeout
  return new Promise((resolve) => {
    let settled = false
    let timeout = null
    const settle = (result) => {
      if (settled) return
      settled = true
      child.off?.('exit', onExit)
      if (timeout !== null) cancelTimeout(timeout)
      resolve(result)
    }
    const onExit = () => settle('exited')
    child.once('exit', onExit)
    timeout = scheduleTimeout(() => settle('timeout'), graceMs)
    timeout?.unref?.()
  })
}

export function signalProcessTree(child, signal, options = {}) {
  if (!child) return
  const platform = options.platform ?? process.platform
  const killProcess = options.killProcess ?? process.kill
  const detached = options.detached ?? child.openforgeDetached ?? false
  if (detached && platform !== 'win32' && child.pid) {
    try {
      killProcess(-child.pid, signal)
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error
    }
    return
  }
  child.kill(signal)
}

export async function stopProcess(child, options = {}) {
  const graceMs = options.graceMs ?? DEFAULT_STOP_GRACE_MS
  if (!child) return 'absent'
  if (hasExited(child)) return 'already-exited'

  signalProcessTree(child, 'SIGTERM', options)
  const result = await waitForChildExit(child, graceMs, options)
  if (result !== 'timeout') return 'terminated'

  if (options.forceKill) {
    options.forceKill(child)
  } else {
    signalProcessTree(child, 'SIGKILL', options)
    child.unref?.()
  }
  if (options.forceWaitMs) {
    await waitForChildExit(child, options.forceWaitMs, options)
  }
  return 'killed'
}

export function forceKillProcessTree(child, options = {}) {
  const platform = options.platform ?? process.platform
  signalProcessTree(child, options.signal ?? 'SIGKILL', {
    ...options,
    platform,
    detached: options.detached ?? platform === 'darwin',
  })
}
