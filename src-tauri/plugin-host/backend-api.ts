import { createBackendShellApi } from './backend-shell-api'
import { resolveExternalTextFileChunkSize, ScopedAgentSessionError } from '@openforge-app/plugin-sdk'
import type {
  ActiveTasks,
  AgentSession,
  CommandInfo,
  InstalledAiProvider,
  ComposeTaskResult,
  ConfigureStartPromptContributionRequest,
  CreateTaskRequest,
  ExternalFileMetadata,
  FileContent,
  DocumentPreviewRead,
  FileEntry,
  ImplementationRun,
  ListTaskSessionsRequest,
  AgentSessionSummaryPage,
  ListAgentSessionsRequest,
  CreateReviewThreadRequest,
  MarkReviewThreadSeenRequest,
  ReplyToReviewThreadRequest,
  ReviewThread,
  ReviewThreadScope,
  SetReviewThreadAwaitingRequest,
  SetReviewThreadStatusRequest,
  JsonValue,
  Project,
  ProjectAttention,
  StartPromptContribution,
  StartTaskImplementationRequest,
  Task,
  CompletedTaskPage,
  CompletedTaskQuery,
  TaskRead,
  TaskFollowUpReceipt,
  TaskWorkspaceInfo,
  UserDataFileAppendResult,
  WritableBoardStatus,
  ScopedAgentSessionChangeEvent,
  ScopedAgentSessionErrorCode,
  ScopedAgentSessionState,
  SessionScope,
  StartScopedAgentSessionRequest,
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

function resolveExternalTextRangeValue(value: number | undefined, name: string, fallback?: number): number | undefined {
  const resolved = value ?? fallback
  if (resolved !== undefined && (!Number.isSafeInteger(resolved) || resolved < 0)) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
  return resolved
}

function normalizeExternalFileMetadata(value: unknown): ExternalFileMetadata {
  if (value === null || typeof value !== 'object') {
    throw new Error('OpenForge host returned invalid external file metadata')
  }
  const { identity, sizeBytes, modifiedAtMs } = value as Record<string, unknown>
  if (
    typeof identity !== 'string'
    || identity.length === 0
    || typeof sizeBytes !== 'number'
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || (modifiedAtMs !== null
      && (typeof modifiedAtMs !== 'number' || !Number.isSafeInteger(modifiedAtMs) || modifiedAtMs < 0))
  ) {
    throw new Error('OpenForge host returned invalid external file metadata')
  }
  return { identity, sizeBytes, modifiedAtMs }
}

function normalizeUserDataFileAppendResult(value: unknown): UserDataFileAppendResult {
  if (value === null || typeof value !== 'object') {
    throw new Error('OpenForge host returned an invalid user-data append result')
  }
  const { sizeBytes } = value as Record<string, unknown>
  if (typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw new Error('OpenForge host returned an invalid user-data append result')
  }
  return { sizeBytes }
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
  listCommands(sourcePluginId: string): Promise<ReturnType<ContributionRegistry['listCommands']>>
  emitGlobalEvent(event: string, payload: unknown, sourcePluginId: string): Promise<void>
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

  const documentCallback = async (method: 'openforge.fs.readDocument' | 'openforge.fs.task.readDocument', request: object): Promise<DocumentPreviewRead> => {
    try {
      return await hostCallback<DocumentPreviewRead>(method, objectCallbackParams(request))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message === `OpenForge host capability is unavailable: ${method}` || message === `unsupported plugin host callback method: ${method}`) {
        throw new Error('DOCUMENT_PREVIEW_UNAVAILABLE_HOST: document reads are unavailable')
      }
      throw error
    }
  }

  const scopedHostCallback = async <T>(method: string, params: Record<string, unknown>): Promise<T> => {
    try {
      return await hostCallback<T>(method, { ...params, pluginId: state.pluginId })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const match = message.match(/(?:^|\b)(INVALID_SCOPE|DUPLICATE_SCOPE|CAPACITY|UNSUPPORTED_TOOL_POLICY|INPUT_TOO_LARGE|PROJECT_NOT_FOUND|FORBIDDEN|NOT_FOUND|NOT_READY|HOST_UNAVAILABLE|INTERNAL):\s*(.*)$/s)
      if (!match) throw error
      throw new ScopedAgentSessionError(match[1] as ScopedAgentSessionErrorCode, match[2] || message)
    }
  }

  type ScopedSessionObserver = {
    disposed: boolean
    polling: boolean
    previous: string
    previousOutputRevision: number | null | undefined
    cursor: number | null
    ready: Promise<void>
    markReady: (() => void) | null
    readyError: unknown
    handlers: Set<(event: ScopedAgentSessionChangeEvent) => void>
    interval: ReturnType<typeof setInterval> | null
  }
  const scopedSessionObservers = new Map<string, ScopedSessionObserver>()
  const subscribeScopedSession = (
    scope: SessionScope,
    handler: (event: ScopedAgentSessionChangeEvent) => void,
  ) => {
    const key = JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
    let observer = scopedSessionObservers.get(key)
    if (!observer) {
      let markReady!: () => void
      const ready = new Promise<void>(resolve => { markReady = resolve })
      const created: ScopedSessionObserver = {
        disposed: false,
        polling: false,
        previous: '',
        previousOutputRevision: undefined,
        cursor: null,
        ready,
        markReady,
        readyError: null,
        handlers: new Set(),
        interval: null,
      }
      const poll = async () => {
        if (created.disposed || created.polling) return
        created.polling = true
        let pollAgain = false
        try {
          const current = await scopedHostCallback<{
            state: ScopedAgentSessionState | null
            outputRevision: number | null
            cursor?: number
            transitions?: Array<{ sequence: number, state: ScopedAgentSessionState }>
            hasMore?: boolean
          }>(
            'openforge.agentSessions.observe', created.cursor === null
              ? { scope }
              : { scope, afterSequence: created.cursor },
          )
          if (created.disposed) return
          const next = JSON.stringify({
            state: current.state,
            outputRevision: current.outputRevision,
          })
          const transitions = current.transitions ?? []
          const isInitialObservation = created.cursor === null
          if (!isInitialObservation && transitions.length > 0) {
            for (const transition of transitions) {
              const event = { ...scope, state: transition.state }
              for (const currentHandler of [...created.handlers]) currentHandler(event)
            }
            const finalTransition = transitions.at(-1)
            const currentDiffersFromFinalTransition = JSON.stringify(finalTransition?.state) !== JSON.stringify(current.state)
            const outputRevisionChanged = created.previousOutputRevision !== undefined
              && created.previousOutputRevision !== current.outputRevision
            if (!current.hasMore && (currentDiffersFromFinalTransition || outputRevisionChanged)) {
              const event = { ...scope, state: current.state }
              for (const currentHandler of [...created.handlers]) currentHandler(event)
            }
          } else if (!isInitialObservation && !current.hasMore && created.previous !== next) {
            const event = { ...scope, state: current.state }
            for (const currentHandler of [...created.handlers]) currentHandler(event)
          }
          created.cursor = current.cursor ?? created.cursor ?? 0
          if (!current.hasMore) {
            created.previous = next
            created.previousOutputRevision = current.outputRevision
          }
          pollAgain = current.hasMore === true
          created.readyError = null
          created.markReady?.()
          created.markReady = null
        } catch (error) {
          // Direct operations retain structured failures; this is an invalidation poll.
          if (created.cursor === null) {
            created.readyError = error
            created.markReady?.()
            created.markReady = null
          }
        } finally {
          created.polling = false
          if (pollAgain && !created.disposed) void poll()
        }
      }
      void poll()
      created.interval = setInterval(() => { void poll() }, 1_000)
      observer = created
      scopedSessionObservers.set(key, observer)
    }
    observer.handlers.add(handler)
    let disposed = false
    return {
      dispose: () => {
        if (disposed) return
        disposed = true
        observer.handlers.delete(handler)
        if (observer.handlers.size > 0) return
        observer.disposed = true
        if (observer.interval) clearInterval(observer.interval)
        observer.markReady?.()
        observer.markReady = null
        scopedSessionObservers.delete(key)
      },
    }
  }

  const waitForScopedSessionObserver = async (scope: SessionScope): Promise<void> => {
    const key = JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
    const observer = scopedSessionObservers.get(key)
    if (!observer) return
    await observer.ready
    if (observer.readyError) throw observer.readyError
  }

  let didWarnLegacyTaskReads = false
  const warnLegacyTaskReads = (): void => {
    if (didWarnLegacyTaskReads) return
    didWarnLegacyTaskReads = true
    console.warn(
      `[OpenForge plugin ${state.pluginId}] tasks.list() and tasks.get() are deprecated; use tasks.active(), tasks.completed(), or tasks.detail()`,
    )
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
      list: async () => runtime.listCommands(state.pluginId),
      listCatalog: async request => await hostCallback<CommandInfo[]>('openforge.commands.listCatalog', objectCallbackParams(request)),
      listInstalledProviders: async () => await hostCallback<InstalledAiProvider[]>('openforge.commands.listInstalledProviders', {}),
    },
    events: {
      on: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, false),
      onGlobal: (event, handler) => contributions.registerEventListener(state, event, handler as RuntimeEventHandler, true),
      emit: async (event, payload) => contributions.emitEvent(`${state.pluginId}.${event}`, payload),
      emitGlobal: async (event, payload) => runtime.emitGlobalEvent(event, payload, state.pluginId),
    },
    storage: state.storage,
    context: {
      getSnapshot: () => ({ pluginId: state.pluginId, projectId: state.projectId }),
    },
    agentSessions: {
      list: async (request: ListAgentSessionsRequest) => await hostCallback<AgentSessionSummaryPage>(
        'openforge.agentSessions.list',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
      start: async (request: StartScopedAgentSessionRequest) => await scopedHostCallback<ScopedAgentSessionState>(
        'openforge.agentSessions.start', objectCallbackParams(request),
      ),
      status: async (scope: SessionScope) => await scopedHostCallback<ScopedAgentSessionState | null>(
        'openforge.agentSessions.status', { scope },
      ),
      input: async (scope: SessionScope, input: string) => {
        await waitForScopedSessionObserver(scope)
        return await scopedHostCallback<ScopedAgentSessionState>(
          'openforge.agentSessions.input', { scope, input },
        )
      },
      abort: async (scope: SessionScope) => await scopedHostCallback<ScopedAgentSessionState>(
        'openforge.agentSessions.abort', { scope },
      ),
      release: async (scope: SessionScope) => { await scopedHostCallback<void>(
        'openforge.agentSessions.release', { scope },
      ) },
      onDidChange: subscribeScopedSession,
    },
    reviewThreads: {
      list: async (scope: ReviewThreadScope) => await hostCallback<ReviewThread[]>(
        'openforge.reviewThreads.list',
        { ...objectCallbackParams(scope), pluginId: state.pluginId },
      ),
      create: async (request: CreateReviewThreadRequest) => await hostCallback<ReviewThread>(
        'openforge.reviewThreads.create',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
      reply: async (request: ReplyToReviewThreadRequest) => await hostCallback<ReviewThread>(
        'openforge.reviewThreads.reply',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
      setStatus: async (request: SetReviewThreadStatusRequest) => await hostCallback<ReviewThread>(
        'openforge.reviewThreads.setStatus',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
      setAwaiting: async (request: SetReviewThreadAwaitingRequest) => await hostCallback<ReviewThread>(
        'openforge.reviewThreads.setAwaiting',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
      markSeen: async (request: MarkReviewThreadSeenRequest) => await hostCallback<ReviewThread>(
        'openforge.reviewThreads.markSeen',
        { ...objectCallbackParams(request), pluginId: state.pluginId },
      ),
    },
    tasks: {
      list: async request => {
        warnLegacyTaskReads()
        return await hostCallback<Task[]>('openforge.tasks.list', taskListCallbackParams(request))
      },
      get: async taskId => {
        warnLegacyTaskReads()
        return await hostCallback<Task | null>('openforge.tasks.get', { taskId })
      },
      active: async (projectId: string) => await hostCallback<ActiveTasks>(
        'openforge.tasks.active',
        { projectId },
      ),
      completed: async (projectId: string, query: CompletedTaskQuery = {}) => await hostCallback<CompletedTaskPage>(
        'openforge.tasks.completed',
        { projectId, query },
      ),
      detail: async (projectId: string, taskId: string) => await hostCallback<TaskRead | null>(
        'openforge.tasks.detail',
        { projectId, taskId },
      ),
      create: async (request: CreateTaskRequest) => await hostCallback<Task>('openforge.tasks.create', objectCallbackParams(request)),
      compose: async request => await hostCallback<ComposeTaskResult | null>('openforge.tasks.compose', objectCallbackParams(request)),
      updateStatus: async (taskId: string, status: WritableBoardStatus) => { await hostCallback<void>('openforge.tasks.updateStatus', { taskId, status }) },
      listStartPromptContributions: async (projectId: string) => await hostCallback<StartPromptContribution[]>('openforge.tasks.listStartPromptContributions', { projectId }),
      configureStartPromptContribution: async (request: ConfigureStartPromptContributionRequest) => await hostCallback<StartPromptContribution[]>('openforge.tasks.configureStartPromptContribution', { ...objectCallbackParams(request), pluginId: state.pluginId }),
      startImplementation: async (request: StartTaskImplementationRequest) => normalizeImplementationRun(await hostCallback<unknown>('openforge.tasks.startImplementation', objectCallbackParams(request))),
      sendFollowUp: async request => await hostCallback<TaskFollowUpReceipt>('openforge.tasks.sendFollowUp', objectCallbackParams(request)),
      getWorkspace: async (taskId: string) => await hostCallback<TaskWorkspaceInfo | null>('openforge.tasks.getWorkspace', { taskId }),
      getLatestSession: async (taskId: string) => await hostCallback<AgentSession | null>('openforge.tasks.getLatestSession', { taskId }),
      listSessions: async (request: ListTaskSessionsRequest) => await hostCallback<AgentSession[]>('openforge.tasks.listSessions', objectCallbackParams(request)),
    },
    projects: {
      list: async () => await hostCallback<Project[]>('openforge.projects.list'),
      get: async projectId => await hostCallback<Project | null>('openforge.projects.get', { projectId }),
    },
    fs: {
      readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.readDir', objectCallbackParams(request)),
      readFile: async request => await hostCallback<FileContent>('openforge.fs.readFile', objectCallbackParams(request)),
      readDocument: request => documentCallback('openforge.fs.readDocument', request),
      writeFile: async request => { await hostCallback<void>('openforge.fs.writeFile', objectCallbackParams(request)) },
      searchFiles: async request => await hostCallback<string[]>('openforge.fs.searchFiles', objectCallbackParams(request)),
      task: {
        readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.task.readDir', objectCallbackParams(request)),
        readFile: async request => await hostCallback<FileContent>('openforge.fs.task.readFile', objectCallbackParams(request)),
        readDocument: request => documentCallback('openforge.fs.task.readDocument', request),
        searchFiles: async request => await hostCallback<string[]>('openforge.fs.task.searchFiles', objectCallbackParams(request)),
      },
      userData: {
        readDir: async request => await hostCallback<FileEntry[]>('openforge.fs.userData.readDir', pluginFileCallbackParams(state.pluginId, request)),
        readTextFile: async request => await hostCallback<string>('openforge.fs.userData.readTextFile', pluginFileCallbackParams(state.pluginId, request)),
        writeTextFile: async request => { await hostCallback<void>('openforge.fs.userData.writeTextFile', pluginFileCallbackParams(state.pluginId, request)) },
        appendTextFile: async request => normalizeUserDataFileAppendResult(await hostCallback<unknown>('openforge.fs.userData.appendTextFile', pluginFileCallbackParams(state.pluginId, request))),
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
        stat: async request => normalizeExternalFileMetadata(await hostCallback<unknown>(
          'openforge.fs.external.stat',
          pluginFileCallbackParams(state.pluginId, request),
          {
            timeoutMs: runtime.externalTextFileReadTimeoutMs,
            timeoutLabel: 'OpenForge external file stat host callback',
          },
        )),
        readTextFileChunks: (request) => {
          const chunkSizeBytes = resolveExternalTextFileChunkSize(request.chunkSizeBytes)
          const startOffsetBytes = resolveExternalTextRangeValue(
            request.startOffsetBytes,
            'startOffsetBytes',
            0,
          ) as number
          const maxBytes = resolveExternalTextRangeValue(request.maxBytes, 'maxBytes')
          const { root, path, signal, expectedIdentity } = request
          if (expectedIdentity !== undefined && expectedIdentity.length === 0) {
            throw new TypeError('expectedIdentity must be a non-empty string')
          }
          return (async function* () {
            let offset = startOffsetBytes
            let remainingBytes = maxBytes
            if (remainingBytes === 0) {
              signal?.throwIfAborted()
              const metadata = normalizeExternalFileMetadata(await hostCallback<unknown>(
                'openforge.fs.external.stat',
                { pluginId: state.pluginId, root, path },
                {
                  signal,
                  timeoutMs: runtime.externalTextFileReadTimeoutMs,
                  timeoutLabel: 'OpenForge external file stat host callback',
                },
              ))
              signal?.throwIfAborted()
              if (expectedIdentity !== undefined && metadata.identity !== expectedIdentity) {
                throw new Error(
                  `External file identity changed: expected ${expectedIdentity}, received ${metadata.identity}`,
                )
              }
              return
            }
            while (remainingBytes === undefined || remainingBytes > 0) {
              signal?.throwIfAborted()
              const readSizeBytes = remainingBytes === undefined
                ? chunkSizeBytes
                : Math.min(chunkSizeBytes, remainingBytes)
              const chunk = await hostCallback<ExternalTextFileChunkResult>(
                'openforge.fs.external.readTextFileChunk',
                {
                  pluginId: state.pluginId,
                  root,
                  path,
                  ...(expectedIdentity === undefined ? {} : { expectedIdentity }),
                  offset,
                  maxBytes: readSizeBytes,
                },
                {
                  signal,
                  timeoutMs: runtime.externalTextFileReadTimeoutMs,
                  timeoutLabel: 'OpenForge external text file host callback',
                },
              )
              signal?.throwIfAborted()
              validateExternalTextFileChunk(chunk, offset, readSizeBytes)
              const chunkBytes = chunk.nextOffset - offset
              if (chunk.content.length > 0) yield chunk.content
              if (chunk.eof) return
              offset = chunk.nextOffset
              if (remainingBytes !== undefined) remainingBytes -= chunkBytes
            }
          })()
        },
      },
    },
    shell: createBackendShellApi(hostCallback),
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
      async get<T extends JsonValue = JsonValue>(key: string, projectId?: string): Promise<T | null> {
        return await hostCallback<T | null>('openforge.projectConfig.get', { key, projectId: projectId ?? state.projectId })
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T, projectId?: string): Promise<void> {
        await hostCallback<void>('openforge.projectConfig.set', { key, value, projectId: projectId ?? state.projectId })
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
