import type {
  CommandRegistration,
  Disposable,
  FrontendOpenForgeAPI,
  JsonValue,
  OpenForgeCommonAPI,
} from '../types'
import {
  assertFunction,
  assertTitle,
  commandDescriptor,
  createDisposable,
  isJsonValue,
  normalizeAgentCommandMetadata,
  type TestingRegistryServices,
} from './support'
import type {
  TestingCommandContribution,
  TestingCommandHandler,
  TestingEventHandler,
  TestingEventListenerContribution,
} from './contracts'

export type TestingCommonApi = OpenForgeCommonAPI & Pick<FrontendOpenForgeAPI, 'navigation'>

export class TestingCommonApiFake {
  private readonly commands = new Map<string, TestingCommandContribution>()
  private readonly eventListeners = new Map<string, TestingEventListenerContribution>()
  private readonly eventHandlers = new Map<string, Set<TestingEventHandler>>()
  private eventListenerSequence = 0

  constructor(private readonly services: TestingRegistryServices) {}

  createApi(): TestingCommonApi {
    const api: TestingCommonApi = {
      commands: {
        register: (registration) => this.registerCommand(registration),
        invoke: async <TOutput = unknown>(id: string, payload?: unknown) => this.invokeCommand<TOutput>(id, payload),
        invokeGlobal: async <TOutput = unknown>(qualifiedId: string, payload?: unknown) => this.invokeGlobalCommand<TOutput>(qualifiedId, payload),
        list: async () => Array.from(this.commands.values()).map(commandDescriptor),
        listCatalog: async () => [],
      },
      events: {
        on: <TPayload = unknown>(event: string, handler: (payload: TPayload) => void) => this.registerEventListener(event, handler as TestingEventHandler, false),
        onGlobal: <TPayload = unknown>(qualifiedEvent: string, handler: (payload: TPayload) => void) => this.registerEventListener(qualifiedEvent, handler as TestingEventHandler, true),
        emit: async <TPayload = unknown>(event: string, payload: TPayload) => this.emitEvent(event, payload, false),
        emitGlobal: async <TPayload = unknown>(qualifiedEvent: string, payload: TPayload) => this.emitEvent(qualifiedEvent, payload, true),
      },
      storage: this.services.storage,
      context: {
        getSnapshot: () => this.services.getContextSnapshot(),
      },
      tasks: {
        list: async (request) => {
          const projectId = request?.projectId ?? null
          const includeDone = request?.includeDone ?? false
          this.services.calls.taskListRequests.push({ projectId, includeDone })
          return this.services.seededTasks.filter((task) => {
            if (projectId !== null && task.project_id !== projectId) return false
            if (!includeDone && task.status === 'done') return false
            return true
          })
        },
        get: async () => null,
        create: async (request) => {
          this.services.calls.taskCreations.push(request)
          return {
            id: `mock-task-${this.services.calls.taskCreations.length}`,
            initial_prompt: request.initialPrompt,
            status: 'backlog',
            prompt: null,
            title: null,
            title_source: null,
            title_generated_at: null,
            summary: null,
            agent: null,
            permission_mode: null,
            worktree_source: null,
            worktree_branch: null,
            handoff_notes_enabled: true,
            source_ticket_url: null,
            depends_on: request.dependsOn ?? [],
            project_id: request.projectId,
            created_at: 0,
            updated_at: 0,
          }
        },
        updateSummary: async (taskId, summary) => {
          this.services.calls.taskSummaryUpdates.push({ taskId, summary })
        },
        updateStatus: async (taskId, status) => {
          this.services.calls.taskStatusUpdates.push({ taskId, status })
        },
        listStartPromptContributions: async (projectId) => this.services.startPromptContributions(projectId),
        configureStartPromptContribution: async (request) => {
          this.services.calls.startPromptContributionConfigurations.push(request)
          const existing = this.services.startPromptContributions(request.projectId).filter((entry) => entry.id !== request.id)
          const next = [...existing, request].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
          this.services.config.set(`project:${request.projectId}:start_prompt_contributions`, next as unknown as JsonValue)
          return next
        },
        startImplementation: async (request) => {
          this.services.calls.taskImplementationStarts.push(request)
          return {
            taskId: request.taskId,
            workspacePath: '/mock-workspace',
            sessionId: 'mock-session',
          }
        },
        sendFollowUp: async (request) => {
          this.services.calls.taskFollowUps.push(request)
          return {
            taskId: request.taskId,
            sessionId: 'mock-session',
            disposition: 'delivered',
          }
        },
        getWorkspace: async () => null,
        getLatestSession: async () => null,
      },
      projects: {
        list: async () => [],
        get: async () => null,
      },
      fs: {
        readDir: async () => [],
        readFile: async () => ({ type: 'text', content: '', mimeType: null, size: 0 }),
        writeFile: async (request) => {
          this.services.calls.fsWrites.push(request)
        },
        searchFiles: async () => [],
      },
      shell: {
        spawn: async (request) => {
          this.services.calls.shellSpawns.push(request)
          return 0
        },
        write: async (request) => {
          this.services.calls.shellWrites.push(request)
        },
        resize: async (request) => {
          this.services.calls.shellResizes.push(request)
        },
        kill: async (request) => {
          this.services.calls.shellKills.push(request)
        },
        getBuffer: async (request) => {
          this.services.calls.shellBuffers.push(request)
          return null
        },
      },
      notifications: {
        notify: async (request) => {
          this.services.calls.notify.push(request)
        },
      },
      attention: {
        listProjects: async () => [],
      },
      system: {
        openUrl: async (url) => {
          this.services.calls.openUrl.push(url)
        },
      },
      navigation: {
        get: () => this.services.getNavigationSnapshot(),
        navigate: async (request) => {
          this.services.calls.navigationRequests.push(request)
          return this.services.getNavigationSnapshot(request)
        },
      },
      config: {
        get: async <T extends JsonValue = JsonValue>(key: string): Promise<T | null> => this.services.config.has(`global:${key}`)
          ? this.services.config.get(`global:${key}`) as T
          : null,
        set: async (key, value) => {
          this.services.config.set(`global:${key}`, value)
          this.services.calls.configWrites.push({ key, value, projectId: null })
        },
      },
      projectConfig: {
        get: async <T extends JsonValue = JsonValue>(key: string, projectId = this.services.projectId ?? ''): Promise<T | null> => this.services.config.has(`project:${projectId}:${key}`)
          ? this.services.config.get(`project:${projectId}:${key}`) as T
          : null,
        set: async (key, value, projectId = this.services.projectId ?? '') => {
          this.services.config.set(`project:${projectId}:${key}`, value)
          this.services.calls.configWrites.push({ key, value, projectId })
        },
      },
    }

    return api
  }

