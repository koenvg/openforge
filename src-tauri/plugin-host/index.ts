import { pathToFileURL } from 'node:url'
import { validateSchemaValue } from '@openforge-app/plugin-runtime/commandValidation'
import type { AgentCommandDescriptor, CommandDescriptor, PluginCommandInvocationContext } from '@openforge-app/plugin-sdk'
import { createBackendApi, DEFAULT_EXTERNAL_TEXT_FILE_READ_TIMEOUT_MS } from './backend-api'
import { BackendLifecycle } from './backend-lifecycle'
import { logPluginHostError, toError, withPluginConsole } from './console-attribution'
import { globalContributionRegistry } from './contribution-registry'
import type {
  ActivateBackendInput,
  BackendStateSnapshot,
  HostCallbackHandler,
  InvokeAgentCommandInput,
  InvokeBackendInput,
  PluginHostProcessDiagnostics,
  JsonRpcRequest,
  JsonRpcResponse,
  ReadyBackendInput,
  RuntimeOptions,
} from './runtime-types'
import { StdioHostCallbackBridge, startStdioServer, writeJsonRpcResponse } from './stdio-transport'
import { assertLocalId, isNonEmptyString, requireAgentInvocationContext, RuntimeValidationError } from './validation'

export class PluginHostRuntime {
  private readonly lifecycle: BackendLifecycle
  private readonly hostCallbacks: HostCallbackHandler | null
  private readonly activationTails = new Map<string, Promise<void>>()
  private readonly invocationTails = new Map<string, Promise<void>>()

  constructor(options: RuntimeOptions = {}) {
    this.hostCallbacks = options.hostCallbacks ?? null
    this.lifecycle = new BackendLifecycle({
      crashLoopLimit: options.crashLoopLimit,
      crashLoopWindowMs: options.crashLoopWindowMs,
      hostCallbacks: this.hostCallbacks,
      contributions: globalContributionRegistry,
      createBackendApi: state => createBackendApi(state, {
        hostCallbacks: this.hostCallbacks,
        externalTextFileReadTimeoutMs: options.externalTextFileReadTimeoutMs ?? DEFAULT_EXTERNAL_TEXT_FILE_READ_TIMEOUT_MS,
        invokeCommand: input => this.invokeCommand(input),
        invokeGlobalCommand: (qualifiedId, payload, callerPluginId) => this.invokeGlobalCommand(qualifiedId, payload, callerPluginId),
        listCommands: () => this.listCommands(),
      }, globalContributionRegistry),
    })
  }

  async activateBackend(input: ActivateBackendInput): Promise<BackendStateSnapshot> {
    return this.serializePluginActivation(input.pluginId, async () => await this.lifecycle.activate(input))
  }

  async deactivateBackend(pluginId: string): Promise<BackendStateSnapshot> {
    return await this.lifecycle.deactivate(pluginId)
  }

  async whenBackendReady(input: ReadyBackendInput): Promise<BackendStateSnapshot> {
    return this.serializePluginActivation(input.pluginId, async () => await this.lifecycle.whenReady(input))
  }

  async invokeBackend(input: InvokeBackendInput): Promise<unknown> {
    assertLocalId('backend', input.pluginId)
    assertLocalId('backend', input.command)
    await this.whenBackendReady(input)

    const state = this.lifecycle.getState(input.pluginId)
    if (state.state !== 'ready') {
      throw new Error(`Plugin ${input.pluginId} backend is not ready`)
    }

    const method = state.methods.get(input.command.trim())
    if (!method) {
      throw new Error(`Backend method not found for ${input.pluginId}.${input.command}`)
    }

    try {
      return await withPluginConsole(input.pluginId, async () => await method.handler(input.payload as never))
    } catch (error) {
      const pluginError = toError(error)
      logPluginHostError(input.pluginId, `handler error in ${input.pluginId}.${input.command}: ${pluginError.message}`)
      throw pluginError
    }
  }

  async invokeCommand(input: InvokeBackendInput): Promise<unknown> {
    assertLocalId('commands', input.pluginId)
    assertLocalId('commands', input.command)
    await this.whenBackendReady(input)
    return this.invokeGlobalCommand(`${input.pluginId}.${input.command.trim()}`, input.payload, input.pluginId)
  }

