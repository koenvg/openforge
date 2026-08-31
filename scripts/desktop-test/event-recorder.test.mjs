import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import {
  createRedactedEventRecorder,
  recordAuthenticatedSidecarEvents,
} from './event-recorder.mjs'

function frame(envelope, sseId = null) {
  return `${sseId === null ? '' : `id: ${sseId}\n`}data: ${JSON.stringify(envelope)}\n\n`
}

describe('redacted Sidecar event recorder', () => {
  it('appends redacted NDJSON while preserving IDs, counts, bytes, sequence metadata, and gaps', async () => {
    const writes = []
    let now = 0
    const appendFile = vi.fn(async (path, content, encoding) => {
      writes.push({ path, content, encoding })
    })
    const recorder = createRedactedEventRecorder({
      outputPath: '/artifacts/events.ndjson',
      appendFile,
      now: () => new Date(1_700_000_000_000 + now++).toISOString(),
    })
    const firstPayload = {
      shell_session_key: 'T-secret-shell-0',
      data: 'sensitive terminal bytes',
      instance_id: 7,
      start_sequence: 1,
      sequence: 4,
    }
    const secondPayload = { taskId: 'T-secret', token: 'bearer-secret' }
    const first = frame({
      id: { epoch: 'boot-a', seq: 1 },
      eventName: 'pty-model-output-T-secret-shell-0',
      payload: firstPayload,
    }, 'boot-a:1')
    const second = frame({
      id: { epoch: 'boot-a', seq: 3 },
      eventName: 'task-changed',
      payload: secondPayload,
    }, 'boot-a:3')

    await recorder.accept(`: keepalive\n\n${first.slice(0, 37)}`)
    await recorder.accept(first.slice(37) + second)
    const summary = await recorder.finish({ complete: false, reason: 'connection closed' })

    expect(appendFile).toHaveBeenCalledTimes(2)
    expect(writes.every(write => write.path === '/artifacts/events.ndjson' && write.encoding === 'utf8')).toBe(true)
    const records = writes.map(write => JSON.parse(write.content.trim()))
    expect(records).toEqual([
      expect.objectContaining({
        id: { epoch: 'boot-a', seq: 1 },
        sseId: 'boot-a:1',
        eventName: 'pty-model-output-T-secret-shell-0',
        payloadBytes: Buffer.byteLength(JSON.stringify(firstPayload)),
        terminalSequence: { ptyInstanceId: 7, startSequence: 1, sequence: 4 },
      }),
      expect.objectContaining({
        id: { epoch: 'boot-a', seq: 3 },
        sseId: 'boot-a:3',
        eventName: 'task-changed',
        payloadBytes: Buffer.byteLength(JSON.stringify(secondPayload)),
        terminalSequence: null,
      }),
    ])
    expect(writes.map(write => write.content).join('')).not.toMatch(/sensitive terminal bytes|bearer-secret|shell_session_key/)
    expect(summary).toEqual({
      complete: false,
      partialReason: 'connection closed',
      eventCount: 2,
      payloadBytes: Buffer.byteLength(JSON.stringify(firstPayload)) + Buffer.byteLength(JSON.stringify(secondPayload)),
      counts: [
        { eventName: 'pty-model-output-T-secret-shell-0', count: 1 },
        { eventName: 'task-changed', count: 1 },
      ],
      firstEventId: { epoch: 'boot-a', seq: 1 },
      lastEventId: { epoch: 'boot-a', seq: 3 },
      gaps: [{ epoch: 'boot-a', after: 1, before: 3, missing: 1, source: 'sequence' }],
    })
  })

  it('records explicit stream-gap evidence without retaining its payload', async () => {
    const writes = []
    const recorder = createRedactedEventRecorder({
      outputPath: '/artifacts/events.ndjson',
      appendFile: async (_path, content) => { writes.push(content) },
    })

    await recorder.accept(frame({
      id: { epoch: 'boot-b', seq: 8 },
      eventName: 'openforge-app-events-gap',
      payload: {
        requestedAfter: { epoch: 'boot-b', seq: 2 },
        oldestAvailable: { epoch: 'boot-b', seq: 8 },
        newestAvailable: { epoch: 'boot-b', seq: 12 },
        token: 'never-write-me',
      },
    }))
    const summary = await recorder.finish({ complete: true })

    expect(summary.gaps).toEqual([{
      epoch: 'boot-b',
      after: 2,
      before: 8,
      missing: 5,
      source: 'stream-gap-event',
    }])
    expect(writes.join('')).not.toContain('never-write-me')
  })

  it('reconnects the authenticated stream from the last event ID and reports a partial end', async () => {
    const encoder = new TextEncoder()
    const response = content => ({
      ok: true,
      status: 200,
      body: {
        getReader() {
          let delivered = false
          return {
            async read() {
              if (delivered) return { done: true, value: undefined }
              delivered = true
              return { done: false, value: encoder.encode(content) }
            },
            cancel: vi.fn(async () => undefined),
          }
        },
      },
    })
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(frame({ id: { epoch: 'boot-c', seq: 1 }, eventName: 'first', payload: {} }, 'boot-c:1')))
      .mockResolvedValueOnce(response(frame({ id: { epoch: 'boot-c', seq: 2 }, eventName: 'second', payload: {} }, 'boot-c:2')))
    const recorder = createRedactedEventRecorder({
      outputPath: '/artifacts/events.ndjson',
      appendFile: vi.fn(async () => undefined),
    })

    const summary = await recordAuthenticatedSidecarEvents({
      connection: { port: 17643, token: 'secret' },
      recorder,
      reconnectLimit: 1,
    }, { fetchImpl, sleep: vi.fn(async () => undefined) })

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://127.0.0.1:17643/app/events', {
      headers: { Authorization: 'Bearer secret' },
      signal: expect.any(AbortSignal),
    })
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://127.0.0.1:17643/app/events', {
      headers: { Authorization: 'Bearer secret', 'Last-Event-ID': 'boot-c:1' },
      signal: expect.any(AbortSignal),
    })
    expect(summary).toMatchObject({
      complete: false,
      partialReason: 'event stream ended after 1 reconnect',
      eventCount: 2,
      lastEventId: { epoch: 'boot-c', seq: 2 },
    })
  })

  it('cancels a pending reader and finishes within the abort boundary', async () => {
    let resolveRead
    const cancel = vi.fn(async () => {
      resolveRead?.({ done: true, value: undefined })
    })
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      body: {
        getReader: () => ({
          read: () => new Promise(resolve => { resolveRead = resolve }),
          cancel,
        }),
      },
    }))
    const recorder = createRedactedEventRecorder({
      outputPath: '/artifacts/events.ndjson',
      appendFile: vi.fn(async () => undefined),
    })
    const controller = new AbortController()
    const recording = recordAuthenticatedSidecarEvents({
      connection: { port: 17643, token: 'secret' },
      recorder,
      signal: controller.signal,
      reconnectLimit: 3,
    }, { fetchImpl, sleep: vi.fn(async () => undefined) })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce())

    controller.abort()

    await expect(recording).resolves.toMatchObject({ complete: true, partialReason: null })
    expect(cancel).toHaveBeenCalledOnce()
  })
})
