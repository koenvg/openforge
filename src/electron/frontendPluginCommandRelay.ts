import { OPENFORGE_EVENT_CHANNEL } from './preloadApi.js'
import type { OpenForgeEventEnvelope } from './eventForwarder.js'

const FRONTEND_PLUGIN_COMMAND_REQUEST_EVENT = 'plugin-frontend-command-request'

type FrontendPluginCommandOutcome =
  | { status: 'success'; output: unknown }
  | { status: 'error'; error: string }

export type FrontendPluginCommandAcknowledgement = {
  correlationId: string
  outcome: FrontendPluginCommandOutcome
}

export type TrustedRendererTarget = {
  id: number
  send(channel: string, payload: unknown): void
}

type PendingRelay = {
  rendererId: number
}

type FrontendPluginCommandRelayDeps = {
  acknowledgeSidecar(acknowledgement: FrontendPluginCommandAcknowledgement): Promise<unknown>
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function correlationId(envelope: OpenForgeEventEnvelope): string | null {
  if (envelope.eventName !== FRONTEND_PLUGIN_COMMAND_REQUEST_EVENT
    || typeof envelope.payload !== 'object'
    || envelope.payload === null) return null
  const value = (envelope.payload as Record<string, unknown>).correlationId
  return nonEmptyString(value) ? value : null
}

function acknowledgement(value: unknown): FrontendPluginCommandAcknowledgement | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  if (!nonEmptyString(candidate.correlationId)
    || typeof candidate.outcome !== 'object'
    || candidate.outcome === null) return null
  const outcome = candidate.outcome as Record<string, unknown>
  if (outcome.status === 'success' && 'output' in outcome) {
    return {
      correlationId: candidate.correlationId,
      outcome: { status: 'success', output: outcome.output },
    }
  }
  if (outcome.status === 'error' && nonEmptyString(outcome.error)) {
    return {
      correlationId: candidate.correlationId,
      outcome: { status: 'error', error: outcome.error },
    }
  }
  return null
}

export class FrontendPluginCommandRelay {
  private readonly pending = new Map<string, PendingRelay>()

  constructor(private readonly deps: FrontendPluginCommandRelayDeps) {}

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
    const parsed = acknowledgement(value)
    if (!parsed) throw new Error('invalid frontend Plugin Command acknowledgement')
    const pending = this.pending.get(parsed.correlationId)
    if (!pending) return false
    if (pending.rendererId !== rendererId) {
      throw new Error(`renderer ${rendererId} does not own frontend Plugin Command request ${parsed.correlationId}`)
    }

    this.pending.delete(parsed.correlationId)
    return Boolean(await this.deps.acknowledgeSidecar(parsed))
  }

  rendererLost(rendererId: number): Promise<void> {
    return this.failMatching(
      ([, pending]) => pending.rendererId === rendererId,
      'OpenForge trusted renderer was lost before the command completed',
    )
  }

  shutdown(): Promise<void> {
    return this.failMatching(
      () => true,
      'OpenForge is shutting down before the frontend Plugin Command completed',
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
