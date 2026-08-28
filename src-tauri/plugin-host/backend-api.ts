import { resolveExternalTextFileChunkSize } from '@openforge-app/plugin-sdk'
import type {
  AgentSession,
  CommandInfo,
  ComposeTaskResult,
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
  TaskFollowUpReceipt,
  TaskWorkspaceInfo,
  WritableBoardStatus,
} from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI } from '@openforge-app/plugin-sdk/backend'
import type { ContributionRegistry } from './contribution-registry'
import type { HostCallbackHandler, HostCallbackOptions, InvokeBackendInput, RuntimeEventHandler, RuntimePluginState } from './runtime-types'

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

function taskListCallbackParams(request?: { projectId?: string | null; includeDone?: boolean }): Record<string, unknown> {
  if (!request) return {}
  const params: Record<string, unknown> = {}
  if (request.projectId !== undefined) params.projectId = request.projectId ?? null
  if (request.includeDone !== undefined) params.includeDone = request.includeDone
  return params
}

function objectCallbackParams(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function pluginFileCallbackParams(pluginId: string, request?: unknown): Record<string, unknown> {
  return { ...objectCallbackParams(request), pluginId }
}

type ExternalTextFileChunkResult = {
  content: string
  nextOffset: number
  eof: boolean
}


function validateExternalTextFileChunk(
  chunk: ExternalTextFileChunkResult,
  offset: number,
  maxBytes: number,
): void {
  if (
    typeof chunk.content !== 'string'
    || !Number.isSafeInteger(chunk.nextOffset)
    || typeof chunk.eof !== 'boolean'
  ) {
    throw new Error('OpenForge host returned an invalid external text file chunk')
  }
  const byteLength = Buffer.byteLength(chunk.content, 'utf8')
  if (
    chunk.nextOffset !== offset + byteLength
    || byteLength > maxBytes
    || (!chunk.eof && byteLength === 0)
  ) {
    throw new Error('OpenForge host returned an invalid external text file chunk')
  }
}

export const DEFAULT_EXTERNAL_TEXT_FILE_READ_TIMEOUT_MS = 10_000

type HostCallbackInvocationOptions = HostCallbackOptions & {
  timeoutMs?: number
  timeoutLabel?: string
}

function waitForHostCallback<T>(callback: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return callback
  signal.throwIfAborted()

  return new Promise<T>((resolve, reject) => {
    const finish = (settle: () => void): void => {
      signal.removeEventListener('abort', onAbort)
      settle()
    }
    const onAbort = (): void => finish(() => {
      reject(signal.reason instanceof Error ? signal.reason : new Error('Host callback cancelled'))
    })

    signal.addEventListener('abort', onAbort, { once: true })
    callback.then(
      value => finish(() => resolve(value)),
      error => finish(() => reject(error)),
    )
  })
}

async function invokeHostCallback<T>(
  handler: HostCallbackHandler,
  method: string,
  params: Record<string, unknown>,
  options?: HostCallbackInvocationOptions,
): Promise<T> {
  options?.signal?.throwIfAborted()
  const timeoutMs = options?.timeoutMs
  const timeoutController = timeoutMs === undefined ? null : new AbortController()
  const forwardAbort = (): void => timeoutController?.abort(options?.signal?.reason)
  const signal = timeoutController?.signal ?? options?.signal
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  if (timeoutController) {
    if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('External text file read timeout must be a positive number')
    }
    options?.signal?.addEventListener('abort', forwardAbort, { once: true })
    timeoutId = setTimeout(() => {
      timeoutController.abort(new Error(
        `${options?.timeoutLabel ?? 'OpenForge host callback'} timed out after ${timeoutMs}ms: ${method}`,
      ))
    }, timeoutMs)
  }

  try {
    const callback = Promise.resolve(handler({ method, params }, signal ? { signal } : undefined)) as Promise<T>
    return await waitForHostCallback(callback, signal)
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    options?.signal?.removeEventListener('abort', forwardAbort)
  }
}

