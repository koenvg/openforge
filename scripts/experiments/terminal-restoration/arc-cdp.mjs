const REQUEST_TIMEOUT_MS = 30_000
const CLEANUP_TIMEOUT_MS = 5_000

async function fetchFromArc(url, readJson = false, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController()
  let timeout
  try {
    return await Promise.race([
      (async () => {
        const response = await fetch(url, { signal: controller.signal })
        if (!response.ok) throw new Error(`Arc HTTP request failed: ${response.status}`)
        return readJson ? await response.json() : undefined
      })(),
      new Promise((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error('Arc HTTP request timed out'))
          controller.abort()
        }, timeoutMs)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
}
// Attach only to a new Arc tab. Attaching Playwright to every existing Arc target
// can hang on suspended user tabs. Never enumerate, navigate, or close those tabs.
export async function openArcPage(endpoint) {
  const initializationDeadline = Date.now() + REQUEST_TIMEOUT_MS
  const remainingInitializationTime = () => Math.max(0, initializationDeadline - Date.now())
  const version = await fetchFromArc(`${endpoint}/json/version`, true)
  if (remainingInitializationTime() <= 0) throw new Error('Arc CDP initialization timed out')
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => finish(new Error('Arc CDP connection timed out')), remainingInitializationTime())
      const opened = () => finish()
      const failed = () => finish(new Error('Arc CDP connection failed'))
      const closed = () => finish(new Error('Arc CDP connection closed'))
      function finish(error) {
        clearTimeout(timeout)
        socket.removeEventListener('open', opened)
        socket.removeEventListener('error', failed)
        socket.removeEventListener('close', closed)
        if (error) reject(error)
        else resolve()
      }
      socket.addEventListener('open', opened)
      socket.addEventListener('error', failed)
      socket.addEventListener('close', closed)
    })
  } catch (error) {
    socket.close()
    throw error
  }
  let nextId = 0
  const pending = new Map()
  const listeners = new Map()
  let connectionError
  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout)
      request.reject(error)
    }
    pending.clear()
  }
  function disconnect(error) {
    connectionError ??= error
    rejectPending(connectionError)
    listeners.clear()
  }
  socket.addEventListener('close', () => disconnect(new Error('Arc CDP connection closed')))
  socket.addEventListener('error', () => disconnect(new Error('Arc CDP connection failed')))
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id) {
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      clearTimeout(request.timeout)
      if (message.error) request.reject(new Error(JSON.stringify(message.error)))
      else request.resolve(message.result)
    } else {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params)
    }
  })
  function send(method, params = {}, sessionId, timeoutMs = REQUEST_TIMEOUT_MS) {
    return new Promise((resolve, reject) => {
      if (connectionError) return reject(connectionError)
      if (socket.readyState !== 1) return reject(new Error('Arc CDP connection is not open'))
      if (timeoutMs <= 0) return reject(new Error(`Arc CDP timed out: ${method}`))
      const id = ++nextId
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Arc CDP timed out: ${method}`))
      }, timeoutMs)
      pending.set(id, { resolve, reject, timeout })
      try {
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
      } catch (error) {
        pending.delete(id)
        clearTimeout(timeout)
        reject(error)
      }
    })
  }
  let targetId
  let sessionId
  let closePromise
  function close() {
    if (!closePromise) {
      rejectPending(new Error('Arc CDP page closed'))
      listeners.clear()
      closePromise = closeTarget()
    }
    return closePromise
  }
  async function closeTarget() {
    try {
      if (targetId) {
        try {
          const result = await send('Target.closeTarget', { targetId }, undefined, CLEANUP_TIMEOUT_MS)
          if (!result.success) throw new Error('Arc refused to close the experiment target')
        } catch {
          // A disconnected CDP socket cannot close a tab. Address only our known ID.
          await fetchFromArc(`${endpoint}/json/close/${encodeURIComponent(targetId)}`, false, CLEANUP_TIMEOUT_MS)
        }
      }
    } finally {
      disconnect(new Error('Arc CDP connection closed'))
      socket.close()
    }
  }
  try {
    ;({ targetId } = await send('Target.createTarget', { url: 'about:blank' }, undefined, remainingInitializationTime()))
    ;({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, undefined, remainingInitializationTime()))
    await send('Page.enable', {}, sessionId, remainingInitializationTime())
    await send('Runtime.enable', {}, sessionId, remainingInitializationTime())
  } catch (error) {
    try {
      await close()
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], `${error.message}; Arc experiment cleanup failed: ${cleanupError.message}`)
    }
    throw error
  }
  const pageSend = (method, params) => closePromise
    ? Promise.reject(new Error('Arc CDP page closed'))
    : send(method, params, sessionId)
  return {
    version: version.Browser,
    send: pageSend,
    on(method, listener) {
      const entries = listeners.get(method) ?? []
      entries.push(listener)
      listeners.set(method, entries)
    },
    async evaluate(fn, argument) {
      const result = await pageSend('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(argument) ?? ''})`,
        awaitPromise: true, returnByValue: true, userGesture: true,
      })
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails))
      return result.result.value
    },
    close,
  }
}
