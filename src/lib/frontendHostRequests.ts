import type {
  AgentCommandDescriptor,
  ComposeTaskRequest,
  ComposeTaskResult,
  PluginCommandInvocationContext,
  WorktreeSource,
} from '@openforge-app/plugin-sdk'
import {
  frontendHostRequestCorrelationId,
  type FrontendHostRequestAcknowledgement,
  type FrontendHostRequestOutcome,
} from '../electron/frontendHostRequestProtocol'

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

type FrontendTaskComposeRequest = {
  operation: 'composeTask'
  correlationId: string
  request: ComposeTaskRequest
}

type FrontendHostRequest = FrontendPluginCommandRequest | FrontendTaskComposeRequest

export type FrontendPluginCommandOperations = {
  list(pluginId: string, projectId: string): Promise<AgentCommandDescriptor[]>
  invoke(
    pluginId: string,
    projectId: string,
    commandId: string,
    input: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<unknown>
}

export type FrontendHostRequestDeps = {
  pluginCommands: FrontendPluginCommandOperations
  composeTask(request: ComposeTaskRequest): Promise<ComposeTaskResult | null>
  acknowledge(acknowledgement: FrontendHostRequestAcknowledgement): Promise<unknown>
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

const WORKTREE_SOURCES = new Set<WorktreeSource>(['newBranchFromMain', 'existingBranch', 'disabled'])

function isWorktreeSource(value: unknown): value is WorktreeSource {
  return typeof value === 'string' && WORKTREE_SOURCES.has(value as WorktreeSource)
}

function parseComposeTaskRequest(value: unknown): ComposeTaskRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  if (!nonEmptyString(request.projectId) || typeof request.initialPrompt !== 'string') return null
  if (request.sourceTicketUrl !== undefined && request.sourceTicketUrl !== null && typeof request.sourceTicketUrl !== 'string') return null
  if (request.title !== undefined && request.title !== null && typeof request.title !== 'string') return null
  if (request.worktreeSource !== undefined && request.worktreeSource !== null && !isWorktreeSource(request.worktreeSource)) return null
  if (request.worktreeBranch !== undefined && request.worktreeBranch !== null && typeof request.worktreeBranch !== 'string') return null
  return {
    projectId: request.projectId,
    initialPrompt: request.initialPrompt,
    ...(request.sourceTicketUrl !== undefined ? { sourceTicketUrl: request.sourceTicketUrl as string | null } : {}),
    ...(request.title !== undefined ? { title: request.title as string | null } : {}),
    ...(request.worktreeSource !== undefined ? { worktreeSource: request.worktreeSource as WorktreeSource | null } : {}),
    ...(request.worktreeBranch !== undefined ? { worktreeBranch: request.worktreeBranch as string | null } : {}),
  }
}

function parsePluginCommandRequest(
  request: Record<string, unknown>,
  correlationId: string,
): FrontendPluginCommandRequest | null {
  if (!nonEmptyString(request.pluginId) || !nonEmptyString(request.projectId)) return null

  if (request.operation === 'list') {
    return {
      operation: 'list',
      correlationId,
      pluginId: request.pluginId,
      projectId: request.projectId,
    }
  }
  if (request.operation === 'invoke'
    && nonEmptyString(request.commandId)
    && invocationContext(request.context, request.projectId)) {
    return {
      operation: 'invoke',
      correlationId,
      pluginId: request.pluginId,
      projectId: request.projectId,
      commandId: request.commandId,
      input: request.input,
      context: request.context,
    }
  }
  return null
}

function parseRequest(value: unknown): FrontendHostRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const request = value as Record<string, unknown>
  const correlationId = frontendHostRequestCorrelationId(request)
  if (!correlationId) return null

  if (request.operation === 'composeTask') {
    const composeRequest = parseComposeTaskRequest(request.request)
    return composeRequest
      ? { operation: 'composeTask', correlationId, request: composeRequest }
      : null
  }
  return parsePluginCommandRequest(request, correlationId)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export class FrontendHostRequestHandler {
  private readonly pending = new Map<string, PendingRequest>()

  constructor(private readonly deps: FrontendHostRequestDeps) {}

  async handle(value: unknown): Promise<void> {
    const correlationId = frontendHostRequestCorrelationId(value)
    const request = parseRequest(value)
    if (!request) {
      if (correlationId) {
        await this.deps.acknowledge({
          correlationId,
          outcome: { status: 'error', error: 'invalid frontend host request' },
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
      if (request.operation === 'composeTask') {
        output = await this.deps.composeTask(request.request)
      } else if (request.operation === 'list') {
        output = await this.deps.pluginCommands.list(request.pluginId, request.projectId)
      } else {
        output = await this.deps.pluginCommands.invoke(
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

  private async complete(correlationId: string, outcome: FrontendHostRequestOutcome): Promise<void> {
    if (!this.pending.delete(correlationId)) return
    await this.deps.acknowledge({ correlationId, outcome })
  }
}
