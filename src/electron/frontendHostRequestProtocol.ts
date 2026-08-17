export const FRONTEND_HOST_REQUEST_EVENT = 'plugin-frontend-command-request'
export const FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND = 'plugin_frontend_command_acknowledge'

export type FrontendHostRequestOutcome =
  | { status: 'success'; output: unknown }
  | { status: 'error'; error: string }

export type FrontendHostRequestAcknowledgement = {
  correlationId: string
  outcome: FrontendHostRequestOutcome
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function frontendHostRequestCorrelationId(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return null
  const correlationId = (value as Record<string, unknown>).correlationId
  return nonEmptyString(correlationId) ? correlationId : null
}

export function parseFrontendHostRequestAcknowledgement(
  value: unknown,
): FrontendHostRequestAcknowledgement | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>
  const correlationId = frontendHostRequestCorrelationId(candidate)
  if (!correlationId || typeof candidate.outcome !== 'object' || candidate.outcome === null) {
    return null
  }

  const outcome = candidate.outcome as Record<string, unknown>
  if (outcome.status === 'success' && 'output' in outcome) {
    return { correlationId, outcome: { status: 'success', output: outcome.output } }
  }
  if (outcome.status === 'error' && nonEmptyString(outcome.error)) {
    return { correlationId, outcome: { status: 'error', error: outcome.error } }
  }
  return null
}
