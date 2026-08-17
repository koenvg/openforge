import type {
  AgentSession,
  BoardStatus,
  ConfigureStartPromptContributionRequest,
  CreateTaskRequest,
  FileContent,
  FileEntry,
  ImplementationRun,
  JsonValue,
  Project,
  ProjectAttention,
  StartPromptContribution,
  StartTaskImplementationRequest,
  Task,
  TaskWorkspaceInfo,
} from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/backend'
import type { ContributionRegistry } from './contribution-registry'
import type { HostCallbackHandler, InvokeBackendInput, RuntimeEventHandler, RuntimePluginState } from './runtime-types'

function requireImplementationRunString(value: unknown, fieldName: string): string {
  if (typeof value === 'string' && value.length > 0) return value
  throw new Error(`Host callback returned invalid implementation run field: ${fieldName}`)
}

function normalizeImplementationRun(value: unknown): ImplementationRun {
  if (value === null || typeof value !== 'object') {
    throw new Error('Host callback returned invalid implementation run')
  }

  const record = value as Record<string, unknown>
  return {
    taskId: requireImplementationRunString(record.taskId ?? record.task_id, 'taskId'),
    sessionId: requireImplementationRunString(record.sessionId ?? record.session_id, 'sessionId'),
    workspacePath: requireImplementationRunString(record.workspacePath ?? record.workspace_path, 'workspacePath'),
  }
}

function taskListCallbackParams(request?: { projectId?: string | null }): Record<string, unknown> {
  if (!request || request.projectId === undefined) return {}
  return { projectId: request.projectId ?? null }
}