export type BackendApiRuntime = {
  hostCallbacks: HostCallbackHandler | null
  externalTextFileReadTimeoutMs: number
  invokeCommand(input: InvokeBackendInput): Promise<unknown>
  invokeGlobalCommand(qualifiedId: string, payload?: unknown, callerPluginId?: string): Promise<unknown>
  listCommands(): Promise<ReturnType<ContributionRegistry['listCommands']>>
}

export function createBackendApi(
  state: RuntimePluginState,
  runtime: BackendApiRuntime,
  contributions: ContributionRegistry,
): BackendOpenForgeAPI {
  const hostCallback = async <T>(
    method: string,
    params: Record<string, unknown> = {},
    options?: HostCallbackInvocationOptions,
  ): Promise<T> => {
    if (!runtime.hostCallbacks) {
      throw new Error(`OpenForge host capability is unavailable: ${method}`)
    }
    return await invokeHostCallback<T>(runtime.hostCallbacks, method, params, options)
  }

  const api: BackendOpenForgeAPI = {
    commands: {
      register: registration => contributions.registerCommand(state, registration),
      async invoke<TOutput = unknown>(command: string, payload?: unknown): Promise<TOutput> {
        return await runtime.invokeCommand({ pluginId: state.pluginId, command, payload }) as TOutput
      },
      async invokeGlobal<TOutput = unknown>(qualifiedId: string, payload?: unknown): Promise<TOutput> {
        return await runtime.invokeGlobalCommand(qualifiedId, payload, state.pluginId) as TOutput
      },
      list: async () => runtime.listCommands(),
      listCatalog: async request => await hostCallback<CommandInfo[]>('openforge.commands.listCatalog', objectCallbackParams(request)),
    },
    events: {
      on: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, false),
      onGlobal: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, true),
      emit: async (event, payload) => contributions.emitEvent(`${state.pluginId}.${event}`, payload),
      emitGlobal: async (event, payload) => contributions.emitEvent(event, payload),
    },
    storage: state.storage,
    context: {
      getSnapshot: () => ({ pluginId: state.pluginId, projectId: state.projectId }),
    },
    tasks: {
      list: async request => await hostCallback<Task[]>('openforge.tasks.list', taskListCallbackParams(request)),
      get: async taskId => await hostCallback<Task | null>('openforge.tasks.get', { taskId }),
      create: async (request: CreateTaskRequest) => await hostCallback<Task>('openforge.tasks.create', objectCallbackParams(request)),
      compose: async request => await hostCallback<ComposeTaskResult | null>('openforge.tasks.compose', objectCallbackParams(request)),
      updateStatus: async (taskId: string, status: WritableBoardStatus) => { await hostCallback<void>('openforge.tasks.updateStatus', { taskId, status }) },
      listStartPromptContributions: async (projectId: string) => await hostCallback<StartPromptContribution[]>('openforge.tasks.listStartPromptContributions', { projectId }),
      configureStartPromptContribution: async (request: ConfigureStartPromptContributionRequest) => await hostCallback<StartPromptContribution[]>('openforge.tasks.configureStartPromptContribution', { ...objectCallbackParams(request), pluginId: state.pluginId }),
      startImplementation: async (request: StartTaskImplementationRequest) => normalizeImplementationRun(await hostCallback<unknown>('openforge.tasks.startImplementation', objectCallbackParams(request))),
      sendFollowUp: async request => await hostCallback<TaskFollowUpReceipt>('openforge.tasks.sendFollowUp', objectCallbackParams(request)),
      getWorkspace: async (taskId: string) => await hostCallback<TaskWorkspaceInfo | null>('openforge.tasks.getWorkspace', { taskId }),
      getLatestSession: async (taskId: string) => await hostCallback<AgentSession | null>('openforge.tasks.getLatestSession', { taskId }),
    },
    projects: {
      list: async () => await hostCallback<Project[]>('openforge.projects.list'),
      get: async projectId => await hostCallback<Project | null>('openforge.projects.get', { projectId }),
    },
    fs: {
      readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.readDir', objectCallbackParams(request)),
      readFile: async request => await hostCallback<FileContent>('openforge.fs.readFile', objectCallbackParams(request)),
      writeFile: async request => { await hostCallback<void>('openforge.fs.writeFile', objectCallbackParams(request)) },
      searchFiles: async request => await hostCallback<string[]>('openforge.fs.searchFiles', objectCallbackParams(request)),
      userData: {
        readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.userData.readDir', pluginFileCallbackParams(state.pluginId, request)),
        readTextFile: async request => await hostCallback<string>('openforge.fs.userData.readTextFile', pluginFileCallbackParams(state.pluginId, request)),
        writeTextFile: async request => { await hostCallback<void>('openforge.fs.userData.writeTextFile', pluginFileCallbackParams(state.pluginId, request)) },
      },
      external: {
        readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.external.readDir', pluginFileCallbackParams(state.pluginId, request)),
        readTextFile: async request => await hostCallback<string>(
          'openforge.fs.external.readTextFile',
          pluginFileCallbackParams(state.pluginId, request),
          {
            timeoutMs: runtime.externalTextFileReadTimeoutMs,
            timeoutLabel: 'OpenForge external text file host callback',
          },
        ),
        readTextFileChunks: (request) => {
          const chunkSizeBytes = resolveExternalTextFileChunkSize(request.chunkSizeBytes)
          const { root, path, signal } = request
          return (async function* () {
            let offset = 0
            while (true) {
              signal?.throwIfAborted()
              const chunk = await hostCallback<ExternalTextFileChunkResult>(
                'openforge.fs.external.readTextFileChunk',
                { pluginId: state.pluginId, root, path, offset, maxBytes: chunkSizeBytes },
                {
                  signal,
                  timeoutMs: runtime.externalTextFileReadTimeoutMs,
                  timeoutLabel: 'OpenForge external text file host callback',
                },
              )
              signal?.throwIfAborted()
              validateExternalTextFileChunk(chunk, offset, chunkSizeBytes)
              if (chunk.content.length > 0) yield chunk.content
              if (chunk.eof) return
              offset = chunk.nextOffset
            }
          })()
        },
      },
    },
    shell: {
      spawn: async request => await hostCallback<number>('openforge.shell.spawn', objectCallbackParams(request)),
      write: async request => { await hostCallback<void>('openforge.shell.write', objectCallbackParams(request)) },
      resize: async request => { await hostCallback<void>('openforge.shell.resize', objectCallbackParams(request)) },
      kill: async request => { await hostCallback<void>('openforge.shell.kill', objectCallbackParams(request)) },
      getBuffer: async request => await hostCallback<string | null>('openforge.shell.getBuffer', objectCallbackParams(request)),
    },
    notifications: {
      notify: async request => { await hostCallback<void>('openforge.notifications.notify', objectCallbackParams(request)) },
    },
    attention: {
      listProjects: async () => await hostCallback<ProjectAttention[]>('openforge.attention.listProjects'),
    },
    system: {
      openUrl: async url => { await hostCallback<void>('openforge.system.openUrl', { url }) },
      writeClipboardText: async text => { await hostCallback<void>('openforge.system.writeClipboardText', { text }) },
    },
    config: {
      async get<T extends JsonValue = JsonValue>(key: string, projectId?: string): Promise<T | null> {
        return await hostCallback<T | null>('openforge.config.get', { key, projectId: projectId ?? null })
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T, projectId?: string): Promise<void> {
        await hostCallback<void>('openforge.config.set', { key, value, projectId: projectId ?? null })
      },
    },
    projectConfig: {
      async get<T extends JsonValue = JsonValue>(key: string, projectId: string | undefined = state.projectId): Promise<T | null> {
        return await hostCallback<T | null>('openforge.projectConfig.get', { key, projectId: projectId ?? null })
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T, projectId: string | undefined = state.projectId): Promise<void> {
        await hostCallback<void>('openforge.projectConfig.set', { key, value, projectId: projectId ?? null })
      },
    },
    backend: {
      registerMethod: (method, registration) => contributions.registerBackendMethod(state, method, registration),
    },
    background: {
      register: registration => contributions.registerBackgroundService(state, registration),
    },
  }
  return api
}
