import { validateSchemaValue } from '@openforge-app/plugin-runtime/commandValidation'
import type {
  AgentCommandDescriptor,
  AgentCommandMetadata,
  CommandDescriptor,
  Disposable,
  JsonValue,
  OpenForgeCommonAPI,
  OpenForgeContextChangeHandler,
  OpenForgeContextSnapshot,
  PluginCommandInvocationContext,
} from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
import {
  assertHandler,
  assertTitle,
  createDisposable,
  isNonEmptyString,
  RuntimeValidationError,
  type RuntimeRegistryServices,
} from './runtimeContributionSupport'
import type {
  RuntimeCommandContribution,
  RuntimeEventHandler,
  RuntimeEventListenerContribution,
  RuntimeHandler,
} from './runtimeContributionTypes'

export type RuntimeCommonApi = OpenForgeCommonAPI & Pick<FrontendOpenForgeAPI, 'navigation'>
export type RuntimeBackendCommonApi = RuntimeCommonApi & Pick<BackendOpenForgeAPI, 'fs'>

const globalCommands = new Map<string, RuntimeCommandContribution>()
const globalEventHandlers = new Map<string, Set<RuntimeEventHandler>>()

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isJsonValue)
  if (typeof value !== 'object') return false
  return Object.values(value as Record<string, unknown>).every(isJsonValue)
}

function normalizeAgentMetadata(metadata: unknown): AgentCommandMetadata | undefined {
  if (metadata === undefined) return undefined
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new RuntimeValidationError('commands', 'agent metadata must be an object')
  }
  const candidate = metadata as Partial<AgentCommandMetadata>
  if (!isNonEmptyString(candidate.description)) {
    throw new RuntimeValidationError('commands', 'agent metadata requires a non-empty description')
  }
  if (candidate.examples !== undefined && (!Array.isArray(candidate.examples) || !candidate.examples.every(isJsonValue))) {
    throw new RuntimeValidationError('commands', 'agent metadata examples must contain only JSON values')
  }
  if (candidate.discoverable !== undefined && typeof candidate.discoverable !== 'boolean') {
    throw new RuntimeValidationError('commands', 'agent metadata discoverable must be a boolean')
  }
  return {
    description: candidate.description.trim(),
    examples: candidate.examples ?? [],
    discoverable: candidate.discoverable ?? true,
  }
}

