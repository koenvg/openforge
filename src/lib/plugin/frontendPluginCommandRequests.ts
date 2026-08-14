import type {
  AgentCommandDescriptor,
  PluginCommandInvocationContext,
} from '@openforge-app/plugin-sdk'

export type FrontendPluginCommandOutcome =
  | { status: 'success'; output: unknown }
  | { status: 'error'; error: string }

export type FrontendPluginCommandAcknowledgement = {
  correlationId: string
  outcome: FrontendPluginCommandOutcome
}

type FrontendPluginCommandRequest =
  | {
      operation: 'list'
      correlationId: string
      pluginId: string
      projectId: string
    }
  | {
      operation: 'invoke'
      correlationId: string
      pluginId: string
      projectId: string
      commandId: string
      input: unknown
      context: PluginCommandInvocationContext
    }

export type FrontendPluginCommandRequestDeps = {
  list(pluginId: string, projectId: string): Promise<AgentCommandDescriptor[]>
  invoke(
    pluginId: string,
    projectId: string,
    commandId: string,
    input: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<unknown>
  acknowledge(acknowledgement: FrontendPluginCommandAcknowledgement): Promise<unknown>
}

type PendingRequest = {
  pluginId: string
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function invocationContext(value: unknown, projectId: string): value is PluginCommandInvocationContext {
  if (typeof value !== 'object' || value === null) return false
  const context = value as Partial<PluginCommandInvocationContext>
  return (context.taskId === null || nonEmptyString(context.taskId))
    && context.projectId === projectId
    && context.source === 'agent-cli'
}

function parseRequest(value: unknown): FrontendPluginCommandRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  if (!nonEmptyString(request.correlationId)
    || !nonEmptyString(request.pluginId)
    || !nonEmptyString(request.projectId)) return null

  if (request.operation === 'list') {
    return {
      operation: 'list',
      correlationId: request.correlationId,
      pluginId: request.pluginId,
      projectId: request.projectId,
    }
  }
  if (request.operation === 'invoke'
    && nonEmptyString(request.commandId)
    && invocationContext(request.context, request.projectId)) {
    return {
      operation: 'invoke',
      correlationId: request.correlationId,
      pluginId: request.pluginId,
      projectId: request.projectId,
      commandId: request.commandId,
      input: request.input,
      context: request.context,
    }
  }
  return null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FrontendPluginCommandRequestHandler {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly deps: FrontendPluginCommandRequestDeps) {}

  async handle(value: unknown): Promise<void> {
    const correlationId = typeof value === 'object'
      && value !== null
      && nonEmptyString((value as Record<string, unknown>).correlationId)
      ? (value as Record<string, string>).correlationId
      : null
    const request = parseRequest(value)
    if (!request) {
      if (correlationId) {
        await this.deps.acknowledge({
          correlationId,
          outcome: { status: 'error', error: 'invalid frontend Plugin Command request' },
        })
      }
      return
    }
    if (this.pending.has(request.correlationId)) return

    this.pending.set(request.correlationId, { pluginId: request.pluginId })
    try {
      const output = request.operation === 'list'
        ? await this.deps.list(request.pluginId, request.projectId)
        : await this.deps.invoke(
            request.pluginId,
            request.projectId,
            request.commandId,
            request.input,
            request.context,
          )
      await this.complete(request.correlationId, { status: 'success', output })
    } catch (error) {
      await this.complete(request.correlationId, { status: 'error', error: errorMessage(error) })
    }
  }

  async failPlugin(pluginId: string, reason: string): Promise<void> {
    const correlationIds = Array.from(this.pending.entries())
      .filter(([, pending]) => pending.pluginId === pluginId)
      .map(([correlationId]) => correlationId)
    await Promise.all(correlationIds.map((correlationId) =>
      this.complete(correlationId, { status: 'error', error: reason })))
  }

  async failAll(reason: string): Promise<void> {
    await Promise.all(Array.from(this.pending.keys()).map((correlationId) =>
      this.complete(correlationId, { status: 'error', error: reason })))
  }

  private async complete(correlationId: string, outcome: FrontendPluginCommandOutcome): Promise<void> {
    if (!this.pending.delete(correlationId)) return
    await this.deps.acknowledge({ correlationId, outcome })
  }
}