  getSnapshot(): {
    commands: TestingCommandContribution[]
    eventListeners: TestingEventListenerContribution[]
  } {
    return {
      commands: Array.from(this.commands.values()),
      eventListeners: Array.from(this.eventListeners.values()),
    }
  }

  private registerCommand(registration: CommandRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('commands', registration.id)
    assertTitle('commands', registration.title)
    assertFunction('commands', 'handler', registration.handler)
    const agent = normalizeAgentCommandMetadata(registration.agent)
    if (agent && registration.input !== undefined && !isJsonValue(registration.input)) {
      throw new Error('commands registration agent-facing input schema must be a JSON value')
    }
    if (agent && registration.output !== undefined && !isJsonValue(registration.output)) {
      throw new Error('commands registration agent-facing output schema must be a JSON value')
    }
    this.services.claims.claim('commands', qualifiedId)

    const contribution: TestingCommandContribution = {
      ...registration,
      agent,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      handler: registration.handler as TestingCommandHandler,
    }
    this.commands.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.commands.delete(qualifiedId)
      this.services.claims.release('commands', qualifiedId)
    })
  }

  private registerEventListener(event: string, handler: TestingEventHandler, global: boolean): Disposable {
    const qualifiedId = global ? event : this.services.localQualifiedId('events', event)
    if (qualifiedId.trim().length === 0) {
      throw new Error('events registration requires a non-empty id')
    }
    assertFunction('events', 'handler', handler)

    const handlers = this.eventHandlers.get(qualifiedId) ?? new Set<TestingEventHandler>()
    handlers.add(handler)
    this.eventHandlers.set(qualifiedId, handlers)

    const listenerKey = `${qualifiedId}#${++this.eventListenerSequence}`
    const contribution: TestingEventListenerContribution = {
      id: event,
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      handler,
      global,
    }
    this.eventListeners.set(listenerKey, contribution)

    return createDisposable(() => {
      handlers.delete(handler)
      if (handlers.size === 0) this.eventHandlers.delete(qualifiedId)
      this.eventListeners.delete(listenerKey)
    })
  }

  private async invokeCommand<TOutput>(id: string, payload?: unknown): Promise<TOutput> {
    const qualifiedId = this.services.localQualifiedId('commands', id)
    this.services.calls.commandInvocations.push({ id, qualifiedId, payload })
    return this.invokeGlobalCommand(qualifiedId, payload)
  }

  private async invokeGlobalCommand<TOutput>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
    this.services.calls.globalCommandInvocations.push({ qualifiedId, payload })
    const command = this.commands.get(qualifiedId)
    if (!command) throw new Error(`Unknown command: ${qualifiedId}`)
    return await command.handler(payload) as TOutput
  }

  private async emitEvent<TPayload>(event: string, payload: TPayload, global: boolean): Promise<void> {
    const qualifiedEvent = global ? event : this.services.localQualifiedId('events', event)
    if (global) {
      this.services.calls.emittedGlobalEvents.push({ qualifiedEvent, payload })
    } else {
      this.services.calls.emittedEvents.push({ event, qualifiedEvent, payload })
    }
    for (const handler of Array.from(this.eventHandlers.get(qualifiedEvent) ?? [])) {
      handler(payload)
    }
  }
}