function agentCommandDescriptor(command: RuntimeCommandContribution): AgentCommandDescriptor | null {
  if (!command.agent) return null
  return {
    qualifiedId: command.qualifiedId,
    pluginId: command.pluginId,
    runtime: 'frontend',
    description: command.agent.description,
    examples: command.agent.examples ?? [],
    discoverable: command.agent.discoverable ?? true,
    input: command.input,
    output: command.output,
  }
}
function commandDescriptor(command: RuntimeCommandContribution): CommandDescriptor {
  return {
    id: command.id,
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

function unavailableCapability(name: string): never {
  throw new Error(`OpenForge host capability is unavailable: ${name}`)
}

export class RuntimeCommonApiRegistry {
  private readonly eventHandlers = new Map<string, Set<RuntimeEventHandler>>()
  private readonly commands = new Map<string, RuntimeCommandContribution>()
  private readonly eventListeners = new Map<string, RuntimeEventListenerContribution>()
  private readonly contextChangeHandlers = new Set<OpenForgeContextChangeHandler>()
  private eventListenerSequence = 0

  constructor(private readonly services: RuntimeRegistryServices) {}

  createApi(): RuntimeCommonApi {
    const api: RuntimeCommonApi = {
      commands: {
        register: (registration: Parameters<FrontendOpenForgeAPI['commands']['register']>[0]) => this.registerCommand(registration),
        invoke: async <TOutput>(id: string, payload?: unknown) => this.invokeCommand<TOutput>(id, payload),
        invokeGlobal: async <TOutput>(qualifiedId: string, payload?: unknown) => this.invokeGlobalCommand<TOutput>(qualifiedId, payload),
        list: async () => Array.from(globalCommands.values()).map(commandDescriptor),
        listCatalog: async (request?: { projectId?: string | null }) => this.services.host.listCommandCatalog ? this.services.host.listCommandCatalog(request) : unavailableCapability('commands.listCatalog'),
      },
      events: {
        on: <TPayload>(event: string, handler: (payload: TPayload) => void) => this.registerEventListener(event, handler as RuntimeEventHandler, false),
        onGlobal: <TPayload>(qualifiedEvent: string, handler: (payload: TPayload) => void) => this.registerEventListener(qualifiedEvent, handler as RuntimeEventHandler, true),
        emit: async <TPayload>(event: string, payload: TPayload) => this.emitEvent(this.services.qualifiedId('events', event), payload),
        emitGlobal: async <TPayload>(qualifiedEvent: string, payload: TPayload) => this.emitEvent(qualifiedEvent, payload),
      },
      storage: this.services.storage,
      context: {
        getSnapshot: () => {
          const navigation = this.services.host.getNavigation?.()
          const taskId = navigation?.selectedTaskId ?? null
          return {
            pluginId: this.services.pluginId,
            projectId: navigation ? navigation.activeProjectId : this.services.projectId,
            ...(taskId === null ? {} : { taskId }),
          }
        },
      },
      tasks: {
        list: async (request) => this.services.host.listTasks ? this.services.host.listTasks(request) : unavailableCapability('tasks.list'),
        listUsageCandidates: async (request) => this.services.host.listTaskUsageCandidates ? this.services.host.listTaskUsageCandidates(request) : unavailableCapability('tasks.listUsageCandidates'),
        get: async (taskId) => this.services.host.getTask ? this.services.host.getTask(taskId) : unavailableCapability('tasks.get'),
        create: async (request) => this.services.host.createTask ? this.services.host.createTask(request) : unavailableCapability('tasks.create'),
        updateStatus: async (taskId, status) => this.services.host.updateTaskStatus ? this.services.host.updateTaskStatus(taskId, status) : unavailableCapability('tasks.updateStatus'),
        compose: async (request) => this.services.host.composeTask
          ? this.services.host.composeTask(request)
          : unavailableCapability('tasks.compose'),
        listStartPromptContributions: async (projectId) => this.services.host.listStartPromptContributions ? this.services.host.listStartPromptContributions(projectId) : unavailableCapability('tasks.listStartPromptContributions'),
        configureStartPromptContribution: async (request) => this.services.host.configureStartPromptContribution ? this.services.host.configureStartPromptContribution(request) : unavailableCapability('tasks.configureStartPromptContribution'),
        startImplementation: async (request) => this.services.host.startTaskImplementation ? this.services.host.startTaskImplementation(request) : unavailableCapability('tasks.startImplementation'),
        sendFollowUp: async (request) => this.services.host.sendTaskFollowUp ? this.services.host.sendTaskFollowUp(request) : unavailableCapability('tasks.sendFollowUp'),
        getWorkspace: async (taskId) => this.services.host.getTaskWorkspace ? this.services.host.getTaskWorkspace(taskId) : unavailableCapability('tasks.getWorkspace'),
        getLatestSession: async (taskId) => this.services.host.getLatestSession ? this.services.host.getLatestSession(taskId) : unavailableCapability('tasks.getLatestSession'),
        listSessions: async (request) => this.services.host.listTaskSessions ? this.services.host.listTaskSessions(request) : unavailableCapability('tasks.listSessions'),
      },
      projects: {
        list: async () => this.services.host.listProjects ? this.services.host.listProjects() : unavailableCapability('projects.list'),
        get: async (projectId) => this.services.host.getProject ? this.services.host.getProject(projectId) : unavailableCapability('projects.get'),
      },
      fs: {
        readDir: async (request) => this.services.host.readDir ? this.services.host.readDir(request) : unavailableCapability('fs.readDir'),
        readFile: async (request) => this.services.host.readFile ? this.services.host.readFile(request) : unavailableCapability('fs.readFile'),
        writeFile: async (request) => this.services.host.writeFile ? this.services.host.writeFile(request) : unavailableCapability('fs.writeFile'),
        searchFiles: async (request) => this.services.host.searchFiles ? this.services.host.searchFiles(request) : unavailableCapability('fs.searchFiles'),
      },
      shell: {
        spawn: async (request) => this.services.host.spawnShell ? this.services.host.spawnShell(request) : unavailableCapability('shell.spawn'),
        write: async (request) => this.services.host.writeShell ? this.services.host.writeShell(request) : unavailableCapability('shell.write'),
        resize: async (request) => this.services.host.resizeShell ? this.services.host.resizeShell(request) : unavailableCapability('shell.resize'),
        kill: async (request) => this.services.host.killShell ? this.services.host.killShell(request) : unavailableCapability('shell.kill'),
        getBuffer: async (request) => this.services.host.getShellBuffer ? this.services.host.getShellBuffer(request) : unavailableCapability('shell.getBuffer'),
      },
      notifications: {
        notify: async (request) => this.services.host.notify ? this.services.host.notify(request) : unavailableCapability('notifications.notify'),
      },
      attention: {
        listProjects: async () => this.services.host.getAttention ? this.services.host.getAttention() : unavailableCapability('attention.listProjects'),
      },
      system: {
        openUrl: async (url) => this.services.host.openUrl ? this.services.host.openUrl(url) : unavailableCapability('system.openUrl'),
        writeClipboardText: async (text) => this.services.host.writeClipboardText ? this.services.host.writeClipboardText(text) : unavailableCapability('system.writeClipboardText'),
      },
      navigation: {
        get: () => this.services.host.getNavigation ? this.services.host.getNavigation() : unavailableCapability('navigation.get'),
        navigate: async (request) => this.services.host.navigate ? this.services.host.navigate(request) : unavailableCapability('navigation.navigate'),
      },
      config: {
        get: async (key) => this.services.host.getConfig ? this.services.host.getConfig(key) as never : unavailableCapability('config.get'),
        set: async (key, value) => this.services.host.setConfig ? this.services.host.setConfig(key, value) : unavailableCapability('config.set'),
      },
      projectConfig: {
        get: async (key, projectId = this.services.projectId ?? '') => this.services.host.getProjectConfig ? this.services.host.getProjectConfig(projectId, key) as never : unavailableCapability('projectConfig.get'),
        set: async (key, value, projectId = this.services.projectId ?? '') => this.services.host.setProjectConfig ? this.services.host.setProjectConfig(projectId, key, value) : unavailableCapability('projectConfig.set'),
      },
    }

    return api
  }

  createBackendApi(): RuntimeBackendCommonApi {
    const api = this.createApi()
    return {
      ...api,
      fs: {
        ...api.fs,
        userData: {
          readDir: async () => unavailableCapability('fs.userData.readDir'),
          readTextFile: async () => unavailableCapability('fs.userData.readTextFile'),
          writeTextFile: async () => unavailableCapability('fs.userData.writeTextFile'),
          appendTextFile: async () => unavailableCapability('fs.userData.appendTextFile'),
        },
        external: {
          readDir: async () => unavailableCapability('fs.external.readDir'),
          readTextFile: async () => unavailableCapability('fs.external.readTextFile'),
          stat: async () => unavailableCapability('fs.external.stat'),
          readTextFileChunks: () => unavailableCapability('fs.external.readTextFileChunks'),
        },
      },
    }
  }

  async publishContextChange(snapshot: OpenForgeContextSnapshot): Promise<void> {
    let firstError: unknown = null
    for (const handler of Array.from(this.contextChangeHandlers)) {
      try {
        await handler({ ...snapshot })
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  getSnapshot(): {
    commands: RuntimeCommandContribution[]
    eventListeners: RuntimeEventListenerContribution[]
  } {
    return {
      commands: Array.from(this.commands.values()),
      eventListeners: Array.from(this.eventListeners.values()),
    }
  }

  listAgentCommands(): AgentCommandDescriptor[] {
    return Array.from(this.commands.values())
      .map(agentCommandDescriptor)
      .filter((descriptor): descriptor is AgentCommandDescriptor => descriptor !== null)
  }

  async invokeAgentCommand(
    qualifiedId: string,
    payload: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<unknown> {
    const command = this.commands.get(qualifiedId)
    if (!command?.agent) {
      throw new Error(`Unknown agent-facing Plugin Command: ${qualifiedId}`)
    }
    return this.invokeRegisteredCommand(command, payload, context)
  }
  subscribeToContextChanges(handler: OpenForgeContextChangeHandler): Disposable {
    if (typeof handler !== 'function') {
      throw new Error('context.onDidChange requires a handler function')
    }
    this.contextChangeHandlers.add(handler)
    return this.services.trackDisposable(createDisposable(() => {
      this.contextChangeHandlers.delete(handler)
    }))
  }

  private registerCommand(registration: Parameters<FrontendOpenForgeAPI['commands']['register']>[0]): Disposable {
    const qualifiedId = this.services.qualifiedId('commands', registration?.id)
    assertTitle('commands', registration?.title)
    assertHandler('commands', registration?.handler)
    const agent = normalizeAgentMetadata(registration?.agent)
    if (agent && registration.input !== undefined && !isJsonValue(registration.input)) {
      throw new RuntimeValidationError('commands', 'agent-facing input schema must be a JSON value')
    }
    if (agent && registration.output !== undefined && !isJsonValue(registration.output)) {
      throw new RuntimeValidationError('commands', 'agent-facing output schema must be a JSON value')
    }
    this.services.claims.claim('commands', qualifiedId)

    const contribution: RuntimeCommandContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      agent,
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      handler: registration.handler as RuntimeHandler,
    }
    this.commands.set(qualifiedId, contribution)
    globalCommands.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.commands.delete(qualifiedId)
      globalCommands.delete(qualifiedId)
      this.services.claims.release('commands', qualifiedId)
    }))
  }

  private registerEventListener(event: string, handler: RuntimeEventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : this.services.qualifiedId('events', event)
    if (!isNonEmptyString(qualifiedId)) {
      throw new RuntimeValidationError('events', 'requires a non-empty id')
    }
    assertHandler('events', handler)

    if (global && qualifiedId.startsWith('openforge.') && this.services.host.onHostEvent) {
      const unsubscribe = this.services.host.onHostEvent(qualifiedId.slice('openforge.'.length), handler)
      return this.services.trackDisposable(createDisposable(() => unsubscribe()))
    }

    const target = global ? globalEventHandlers : this.eventHandlers
    const handlers = target.get(qualifiedId) ?? new Set<RuntimeEventHandler>()
    handlers.add(handler)
    target.set(qualifiedId, handlers)

    const contribution: RuntimeEventListenerContribution = {
      id: event,
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      handler,
      global,
    }
    const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`
    if (!global) this.eventListeners.set(listenerKey, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) target.delete(qualifiedId)
      if (!global) this.eventListeners.delete(listenerKey)
    }))
  }

  private async invokeCommand<TOutput>(id: string, payload?: unknown): Promise<TOutput> {
    return this.invokeGlobalCommand<TOutput>(this.services.qualifiedId('commands', id), payload)
  }

  private async invokeGlobalCommand<TOutput>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
    const command = globalCommands.get(qualifiedId)
    if (!command) {
      if (qualifiedId.startsWith('openforge.') && this.services.host.invokeHostCommand) {
        return await this.services.host.invokeHostCommand(qualifiedId.slice('openforge.'.length), payload) as TOutput
      }
      throw new Error(`Unknown command: ${qualifiedId}`)
    }
    return this.invokeRegisteredCommand(command, payload, {
      taskId: null,
      projectId: command.projectId,
      source: 'plugin',
    }) as Promise<TOutput>
  }

  private async invokeRegisteredCommand(
    command: RuntimeCommandContribution,
    payload: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<unknown> {
    validateSchemaValue(command.input, payload, `${command.qualifiedId} input`)
    const output = await command.handler(payload, context)
    validateSchemaValue(command.output, output, `${command.qualifiedId} output`)
    return output
  }
  private async emitEvent<TPayload>(qualifiedEvent: string, payload: TPayload): Promise<void> {
    const handlers = [
      ...Array.from(this.eventHandlers.get(qualifiedEvent) ?? []),
      ...Array.from(globalEventHandlers.get(qualifiedEvent) ?? []),
    ]
    for (const handler of handlers) handler(payload)
  }
}
