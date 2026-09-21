// Attach only to a new Arc tab. Attaching Playwright to every existing Arc target
// can hang on suspended user tabs. Never enumerate, navigate, or close those tabs.
export async function openArcPage(endpoint) {
  const version = await (await fetch(`${endpoint}/json/version`)).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let nextId = 0
  const pending = new Map()
  const listeners = new Map()
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
  function send(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++nextId
      const timeout = setTimeout(() => {
        pending.delete(id)
        reject(new Error(`Arc CDP timed out: ${method}`))
      }, 30_000)
      pending.set(id, { resolve, reject, timeout })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  }
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const pageSend = (method, params) => send(method, params, sessionId)
  await pageSend('Page.enable')
  await pageSend('Runtime.enable')
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
    async close() {
      try { await send('Target.closeTarget', { targetId }) } finally { socket.close() }
    },
  }
}