  async invokeAgentCommand(input: InvokeAgentCommandInput): Promise<unknown> {
    assertLocalId('commands', input.pluginId)
    if (!isNonEmptyString(input.commandId)) {
      throw new RuntimeValidationError('commands', 'agent invocation requires a qualified commandId')
    }
    await this.whenBackendReady(input)

    const state = this.lifecycle.getState(input.pluginId)
    if (state.state !== 'ready') {
      throw new Error(`Plugin ${input.pluginId} backend is not ready`)
    }
    const prefix = `${input.pluginId}.`
    const localId = input.commandId.startsWith(prefix) ? input.commandId.slice(prefix.length) : ''
    const command = localId ? state.commands.get(localId) : undefined
    if (!command || command.qualifiedId !== input.commandId || !command.agent) {
      throw new Error(`Unknown agent-facing Plugin Command: ${input.commandId}`)
    }
    const invocationContext = requireAgentInvocationContext(input.context, input.projectId)
    validateSchemaValue(command.input, input.input, `${input.commandId} input`)
    try {
      const result = await withPluginConsole(command.pluginId, async () => await command.handler(input.input as never, invocationContext))
      validateSchemaValue(command.output, result, `${input.commandId} output`)
      return result
    } catch (error) {
      const pluginError = toError(error)
      logPluginHostError(command.pluginId, `agent command error in ${input.commandId}: ${pluginError.message}`)
      throw pluginError
    }
  }

  async invokeGlobalCommand(qualifiedId: string, payload?: unknown, callerPluginId?: string): Promise<unknown> {
    const command = globalContributionRegistry.getCommand(qualifiedId)
    if (!command) {
      if (qualifiedId.startsWith('openforge.') && this.hostCallbacks) {
        return await this.hostCallbacks({
          method: 'openforge.commands.invokeGlobal',
          params: { qualifiedId, payload: payload ?? null, callerPluginId: callerPluginId ?? null },
        })
      }
      throw new Error(`Command not found: ${qualifiedId}`)
    }
    validateSchemaValue(command.input, payload, `${qualifiedId} input`)
    try {
      const invocationContext: PluginCommandInvocationContext = {
        taskId: null,
        projectId: command.projectId,
        source: 'plugin',
      }
      const result = await withPluginConsole(command.pluginId, async () => await command.handler(payload as never, invocationContext))
      validateSchemaValue(command.output, result, `${qualifiedId} output`)
      return result
    } catch (error) {
      const pluginError = toError(error)
      logPluginHostError(command.pluginId, `command error in ${qualifiedId}: ${pluginError.message}`)
      throw pluginError
    }
  }

  async listCommands(): Promise<CommandDescriptor[]> {
    return globalContributionRegistry.listCommands()
  }

  async listAgentCommands(input: ActivateBackendInput): Promise<AgentCommandDescriptor[]> {
    return this.serializePluginActivation(input.pluginId, async () => {
      await this.lifecycle.whenReady(input)
      return globalContributionRegistry.listAgentCommands(this.lifecycle.getState(input.pluginId))
    })
  }

  async getBackendState(pluginId: string): Promise<BackendStateSnapshot> {
    return this.lifecycle.snapshot(pluginId)
  }

  getProcessDiagnostics(): PluginHostProcessDiagnostics {
    const memoryUsage = process.memoryUsage()
    return {
      memoryUsage: {
        rssBytes: memoryUsage.rss,
        heapTotalBytes: memoryUsage.heapTotal,
        heapUsedBytes: memoryUsage.heapUsed,
        externalBytes: memoryUsage.external,
        arrayBuffersBytes: memoryUsage.arrayBuffers,
      },
      ...this.lifecycle.lifecycleDiagnostics(),
    }
  }

  private serializePluginActivation<T>(
    pluginId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.serializePluginOperation(this.activationTails, pluginId, operation)
  }

  private serializePluginInvocation<T>(
    invocationKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    return this.serializePluginOperation(this.invocationTails, invocationKey, operation)
  }

  private async serializePluginOperation<T>(
    tails: Map<string, Promise<void>>,
    operationKey: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const preceding = tails.get(operationKey) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const tail = preceding.catch(() => undefined).then(() => current)
    tails.set(operationKey, tail)

    await preceding.catch(() => undefined)
    try {
      return await operation()
    } finally {
      release()
      if (tails.get(operationKey) === tail) {
        tails.delete(operationKey)
      }
    }
  }

  private invokeSerializedBackend(input: InvokeBackendInput): Promise<unknown> {
    const invocationKey = JSON.stringify(['backend', input.pluginId, input.command.trim()])
    return this.serializePluginInvocation(invocationKey, () => this.invokeBackend(input))
  }

