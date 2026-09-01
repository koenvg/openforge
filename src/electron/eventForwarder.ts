import { createFailureReport, reportFailure } from './failureReporting.js'
import { OPENFORGE_APP_EVENTS_RECONNECTED_EVENT, OPENFORGE_EVENT_CHANNEL } from './preloadApi.js'
import type { ElectronFailureReporter } from './failureReporting.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export interface OpenForgeEventEnvelope {
  id?: string
  eventName: string
  payload: unknown
}

export interface WebContentsLike {
  send(channel: string, payload: unknown): void
}

export interface BrowserWindowLike {
  webContents: WebContentsLike
}

export interface AppEventFetchResponse {
  ok: boolean
  body: ReadableStream<Uint8Array> | null
  text(): Promise<string>
}

export type AppEventFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<AppEventFetchResponse>

export interface AppEventForwarderDeps {
  sidecarConfig: SidecarLaunchConfig
  fetch: AppEventFetch
  windows: (envelope: OpenForgeEventEnvelope) => readonly BrowserWindowLike[]
  sleep?: (ms: number) => Promise<void>
  reconnectDelayMs?: number
  onEvent?: (envelope: OpenForgeEventEnvelope) => boolean | void
  failureReporter?: ElectronFailureReporter | null
}

export interface AppEventForwarder {
  start(): Promise<void>
  ready(): Promise<void>
  stop(): void
  acceptChunk(chunk: string): void
}

const DEFAULT_RECONNECT_DELAY_MS = 1_000
export const MAX_SSE_FRAME_SIZE = 1024 * 1024

function isEnvelope(value: unknown): value is OpenForgeEventEnvelope {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { eventName?: unknown }).eventName === 'string'
    && 'payload' in value
}

export function parseSseMessages(chunk: string): OpenForgeEventEnvelope[] {
  const envelopes: OpenForgeEventEnvelope[] = []
  const frames = chunk.split(/\r?\n\r?\n/)

  for (const frame of frames) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice('data:'.length).trimStart())

    if (dataLines.length === 0) continue

    try {
      const parsed = JSON.parse(dataLines.join('\n'))
      if (isEnvelope(parsed)) {
        const idLine = frame
          .split(/\r?\n/)
          .find(line => line.startsWith('id:'))
        const id = idLine?.slice('id:'.length).trimStart()
        envelopes.push(id ? { ...parsed, id } : parsed)
      }
    } catch {
      // Ignore malformed frames; the stream remains alive for later valid events.
    }
  }

  return envelopes
}

export function createAppEventForwarder(deps: AppEventForwarderDeps): AppEventForwarder {
  const abortController = new AbortController()
  let buffer = ''
  let lastEventId: string | null = null
  let readySettled = false
  let resolveReady!: () => void
  let rejectReady!: (error: unknown) => void
  const readyPromise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })

  function markReady(): void {
    if (readySettled) return
    readySettled = true
    resolveReady()
  }

  function failReady(error: unknown): void {
    if (readySettled) return
    readySettled = true
    rejectReady(error)
  }

  function isIntentionalAbort(error: unknown): boolean {
    return abortController.signal.aborted
      && typeof error === 'object'
      && error !== null
      && (error as { name?: unknown }).name === 'AbortError'
  }

  function forward(envelope: OpenForgeEventEnvelope): void {
    if (typeof envelope.id === 'string' && envelope.id.length > 0) {
      lastEventId = envelope.id
    }
    if (deps.onEvent?.(envelope) === false) return
    for (const window of deps.windows(envelope)) {
      window.webContents.send(OPENFORGE_EVENT_CHANNEL, envelope)
    }
  }

  function acceptChunk(chunk: string): void {
    const frames = `${buffer}${chunk}`.split(/\r?\n\r?\n/)
    buffer = frames.pop() ?? ''

    if (frames.some(frame => frame.length > MAX_SSE_FRAME_SIZE) || buffer.length > MAX_SSE_FRAME_SIZE) {
      buffer = ''
      throw new Error(`SSE frame exceeded the ${MAX_SSE_FRAME_SIZE}-character limit`)
    }

    for (const frame of frames) {
      for (const envelope of parseSseMessages(frame)) {
        forward(envelope)
      }
    }
  }

  function forwardReconnectNotice(attempt: number): void {
    forward({
      eventName: OPENFORGE_APP_EVENTS_RECONNECTED_EVENT,
      payload: {
        attempt,
        reconnectedAt: new Date().toISOString(),
      },
    })
  }

  async function readEventStream(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader()
    const decoder = new TextDecoder()
    buffer = ''
    try {
      while (!abortController.signal.aborted) {
        const { done, value } = await reader.read()
        if (done) {
          const trailing = decoder.decode()
          if (trailing) acceptChunk(trailing)
          if (buffer.length > 0) {
            throw new Error(`event stream ended with an unterminated SSE frame of ${buffer.length} characters`)
          }
          break
        }
        if (value) acceptChunk(decoder.decode(value, { stream: true }))
      }
    } catch (error) {
      buffer = ''
      await reader.cancel(error).catch(() => undefined)
      throw error
    } finally {
      buffer = ''
      reader.releaseLock()
    }
  }

  async function waitBeforeReconnect(): Promise<void> {
    const delay = deps.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS
    await (deps.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))))(delay)
  }

  async function start(): Promise<void> {
    let hasConnected = false
    let reconnectAttempt = 0

    while (!abortController.signal.aborted) {
      try {
        const headers: Record<string, string> = { Authorization: `Bearer ${deps.sidecarConfig.token}` }
        if (lastEventId) headers['Last-Event-ID'] = lastEventId

        const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/events`, {
          headers,
          signal: abortController.signal,
        })

        if (!response.ok) {
          const detail = await response.text()
          throw new Error(`failed to connect to Rust app event stream: ${detail}`)
        }

        const isReconnect = hasConnected
        hasConnected = true
        markReady()

        if (isReconnect) {
          reconnectAttempt += 1
          forwardReconnectNotice(reconnectAttempt)
        }

        if (!response.body) return

        await readEventStream(response.body)
      } catch (error) {
        if (isIntentionalAbort(error)) {
          markReady()
          return
        }

        if (!readySettled) {
          failReady(error)
          throw error
        }

        await reportFailure(deps.failureReporter, createFailureReport({
          phase: 'runtime:event-stream',
          severity: 'warning',
          cause: error,
          userMessage: 'OpenForge event stream disconnected.',
          remediation: 'The desktop app will retry the event stream connection automatically.',
          decision: 'retry',
        }))
      }

      if (!abortController.signal.aborted) {
        await waitBeforeReconnect()
      }
    }
  }

  return {
    start,
    ready(): Promise<void> {
      return readyPromise
    },
    stop(): void {
      abortController.abort()
    },
    acceptChunk,
  }
}
