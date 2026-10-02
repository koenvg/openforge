import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { openArcPage } from './arc-cdp.mjs'

const endpoint = 'http://arc.test:9222'
let socket
let respond
let commands
let fetchMock

class ArcSocket extends EventTarget {
  readyState = 0
  close = vi.fn(() => { this.readyState = 3 })

  constructor() {
    super()
    socket = this
    queueMicrotask(() => {
      this.readyState = 1
      this.dispatchEvent(new Event('open'))
    })
  }

  send(data) {
    const command = JSON.parse(data)
    commands.push(command)
    queueMicrotask(() => respond(command))
  }

  reply(command, result = {}, error) {
    this.dispatchEvent(new MessageEvent('message', {
      data: JSON.stringify({ id: command.id, result, error }),
    }))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  commands = []
  respond = command => socket.reply(command, {
    'Target.createTarget': { targetId: 'experiment-tab' },
    'Target.attachToTarget': { sessionId: 'experiment-session' },
    'Target.closeTarget': { success: true },
  }[command.method] ?? {})
  fetchMock = vi.fn(async () => ({
    ok: true,
    json: async () => ({ Browser: 'Arc', webSocketDebuggerUrl: 'ws://arc.test/browser' }),
  }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('WebSocket', ArcSocket)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

test('failed attachment closes only the newly created experiment tab and its socket', async () => {
  const normalResponse = respond
  respond = command => command.method === 'Target.attachToTarget'
    ? socket.reply(command, undefined, { message: 'attach failed' })
    : normalResponse(command)

  await expect(openArcPage(endpoint)).rejects.toThrow('attach failed')

  expect(commands.map(({ method, params }) => ({ method, params }))).toEqual([
    { method: 'Target.createTarget', params: { url: 'about:blank' } },
    { method: 'Target.attachToTarget', params: { targetId: 'experiment-tab', flatten: true } },
    { method: 'Target.closeTarget', params: { targetId: 'experiment-tab' } },
  ])
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test('a stalled WebSocket handshake times out and closes the connection without creating a tab', async () => {
  vi.stubGlobal('WebSocket', class extends ArcSocket {
    constructor() {
      super()
      this.dispatchEvent = vi.fn()
    }
  })
  const failure = expect(openArcPage(endpoint)).rejects.toThrow(/timed out/i)
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(socket.close).toHaveBeenCalledOnce()
  expect(commands).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['close', 'error'])('socket %s rejects all pending page requests immediately', async event => {
  const page = await openArcPage(endpoint)
  respond = () => {}
  const failures = [
    expect(page.send('Page.navigate', { url: 'http://fixture.test' })).rejects.toThrow(/connection/i),
    expect(page.evaluate(() => 42)).rejects.toThrow(/connection/i),
  ]
  socket.readyState = 3
  socket.dispatchEvent(new Event(event))
  await Promise.all(failures)
  await expect(page.send('Page.enable')).rejects.toThrow(/connection/i)
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['Target.attachToTarget', 'Page.enable', 'Runtime.enable'])(
  'disconnection during %s closes only the owned target over HTTP', async method => {
    const normalResponse = respond
    respond = command => {
      if (command.method !== method) return normalResponse(command)
      socket.readyState = 3
      socket.dispatchEvent(new Event('close'))
    }
    await expect(openArcPage(endpoint)).rejects.toThrow('connection closed')
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      `${endpoint}/json/version`, `${endpoint}/json/close/experiment-tab`,
    ])
    expect(commands.some(command => command.method === 'Browser.close')).toBe(false)
    expect(socket.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  },
)

test('stalled version discovery times out and aborts without opening a socket', async () => {
  socket = undefined
  fetchMock.mockImplementation(() => new Promise(() => {}))
  const failure = expect(openArcPage(endpoint)).rejects.toThrow(/timed out/i)
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
  expect(socket).toBeUndefined()
  expect(vi.getTimerCount()).toBe(0)
})

test('initialization has one deadline across discovery, connection and target setup', async () => {
  const normalResponse = respond
  respond = command => {
    if (command.method === 'Target.createTarget') {
      setTimeout(() => normalResponse(command), 20_000)
    } else if (command.method !== 'Target.attachToTarget') normalResponse(command)
  }
  const failure = expect(openArcPage(endpoint)).rejects.toThrow('Target.attachToTarget')
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(commands.at(-1)).toMatchObject({ method: 'Target.closeTarget', params: { targetId: 'experiment-tab' } })
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test('failed cleanup stays bounded and reports both the initialization and cleanup failures', async () => {
  const normalResponse = respond
  respond = command => {
    if (command.method === 'Page.enable') socket.reply(command, undefined, { message: 'enable failed' })
    else if (command.method !== 'Target.closeTarget') normalResponse(command)
  }
  fetchMock.mockImplementationOnce(async () => ({
    ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://arc.test/browser' }),
  })).mockImplementation(() => new Promise(() => {}))
  const failure = expect(openArcPage(endpoint)).rejects.toThrow(/enable failed.*cleanup failed/i)
  await vi.advanceTimersByTimeAsync(10_000)
  await failure
  expect(fetchMock.mock.calls[1][0]).toBe(`${endpoint}/json/close/experiment-tab`)
  expect(fetchMock.mock.calls[1][1].signal.aborted).toBe(true)
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test('close is idempotent and rejects outstanding and future page requests', async () => {
  const page = await openArcPage(endpoint)
  const normalResponse = respond
  respond = command => {
    if (command.method === 'Target.closeTarget') normalResponse(command)
  }
  const failure = expect(page.send('Runtime.evaluate')).rejects.toThrow(/closed/i)
  await Promise.all([page.close(), page.close()])
  await failure
  await expect(page.send('Page.enable')).rejects.toThrow(/closed/i)
  expect(commands.filter(command => command.method === 'Target.closeTarget')).toHaveLength(1)
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['close', 'error'])('WebSocket %s before open fails without creating or closing any target', async event => {
  vi.stubGlobal('WebSocket', class extends ArcSocket {
    constructor() {
      super()
      const dispatch = this.dispatchEvent.bind(this)
      this.dispatchEvent = message => dispatch(new Event(message.type === 'open' ? event : message.type))
    }
  })
  await expect(openArcPage(endpoint)).rejects.toThrow(/connection/i)
  expect(commands).toEqual([])
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test.each(['Target.createTarget', 'Page.enable', 'Runtime.enable'])(
  '%s rejection cleans up only when an owned target ID is known', async method => {
    const normalResponse = respond
    respond = command => command.method === method
      ? socket.reply(command, undefined, { message: 'initialization failed' })
      : normalResponse(command)
    await expect(openArcPage(endpoint)).rejects.toThrow('initialization failed')
    expect(commands.filter(command => command.method === 'Target.closeTarget').map(command => command.params))
      .toEqual(method === 'Target.createTarget' ? [] : [{ targetId: 'experiment-tab' }])
    expect(socket.close).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  },
)

test('a synchronous send failure clears its request timer', async () => {
  const page = await openArcPage(endpoint)
  socket.send = () => { throw new Error('send failed') }
  await expect(page.send('Page.enable')).rejects.toThrow('send failed')
  expect(vi.getTimerCount()).toBe(0)
  await page.close()
  expect(fetchMock.mock.calls[1][0]).toBe(`${endpoint}/json/close/experiment-tab`)
})

test('a silent close command falls back to HTTP within the cleanup deadline', async () => {
  const page = await openArcPage(endpoint)
  respond = () => {}
  const closing = page.close()
  await vi.advanceTimersByTimeAsync(5_000)
  await closing
  expect(fetchMock.mock.calls[1][0]).toBe(`${endpoint}/json/close/experiment-tab`)
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test('target creation timeout does not guess a target ID or enumerate user tabs', async () => {
  respond = () => {}
  const failure = expect(openArcPage(endpoint)).rejects.toThrow('Target.createTarget')
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(commands.map(command => command.method)).toEqual(['Target.createTarget'])
  expect(fetchMock).toHaveBeenCalledOnce()
  expect(socket.close).toHaveBeenCalledOnce()
  expect(vi.getTimerCount()).toBe(0)
})

test('successful setup keeps evaluation, session-scoped sends and events usable', async () => {
  const page = await openArcPage(endpoint)
  const received = vi.fn()
  page.on('Page.loadEventFired', received)
  respond = command => socket.reply(command, { result: { value: 42 }, success: true })
  expect(await page.evaluate(value => value + 1, 41)).toBe(42)
  expect(commands.at(-1)).toMatchObject({ method: 'Runtime.evaluate', sessionId: 'experiment-session' })
  socket.dispatchEvent(new MessageEvent('message', {
    data: JSON.stringify({ method: 'Page.loadEventFired', params: { timestamp: 123 } }),
  }))
  expect(received).toHaveBeenCalledWith({ timestamp: 123 })
  expect(page.version).toBe('Arc')
  await page.close()
  expect(vi.getTimerCount()).toBe(0)
})

test('an exhausted initialization deadline never starts target creation', async () => {
  fetchMock.mockImplementation(async () => {
    await new Promise(resolve => setTimeout(resolve, 30_000))
    return { ok: true, json: async () => ({ webSocketDebuggerUrl: 'ws://arc.test/browser' }) }
  })
  const failure = expect(openArcPage(endpoint)).rejects.toThrow(/timed out/i)
  await vi.advanceTimersByTimeAsync(30_000)
  await failure
  expect(commands).toEqual([])
  expect(vi.getTimerCount()).toBe(0)
})