  async handleJsonRpcRequest(request: JsonRpcRequest): Promise<JsonRpcResponse> {
    if (request.jsonrpc !== '2.0' || typeof request.id !== 'number') {
      return { jsonrpc: '2.0', id: request.id, error: { code: -32600, message: 'Invalid request' } }
    }

    try {
      const params = request.params ?? {}
      const method = request.method
      switch (method) {
        case 'plugin.host.diagnostics':
          return { jsonrpc: '2.0', id: request.id, result: this.getProcessDiagnostics() }
        case 'plugin.backend.activate':
          return { jsonrpc: '2.0', id: request.id, result: await this.activateBackend(this.requireActivationParams(params)) }
        case 'plugin.backend.deactivate':
          return { jsonrpc: '2.0', id: request.id, result: await this.deactivateBackend(this.requirePluginId(params)) }
        case 'plugin.backend.state':
          return { jsonrpc: '2.0', id: request.id, result: await this.getBackendState(this.requirePluginId(params)) }
        case 'plugin.backend.whenReady':
          return { jsonrpc: '2.0', id: request.id, result: await this.whenBackendReady(this.requireReadyParams(params)) }
        case 'plugin.commands.list':
          return { jsonrpc: '2.0', id: request.id, result: await this.listAgentCommands(this.requireActivationParams(params)) }
        case 'plugin.commands.invoke': {
          const input = this.requireAgentCommandParams(params)
          const result = await this.serializePluginInvocation(input.pluginId, () => this.invokeAgentCommand(input))
          return { jsonrpc: '2.0', id: request.id, result }
        }
        case 'plugin.backend.invoke': {
          const input = this.requireInvokeParams(params, method)
          const result = await this.invokeSerializedBackend(input)
          return { jsonrpc: '2.0', id: request.id, result }
        }
        default: {
          const input = this.requireInvokeParams(params, method)
          const result = await this.invokeSerializedBackend(input)
          return { jsonrpc: '2.0', id: request.id, result }
        }
      }
    } catch (error) {
      return {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: this.errorCodeFor(error), message: toError(error).message },
      }
    }
  }

  private requirePluginId(params: JsonRpcRequest['params']): string {
    const pluginId = params?.pluginId
    if (!isNonEmptyString(pluginId)) throw new Error('Missing pluginId')
    return pluginId
  }

  private requireActivationParams(params: JsonRpcRequest['params']): ActivateBackendInput {
    const pluginId = this.requirePluginId(params)
    if (!isNonEmptyString(params?.backendPath)) throw new Error('Missing backendPath')
    return {
      pluginId,
      backendPath: params.backendPath,
      projectId: params.projectId,
      packageMetadata: params.packageMetadata,
    }
  }

  private requireReadyParams(params: JsonRpcRequest['params']): ReadyBackendInput {
    return {
      pluginId: this.requirePluginId(params),
      backendPath: params?.backendPath,
      projectId: params?.projectId,
      preserveActivation: params?.preserveActivation === true,
      packageMetadata: params?.packageMetadata,
    }
  }

  private requireAgentCommandParams(params: JsonRpcRequest['params']): InvokeAgentCommandInput {
    const commandId = params?.commandId
    if (!isNonEmptyString(commandId)) throw new Error('Missing qualified agent Plugin Command commandId')
    return {
      pluginId: this.requirePluginId(params),
      backendPath: params?.backendPath,
      projectId: params?.projectId,
      packageMetadata: params?.packageMetadata,
      commandId,
      input: params?.input,
      context: params?.context as PluginCommandInvocationContext,
    }
  }

  private requireInvokeParams(params: JsonRpcRequest['params'], rpcMethod: string | undefined): InvokeBackendInput {
    const pluginId = this.requirePluginId(params)
    const command = isNonEmptyString(params?.command)
      ? params.command
      : this.commandFromRpcMethod(pluginId, rpcMethod)
    if (!isNonEmptyString(command)) throw new Error('Missing backend command')

    return {
      pluginId,
      command,
      backendPath: params?.backendPath,
      projectId: params?.projectId,
      packageMetadata: params?.packageMetadata,
      payload: params?.payload,
    }
  }

  private commandFromRpcMethod(pluginId: string, rpcMethod: string | undefined): string | undefined {
    if (!rpcMethod) return undefined
    const prefix = `${pluginId}.`
    return rpcMethod.startsWith(prefix) ? rpcMethod.slice(prefix.length) : undefined
  }

  private errorCodeFor(error: unknown): number {
    const message = toError(error).message.toLowerCase()
    if (message.includes('not found') || message.startsWith('unknown ')) return -32601
    if (message.includes('missing') || message.includes('invalid') || message.includes('requires')) return -32602
    return -32603
  }
}

export function createPluginHostRuntime(options?: RuntimeOptions): PluginHostRuntime {
  return new PluginHostRuntime(options)
}

const defaultStdioHostCallbackBridge = new StdioHostCallbackBridge()
const defaultRuntime = createPluginHostRuntime({ hostCallbacks: defaultStdioHostCallbackBridge.request })

export async function handleRequest(request: JsonRpcRequest): Promise<void> {
  writeJsonRpcResponse(await defaultRuntime.handleJsonRpcRequest(request))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startStdioServer({
    callbackBridge: defaultStdioHostCallbackBridge,
    handleRequest,
  })
}