function objectCallbackParams(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

// The durable callback bridge currently supports the capability set that pre-dates
// commands.listCatalog, tasks.compose, and tasks.sendFollowUp. Model that exact
// runtime surface here so this refactor does not advertise unsupported behavior.
type ExistingKeyValueConfigApi = {
  get<T extends JsonValue = JsonValue>(key: string, projectId?: string | null): Promise<T | null>
  set<T extends JsonValue = JsonValue>(key: string, value: T, projectId?: string | null): Promise<void>
}

type ExistingBackendOpenForgeApi = Omit<BackendOpenForgeAPI, 'commands' | 'tasks' | 'config' | 'projectConfig'> & {
  commands: Omit<BackendOpenForgeAPI['commands'], 'listCatalog'>
  tasks: Omit<BackendOpenForgeAPI['tasks'], 'compose' | 'sendFollowUp'>
  config: ExistingKeyValueConfigApi
  projectConfig: ExistingKeyValueConfigApi
}

export type BackendApiRuntime = {
  hostCallbacks: HostCallbackHandler | null
  invokeCommand(input: InvokeBackendInput): Promise<unknown>
  invokeGlobalCommand(qualifiedId: string, payload?: unknown, callerPluginId?: string): Promise<unknown>
  listCommands(): Promise<ReturnType<ContributionRegistry['listCommands']>>
}

export function createBackendApi(
  state: RuntimePluginState,
  runtime: BackendApiRuntime,
  contributions: ContributionRegistry,
): BackendOpenForgeAPI {
  const contextSnapshot: OpenForgeContextSnapshot = {
    pluginId: state.pluginId,
    projectId: state.projectId,
  }
  const hostCallback = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
    if (!runtime.hostCallbacks) {
      throw new Error(`OpenForge host capability is unavailable: ${method}`)
    }
    return await runtime.hostCallbacks({ method, params }) as T
  }

  const api: ExistingBackendOpenForgeApi = {
    commands: {
      register: registration => contributions.registerCommand(state, registration),
      async invoke<TOutput = unknown>(command: string, payload?: unknown): Promise<TOutput> {
        return await runtime.invokeCommand({ pluginId: state.pluginId, command, payload }) as TOutput
      },
      async invokeGlobal<TOutput = unknown>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
        return await runtime.invokeGlobalCommand(qualifiedId, payload, state.pluginId) as TOutput
      },
      list: async () => runtime.listCommands(),
    },
    events: {
      on: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, false),
      onGlobal: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, true),
      emit: async (event, payload) => contributions.emitEvent(`${state.pluginId}.${event}`, payload),
      emitGlobal: async (event, payload) => contributions.emitEvent(event, payload),
    },
    storage: state.storage,
    context: {
      getSnapshot: () => ({ ...contextSnapshot }),
    },
    tasks: {
      list: async request => await hostCallback<Task[]>('openforge.tasks.list', taskListCallbackParams(request)),
      get: async taskId => await hostCallback<Task | null>('openforge.tasks.get', { taskId }),
      create: async (request: CreateTaskRequest) => await hostCallback<Task>('openforge.tasks.create', objectCallbackParams(request)),
      updateSummary: async (taskId: string, summary: string) => { await hostCallback<void>('openforge.tasks.updateSummary', { taskId, summary }) },
      updateStatus: async (taskId: string, status: BoardStatus) => { await hostCallback<void>('openforge.tasks.updateStatus', { taskId, status }) },
      listStartPromptContributions: async (projectId: string) => await hostCallback<StartPromptContribution[]>('openforge.tasks.listStartPromptContributions', { projectId }),
      configureStartPromptContribution: async (request: ConfigureStartPromptContributionRequest) => await hostCallback<StartPromptContribution[]>('openforge.tasks.configureStartPromptContribution', objectCallbackParams(request)),
      startImplementation: async (request: StartTaskImplementationRequest) => normalizeImplementationRun(await hostCallback<unknown>('openforge.tasks.startImplementation', objectCallbackParams(request))),
      getWorkspace: async (taskId: string) => await hostCallback<TaskWorkspaceInfo | null>('openforge.tasks.getWorkspace', { taskId }),
      getLatestSession: async (taskId: string) => await hostCallback<AgentSession | null>('openforge.tasks.getLatestSession', { taskId }),
    },
    projects: {
      list: async () => await hostCallback<Project[]>('openforge.projects.list'),
      get: async projectId => await hostCallback<Project | null>('openforge.projects.get', { projectId }),
    },
    fs: {
      readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.readDir', request as unknown as Record<string, unknown>),
      readFile: async request => await hostCallback<FileContent>('openforge.fs.readFile', request as unknown as Record<string, unknown>),
      writeFile: async request => { await hostCallback<void>('openforge.fs.writeFile', request as unknown as Record<string, unknown>) },
      searchFiles: async request => await hostCallback<string[]>('openforge.fs.searchFiles', request as unknown as Record<string, unknown>),
    },
    shell: {
      spawn: async request => await hostCallback<number>('openforge.shell.spawn', request as unknown as Record<string, unknown>),
      write: async request => { await hostCallback<void>('openforge.shell.write', request as unknown as Record<string, unknown>) },
      resize: async request => { await hostCallback<void>('openforge.shell.resize', request as unknown as Record<string, unknown>) },
      kill: async request => { await hostCallback<void>('openforge.shell.kill', request as unknown as Record<string, unknown>) },
      getBuffer: async request => await hostCallback<string | null>('openforge.shell.getBuffer', request as unknown as Record<string, unknown>),
    },
    notifications: {
      notify: async request => { await hostCallback<void>('openforge.notifications.notify', request as unknown as Record<string, unknown>) },
    },
    attention: {
      listProjects: async () => await hostCallback<ProjectAttention[]>('openforge.attention.listProjects'),
    },
    system: {
      openUrl: async url => { await hostCallback<void>('openforge.system.openUrl', { url }) },
    },
    config: {
      async get<T extends JsonValue = JsonValue>(key: string, projectId?: string | null): Promise<T | null> {
        return await hostCallback<T | null>('openforge.config.get', { key, projectId: projectId ?? null })
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T, projectId?: string | null): Promise<void> {
        await hostCallback<void>('openforge.config.set', { key, value, projectId: projectId ?? null })
      },
    },
    projectConfig: {
      async get<T extends JsonValue = JsonValue>(key: string, projectId: string | null = state.projectId ?? null): Promise<T | null> {
        return await hostCallback<T | null>('openforge.projectConfig.get', { key, projectId })
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T, projectId: string | null = state.projectId ?? null): Promise<void> {
        await hostCallback<void>('openforge.projectConfig.set', { key, value, projectId })
      },
    },
    backend: {
      registerMethod: (method, registration) => contributions.registerBackendMethod(state, method, registration),
    },
    background: {
      register: registration => contributions.registerBackgroundService(state, registration),
    },
  }
  return api as unknown as BackendOpenForgeAPI
}
