import type {
  AgentCommandDescriptor,
  ComposeTaskRequest,
  ComposeTaskResult,
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
      operation: 'composeTask'
      correlationId: string
      request: ComposeTaskRequest
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
  compose(request: ComposeTaskRequest): Promise<ComposeTaskResult | null>
  acknowledge(acknowledgement: FrontendPluginCommandAcknowledgement): Promise<unknown>
}

type PendingRequest = {
  pluginId: string | null
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

function parseComposeTaskRequest(value: unknown): ComposeTaskRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  if (!nonEmptyString(request.projectId) || typeof request.initialPrompt !== 'string') return null
  if (request.sourceTicketUrl !== undefined && request.sourceTicketUrl !== null && typeof request.sourceTicketUrl !== 'string') return null
  if (request.title !== undefined && request.title !== null && typeof request.title !== 'string') return null
  return {
    projectId: request.projectId,
    initialPrompt: request.initialPrompt,
    ...(request.sourceTicketUrl !== undefined ? { sourceTicketUrl: request.sourceTicketUrl as string | null } : {}),
    ...(request.title !== undefined ? { title: request.title as string | null } : {}),
  }
}

function parseRequest(value: unknown): FrontendPluginCommandRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  if (!nonEmptyString(request.correlationId)) return null

  const composeRequest = parseComposeTaskRequest(request.request)
  if (request.operation === 'composeTask' && composeRequest) {
    return {
      operation: 'composeTask',
      correlationId: request.correlationId,
      request: composeRequest,
    }
  }

  if (!nonEmptyString(request.pluginId) || !nonEmptyString(request.projectId)) return null

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

    this.pending.set(request.correlationId, {
      pluginId: request.operation === 'composeTask' ? null : request.pluginId,
    })
    try {
      let output: unknown
      if (request.operation === 'list') {
        output = await this.deps.list(request.pluginId, request.projectId)
      } else if (request.operation === 'composeTask') {
        output = await this.deps.compose(request.request)
      } else {
        output = await this.deps.invoke(
          request.pluginId,
          request.projectId,
          request.commandId,
          request.input,
          request.context,
        )
      }
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
