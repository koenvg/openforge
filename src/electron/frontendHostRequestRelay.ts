import {
  FRONTEND_HOST_REQUEST_EVENT,
  frontendHostRequestCorrelationId,
  parseFrontendHostRequestAcknowledgement,
  type FrontendHostRequestAcknowledgement,
} from './frontendHostRequestProtocol.js'
import { OPENFORGE_EVENT_CHANNEL } from './preloadApi.js'
import type { OpenForgeEventEnvelope } from './eventForwarder.js'

export type TrustedRendererTarget = {
  id: number
  send(channel: string, payload: unknown): void
}

type PendingRelay = {
  rendererId: number
}

type FrontendHostRequestRelayDeps = {
  acknowledgeSidecar(acknowledgement: FrontendHostRequestAcknowledgement): Promise<unknown>
}

function correlationId(envelope: OpenForgeEventEnvelope): string | null {
  if (envelope.eventName !== FRONTEND_HOST_REQUEST_EVENT) return null
  return frontendHostRequestCorrelationId(envelope.payload)
}

export class FrontendHostRequestRelay {
  private readonly pending = new Map<string, PendingRelay>()

  constructor(private readonly deps: FrontendHostRequestRelayDeps) {}

  get pendingCount(): number {
    return this.pending.size
  }

  forward(envelope: OpenForgeEventEnvelope, renderer: TrustedRendererTarget | null): boolean {
    const requestId = correlationId(envelope)
    if (!requestId) return false
    if (this.pending.has(requestId)) return true
    if (!renderer) {
      void this.deps.acknowledgeSidecar({
        correlationId: requestId,
        outcome: { status: 'error', error: 'OpenForge trusted renderer is unavailable' },
      })
      return true
    }

    this.pending.set(requestId, { rendererId: renderer.id })
    try {
      renderer.send(OPENFORGE_EVENT_CHANNEL, envelope)
    } catch {
      this.pending.delete(requestId)
      void this.deps.acknowledgeSidecar({
        correlationId: requestId,
        outcome: { status: 'error', error: 'OpenForge trusted renderer is unavailable' },
      })
    }
    return true
  }

  async acknowledge(rendererId: number, value: unknown): Promise<boolean> {
    const parsed = parseFrontendHostRequestAcknowledgement(value)
    if (!parsed) throw new Error('invalid frontend host request acknowledgement')
    const pending = this.pending.get(parsed.correlationId)
    if (!pending) return false
    if (pending.rendererId !== rendererId) {
      throw new Error(`renderer ${rendererId} does not own frontend host request ${parsed.correlationId}`)
    }

    this.pending.delete(parsed.correlationId)
    return Boolean(await this.deps.acknowledgeSidecar(parsed))
  }

  rendererLost(rendererId: number): Promise<void> {
    return this.failMatching(
      ([, pending]) => pending.rendererId === rendererId,
      'OpenForge trusted renderer was lost before the request completed',
    )
  }

  shutdown(): Promise<void> {
    return this.failMatching(
      () => true,
      'OpenForge is shutting down before the frontend host request completed',
    )
  }

  private async failMatching(
    predicate: (entry: [string, PendingRelay]) => boolean,
    error: string,
  ): Promise<void> {
    const correlationIds = Array.from(this.pending.entries())
      .filter(predicate)
      .map(([requestId]) => requestId)
    for (const requestId of correlationIds) {
      if (!this.pending.delete(requestId)) continue
      await this.deps.acknowledgeSidecar({
        correlationId: requestId,
        outcome: { status: 'error', error },
      })
    }
  }
}
