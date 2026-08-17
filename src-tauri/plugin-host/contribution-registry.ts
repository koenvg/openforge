import type { AgentCommandDescriptor, CommandDescriptor, CommandRegistration } from '@openforge-app/plugin-sdk'
import type { BackendMethodRegistration, BackgroundServiceRegistration, Disposable } from '@openforge-app/plugin-sdk/backend'
import { createDisposable } from './runtime-state'
import type {
  RuntimeBackendCommand,
  RuntimeBackendMethod,
  RuntimeBackendService,
  RuntimeEventHandler,
  RuntimePluginState,
} from './runtime-types'
import {
  assertFunction,
  assertLocalId,
  assertScope,
  isJsonValue,
  isNonEmptyString,
  normalizeAgentMetadata,
  RuntimeValidationError,
} from './validation'

function commandDescriptor(command: RuntimeBackendCommand): CommandDescriptor {
  return {
    id: command.localId,
    qualifiedId: command.qualifiedId,
    pluginId: command.pluginId,
    projectId: command.projectId,
    title: command.title,
    icon: command.icon,
    shortcut: command.shortcut,
    discoverable: command.discoverable ?? true,
    input: command.input,
    output: command.output,
  }
}

function agentCommandDescriptor(command: RuntimeBackendCommand): AgentCommandDescriptor | null {
  if (!command.agent) return null
  return {
    qualifiedId: command.qualifiedId,
    pluginId: command.pluginId,
    runtime: 'backend',
    description: command.agent.description,
    examples: command.agent.examples ?? [],
    discoverable: command.agent.discoverable ?? true,
    input: command.input,
    output: command.output,
  }
}

export class ContributionRegistry {
  private readonly commands = new Map<string, RuntimeBackendCommand>()
  private readonly eventHandlers = new Map<string, Set<RuntimeEventHandler>>()

  getCommand(qualifiedId: string): RuntimeBackendCommand | undefined {
    return this.commands.get(qualifiedId)
  }

  listCommands(): CommandDescriptor[] {
    return Array.from(this.commands.values()).map(commandDescriptor)
  }

  listAgentCommands(state: RuntimePluginState): AgentCommandDescriptor[] {
    return Array.from(state.commands.values())
      .map(agentCommandDescriptor)
      .filter((descriptor): descriptor is AgentCommandDescriptor => descriptor !== null)
  }

  registerCommand(state: RuntimePluginState, registration: CommandRegistration): Disposable {
    assertLocalId('commands', registration?.id)
    assertFunction('commands', 'handler', registration?.handler)
    if (!isNonEmptyString(registration.title)) {
      throw new RuntimeValidationError('commands', 'requires a non-empty title')
    }
    const agent = normalizeAgentMetadata(registration.agent)
    if (agent && registration.input !== undefined && !isJsonValue(registration.input)) {
      throw new RuntimeValidationError('commands', 'agent-facing input schema must be a JSON value')
    }
    if (agent && registration.output !== undefined && !isJsonValue(registration.output)) {
      throw new RuntimeValidationError('commands', 'agent-facing output schema must be a JSON value')
    }
    const localId = registration.id.trim()
    const qualifiedId = `${state.pluginId}.${localId}`
    if (state.commands.has(localId)) {
      throw new Error(`Duplicate command id: ${qualifiedId}`)
    }

    const runtimeCommand: RuntimeBackendCommand = {
      ...registration,
      agent,
      localId,
      qualifiedId,
      pluginId: state.pluginId,
      projectId: state.projectId,
      title: registration.title.trim(),
    }
    state.commands.set(localId, runtimeCommand)
    this.commands.set(qualifiedId, runtimeCommand)

    return createDisposable(() => {
      state.commands.delete(localId)
      this.commands.delete(qualifiedId)
    })
  }

  registerEventListener(state: RuntimePluginState, event: string, handler: RuntimeEventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : `${state.pluginId}.${event}`
    if (!isNonEmptyString(qualifiedId)) {
      throw new RuntimeValidationError('events', 'requires a non-empty id')
    }
    if (!global) {
      assertLocalId('events', event)
    }
    assertFunction('events', 'handler', handler)

    const handlers = this.eventHandlers.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    handlers.add(handler)
    this.eventHandlers.set(qualifiedId, handlers)

    const tracked = state.eventHandlers.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    tracked.add(handler)
    state.eventHandlers.set(qualifiedId, tracked)

    return createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) this.eventHandlers.delete(qualifiedId)
      tracked.delete(handler)
      if (tracked.size === 0) state.eventHandlers.delete(qualifiedId)
    })
  }

  async emitEvent(qualifiedId: string, payload: unknown): Promise<void> {
    const handlers = Array.from(this.eventHandlers.get(qualifiedId) ?? [])
    for (const handler of handlers) {
      handler(payload)
    }
  }

  registerBackendMethod(state: RuntimePluginState, method: string, registration: BackendMethodRegistration): Disposable {
    assertLocalId('backend', method)
    assertFunction('backend', 'handler', registration?.handler)
    const localId = method.trim()
    if (state.methods.has(localId)) {
      throw new Error(`Duplicate backend method id: ${state.pluginId}.${localId}`)
    }

    const runtimeMethod: RuntimeBackendMethod = {
      ...registration,
      localId,
      qualifiedId: `${state.pluginId}.${localId}`,
    }
    state.methods.set(localId, runtimeMethod)

    return createDisposable(() => {
      state.methods.delete(localId)
    })
  }

  registerBackgroundService(state: RuntimePluginState, registration: BackgroundServiceRegistration): Disposable {
    assertLocalId('background', registration?.id)
    assertScope(registration?.scope)
    assertFunction('background', 'start', registration?.start)
    const localId = registration.id.trim()
    if (state.backgroundServices.has(localId)) {
      throw new Error(`Duplicate background service id: ${state.pluginId}.${localId}`)
    }

    const service: RuntimeBackendService = {
      ...registration,
      localId,
      id: localId,
      qualifiedId: `${state.pluginId}.${localId}`,
      started: false,
    }
    state.backgroundServices.set(localId, service)

    return createDisposable(async () => {
      state.backgroundServices.delete(localId)
      if (service.started) {
        await service.stop?.()
        service.started = false
      }
    })
  }

  removeStateContributions(state: RuntimePluginState): void {
    for (const command of state.commands.values()) {
      this.commands.delete(command.qualifiedId)
    }
    for (const [event, handlers] of state.eventHandlers.entries()) {
      const globalHandlers = this.eventHandlers.get(event)
      if (!globalHandlers) continue
      for (const handler of handlers) {
        globalHandlers.delete(handler)
      }
      if (globalHandlers.size === 0) {
        this.eventHandlers.delete(event)
      }
    }

    state.methods.clear()
    state.commands.clear()
    state.eventHandlers.clear()
    state.backgroundServices.clear()
  }
}

export const globalContributionRegistry = new ContributionRegistry()
