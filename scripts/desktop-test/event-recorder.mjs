import { Buffer } from 'node:buffer'
import { appendFile as appendFileDefault } from 'node:fs/promises'

const GAP_EVENT_NAME = 'openforge-app-events-gap'

function eventId(value) {
  return typeof value?.epoch === 'string' && Number.isSafeInteger(value?.seq)
    ? { epoch: value.epoch, seq: value.seq }
    : null
}

function numericField(payload, camelCase, snakeCase) {
  const value = payload?.[camelCase] ?? payload?.[snakeCase]
  return Number.isSafeInteger(value) ? value : null
}

function terminalSequence(payload) {
  const sequence = numericField(payload, 'sequence', 'sequence')
  const startSequence = numericField(payload, 'startSequence', 'start_sequence')
  const ptyInstanceId = numericField(payload, 'ptyInstanceId', 'instance_id')
  if (sequence === null && startSequence === null && ptyInstanceId === null) return null
  return { ptyInstanceId, startSequence, sequence }
}

function explicitGap(payload) {
  const requested = eventId(payload?.requestedAfter ?? payload?.requested_after)
  const oldest = eventId(payload?.oldestAvailable ?? payload?.oldest_available)
  if (!requested || !oldest || requested.epoch !== oldest.epoch || oldest.seq <= requested.seq) return null
  return {
    epoch: oldest.epoch,
    after: requested.seq,
    before: oldest.seq,
    missing: oldest.seq - requested.seq - 1,
    source: 'stream-gap-event',
  }
}

function payloadByteLength(payload) {
  return Buffer.byteLength(JSON.stringify(payload ?? null))
}

export function createRedactedEventRecorder({
  outputPath,
  appendFile = appendFileDefault,
  now = () => new Date().toISOString(),
} = {}) {
  if (!outputPath) throw new Error('Event recorder outputPath is required')
  let buffer = ''
  let finished = false
  let eventCount = 0
  let payloadBytes = 0
  let firstEventId = null
  let lastEventId = null
  let lastSseId = null
  const counts = new Map()
  const gaps = []

  function summary(complete, partialReason) {
    return {
      complete,
      partialReason,
      eventCount,
      payloadBytes,
      counts: [...counts.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([eventName, count]) => ({ eventName, count })),
      firstEventId,
      lastEventId,
      gaps: gaps.map(gap => ({ ...gap })),
    }
  }

  async function recordFrame(frame) {
    const lines = frame.split(/\r?\n/)
    const sseId = lines.find(line => line.startsWith('id:'))?.slice(3).trim() || null
    const data = lines
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart())
      .join('\n')
    if (!data) return

    let envelope
    try {
      envelope = JSON.parse(data)
    } catch {
      return
    }
    if (typeof envelope?.eventName !== 'string') return

    const id = eventId(envelope.id)
    if (id && lastEventId && id.epoch === lastEventId.epoch && id.seq > lastEventId.seq + 1) {
      gaps.push({
        epoch: id.epoch,
        after: lastEventId.seq,
        before: id.seq,
        missing: id.seq - lastEventId.seq - 1,
        source: 'sequence',
      })
    }
    if (envelope.eventName === GAP_EVENT_NAME) {
      const gap = explicitGap(envelope.payload)
      if (gap) gaps.push(gap)
    }

    const bytes = payloadByteLength(envelope.payload)
    const record = {
      receivedAt: now(),
      id,
      sseId,
      eventName: envelope.eventName,
      payloadBytes: bytes,
      terminalSequence: terminalSequence(envelope.payload),
    }
    await appendFile(outputPath, `${JSON.stringify(record)}\n`, 'utf8')

    eventCount += 1
    payloadBytes += bytes
    counts.set(envelope.eventName, (counts.get(envelope.eventName) ?? 0) + 1)
    firstEventId ??= id
    if (id) lastEventId = id
    if (sseId) lastSseId = sseId
  }

  async function accept(chunk) {
    if (finished) throw new Error('Event recorder is already finished')
    buffer += chunk
    for (;;) {
      const boundary = buffer.search(/\r?\n\r?\n/)
      if (boundary < 0) return
      const separator = buffer.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
      const frame = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + separator.length)
      await recordFrame(frame)
    }
  }

  async function finish({ complete, reason = null } = {}) {
    if (!finished && buffer.trim()) await recordFrame(buffer)
    finished = true
    buffer = ''
    return summary(Boolean(complete), complete ? null : reason ?? 'event stream incomplete')
  }

  return Object.freeze({
    accept,
    finish,
    lastSseId: () => lastSseId,
  })
}

export async function recordAuthenticatedSidecarEvents({
  connection,
  recorder,
  signal = null,
  reconnectLimit = 2,
  reconnectDelayMs = 100,
} = {}, {
  fetchImpl = fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!connection || !Number.isInteger(connection.port) || !connection.token) {
    throw new Error('Authenticated Sidecar event connection is required')
  }
  if (!recorder) throw new Error('Event recorder is required')
  if (!Number.isInteger(reconnectLimit) || reconnectLimit < 0) {
    throw new Error('Event recorder reconnectLimit must be a non-negative integer')
  }

  const streamController = new AbortController()
  const abortStream = () => streamController.abort()
  signal?.addEventListener('abort', abortStream, { once: true })
  if (signal?.aborted) abortStream()
  let reconnects = 0

  try {
    while (!streamController.signal.aborted) {
      const lastEventId = recorder.lastSseId()
      const headers = { Authorization: `Bearer ${connection.token}` }
      if (lastEventId) headers['Last-Event-ID'] = lastEventId
      const response = await fetchImpl(`http://127.0.0.1:${connection.port}/app/events`, {
        headers,
        signal: streamController.signal,
      })
      if (!response.ok || !response.body) {
        throw new Error(`Sidecar event stream returned HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      let cancelled = false
      const cancelReader = () => {
        if (cancelled) return
        cancelled = true
        void reader.cancel?.().catch(() => {})
      }
      streamController.signal.addEventListener('abort', cancelReader, { once: true })
      const decoder = new TextDecoder()
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done || streamController.signal.aborted) break
          if (value) await recorder.accept(decoder.decode(value, { stream: true }))
        }
        const trailing = decoder.decode()
        if (trailing) await recorder.accept(trailing)
      } finally {
        streamController.signal.removeEventListener('abort', cancelReader)
        if (streamController.signal.aborted && !cancelled) await reader.cancel?.().catch(() => {})
      }

      if (streamController.signal.aborted) {
        return recorder.finish({ complete: true })
      }
      if (reconnects >= reconnectLimit) {
        return recorder.finish({
          complete: false,
          reason: `event stream ended after ${reconnects} reconnect${reconnects === 1 ? '' : 's'}`,
        })
      }
      reconnects += 1
      await sleep(reconnectDelayMs)
    }
    return recorder.finish({ complete: true })
  } catch (error) {
    if (error?.name === 'AbortError' || streamController.signal.aborted) {
      return recorder.finish({ complete: true })
    }
    throw error
  } finally {
    signal?.removeEventListener('abort', abortStream)
  }
}
