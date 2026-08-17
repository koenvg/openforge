import type { AgentCommandMetadata, JsonValue, PluginCommandInvocationContext } from '@openforge-app/plugin-sdk'
import type { BackgroundServiceRegistration } from '@openforge-app/plugin-sdk/backend'

type RegistrationKind = 'backend' | 'background' | 'commands' | 'events'

export class RuntimeValidationError extends Error {
  constructor(kind: RegistrationKind, message: string) {
    super(`${kind} registration ${message}`)
    this.name = 'RuntimeValidationError'
  }
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every(entry => isJsonValue(entry, seen))
    : Object.values(value).every(entry => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

export function normalizeAgentMetadata(metadata: unknown): AgentCommandMetadata | undefined {
  if (metadata === undefined) return undefined
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new RuntimeValidationError('commands', 'agent metadata must be an object')
  }
  const candidate = metadata as Partial<AgentCommandMetadata>
  if (!isNonEmptyString(candidate.description)) {
    throw new RuntimeValidationError('commands', 'agent metadata requires a non-empty description')
  }
  if (candidate.examples !== undefined && (!Array.isArray(candidate.examples) || !candidate.examples.every(example => isJsonValue(example)))) {
    throw new RuntimeValidationError('commands', 'agent metadata examples must contain only JSON values')
  }
  if (candidate.discoverable !== undefined && typeof candidate.discoverable !== 'boolean') {
    throw new RuntimeValidationError('commands', 'agent metadata discoverable must be a boolean')
  }
  return {
    description: candidate.description.trim(),
    examples: candidate.examples ? [...candidate.examples] : [],
    discoverable: candidate.discoverable ?? true,
  }
}

export function requireAgentInvocationContext(value: unknown, projectId: string | null | undefined): PluginCommandInvocationContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new RuntimeValidationError('commands', 'agent invocation context must be an object')
  }
  const context = value as Partial<PluginCommandInvocationContext>
  if (context.taskId !== null && !isNonEmptyString(context.taskId)) {
    throw new RuntimeValidationError('commands', 'agent invocation context taskId must be a non-empty string or null')
  }
  if (!isNonEmptyString(context.projectId)) {
    throw new RuntimeValidationError('commands', 'agent invocation context requires a non-empty projectId')
  }
  if (context.source !== 'agent-cli') {
    throw new RuntimeValidationError('commands', 'agent invocation context source must be agent-cli')
  }
  if (projectId !== context.projectId) {
    throw new RuntimeValidationError('commands', `agent invocation context Project ${context.projectId} does not match activated Project ${projectId ?? 'none'}`)
  }
  return {
    taskId: context.taskId,
    projectId: context.projectId,
    source: context.source,
  }
}

export function assertLocalId(kind: RegistrationKind, id: unknown): asserts id is string {
  if (!isNonEmptyString(id)) {
    throw new RuntimeValidationError(kind, 'requires a non-empty id')
  }

  const trimmed = id.trim()
  if (trimmed.startsWith('openforge.')) {
    throw new RuntimeValidationError(kind, 'cannot use openforge.* reserved namespace')
  }

  if (trimmed.includes(':') || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    throw new RuntimeValidationError(kind, `has invalid id "${trimmed}"`)
  }
}

export function assertScope(scope: unknown): asserts scope is BackgroundServiceRegistration['scope'] {
  if (scope !== 'global' && scope !== 'project' && scope !== 'task') {
    throw new RuntimeValidationError('background', 'requires scope to be global, project, or task')
  }
}

export function assertFunction(kind: RegistrationKind, label: string, value: unknown): asserts value is (...args: never[]) => unknown {
  if (typeof value !== 'function') {
    throw new RuntimeValidationError(kind, `requires a ${label} function`)
  }
}
