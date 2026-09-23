/** Connect to one new Arc tab, without attaching to or changing existing tabs. */
export async function openArcTab(endpoint: string, url: string) {
  const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })
  if (!response.ok) throw new Error('Unable to open an Arc debugging tab')
  const target = await response.json() as { id: string; webSocketDebuggerUrl: string }
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  let sequence = 0
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>()
  const requests: string[] = []
  let loaded = () => {}
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data))
    if (message.method === 'Page.loadEventFired') loaded()
    if (message.method === 'Network.requestWillBeSent') requests.push(message.params.request.url)
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true })
    socket.addEventListener('error', () => reject(new Error('Arc CDP connection failed')), { once: true })
  })
  function send<T>(method: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve: value => resolve(value as T), reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  await send('Runtime.enable')
  await send('Network.enable')
  await send('Page.enable')
  const ready = new Promise<void>(resolve => { loaded = resolve })
  await send('Page.navigate', { url })
  await ready
  return {
    requests,
    async evaluate<T, A>(fn: (arg: A) => Promise<T>, arg: A): Promise<T> {
      const response = await send<{ result: { value: T }; exceptionDetails?: { text: string; exception?: { description: string } } }>('Runtime.evaluate', {
        expression: `(${fn.toString()})(${JSON.stringify(arg)})`, awaitPromise: true, returnByValue: true,
      })
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
      return response.result.value
    },
    async screenshot() {
      return (await send<{ data: string }>('Page.captureScreenshot', { format: 'png' })).data
    },
    async viewport(width: number, height: number) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] })
    },
    async key(key: string) {
      await send('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, text: key === 'Enter' ? '\r' : undefined, windowsVirtualKeyCode: key === 'Enter' ? 13 : 9 })
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: key === 'Enter' ? 13 : 9 })
    },
    async close() {
      socket.close()
      await fetch(`${endpoint}/json/close/${target.id}`)
    },
  }
}
