import { get } from 'svelte/store'
import type { BackendReadyState, CreateTaskRequest, ImplementationRun, ShellBufferRequest, ShellExitEvent, ShellKillRequest, ShellOutputEvent, ShellResizeRequest, ShellSessionIdentity, ShellSpawnRequest, ShellWriteRequest, StartTaskImplementationRequest } from '@openforge/plugin-sdk'
import {
  fetchAuthoredPrs,
  fetchReviewPrs,
  createTask,
  forceGithubSync,
  fsReadDir,
  fsReadFile,
  fsSearchFiles,
  getAgentReviewComments,
  getAllTasks,
  getAuthoredPrs,
  getConfig,
  getFileAtRef,
  getFileContent,
  getPrFileDiffs,
  getPrOverviewComments,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPtyBuffer,
  getReviewComments,
  getReviewPrs,
  getTaskDetail,
  getTasksForProject,
  getTaskWorkspace,
  getLatestSession,
  markReviewPrViewed,
  killPty,
  openUrl,
  pluginBackendWhenReady,
  pluginInvoke,
  resizePty,
  setConfig,
  setProjectConfig,
  spawnShellPty,
  startImplementation,
  submitPrReview,
  updateAgentReviewCommentStatus,
  updateTaskStatus,
  updateTaskSummary,
  writePty,
} from '../ipc'
import { activeProjectId, currentView, selectedTaskId } from '../stores'
import type { AppView } from '../types'
import { installedPlugins } from './pluginStore'
import { isPluginViewKey } from './types'
import {
  emitPluginHostEvent,
  ensurePluginHostStoreSubscriptions,
  getContextSnapshot,
  subscribeToPluginHostEvent,
  waitForTerminalEventSubscriptions,
  waitForTerminalEventSubscriptionsForKey,
} from './pluginHostEvents'

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'global_settings', 'files'])
const pluginBackendReadyStates = new Map<string, BackendReadyState>()

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

function createTaskFromPluginRequest(request: CreateTaskRequest) {
  return createTask(
    request.initialPrompt,
    'backlog',
    request.projectId,
    null,
    request.dependsOn ?? [],
    request.labelNames ?? [],
  )
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function normalizeImplementationRun(status: Awaited<ReturnType<typeof startImplementation>>): ImplementationRun {
  return {
    taskId: status.task_id,
    sessionId: status.session_id,
    workspacePath: status.workspace_path,
  }
}

type ResolvedShellSession = {
  publicSession: ShellSessionIdentity | null
  hostTaskId: string
  terminalIndex: number
  terminalKey: string
}

const shellSessionMappings = new Map<string, ResolvedShellSession>()
const shellSessionOrdinalsByRoot = new Map<string, Map<string, number>>()

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isShellSessionIdentity(value: unknown): value is ShellSessionIdentity {
  if (!isRecord(value) || typeof value.id !== 'string' || !isRecord(value.origin)) return false
  if (value.origin.kind === 'task') return typeof value.origin.taskId === 'string' && value.origin.taskId.length > 0
  if (value.origin.kind === 'project') return typeof value.origin.projectId === 'string' && value.origin.projectId.length > 0
  if (value.origin.kind === 'custom') return typeof value.origin.purpose === 'string' && value.origin.purpose.length > 0
  return false
}

function sanitizeShellKeyPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.:-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'session'
}

function shellSessionRoot(pluginId: string, session: ShellSessionIdentity): string {
  switch (session.origin.kind) {
    case 'task':
      return session.origin.taskId
    case 'project':
      return `project-${session.origin.projectId}`
    case 'custom':
      return `plugin-${pluginId}-${sanitizeShellKeyPart(session.origin.purpose)}`
  }
}

function shellSessionOrdinal(root: string, session: ShellSessionIdentity): number {
  if (typeof session.ordinal === 'number' && Number.isInteger(session.ordinal) && session.ordinal >= 0) {
    return session.ordinal
  }

  let rootOrdinals = shellSessionOrdinalsByRoot.get(root)
  if (!rootOrdinals) {
    rootOrdinals = new Map()
    shellSessionOrdinalsByRoot.set(root, rootOrdinals)
  }

  const existing = rootOrdinals.get(session.id)
  if (existing !== undefined) return existing

  const next = rootOrdinals.size
  rootOrdinals.set(session.id, next)
  return next
}

function resolveShellSession(pluginId: string, request: { session?: unknown; taskId?: unknown; terminalIndex?: unknown }): ResolvedShellSession {
  if (isShellSessionIdentity(request.session)) {
    const mappingKey = `${pluginId}\u0000${request.session.id}`
    const existing = shellSessionMappings.get(mappingKey)
    if (existing) return existing

    const hostTaskId = shellSessionRoot(pluginId, request.session)
    const terminalIndex = shellSessionOrdinal(hostTaskId, request.session)
    const terminalKey = `${hostTaskId}-shell-${terminalIndex}`
    const resolved = { publicSession: request.session, hostTaskId, terminalIndex, terminalKey }
    shellSessionMappings.set(mappingKey, resolved)
    return resolved
  }

  const taskId = typeof request.taskId === 'string' ? request.taskId : ''
  const terminalIndex = Number(request.terminalIndex)
  if (!taskId || !Number.isInteger(terminalIndex) || terminalIndex < 0) {
    throw new Error('shell session requires a public session identity or legacy taskId + terminalIndex')
  }

  return {
    publicSession: null,
    hostTaskId: taskId,
    terminalIndex,
    terminalKey: `${taskId}-shell-${terminalIndex}`,
  }
}

function normalizeShellOutputEvent(session: ShellSessionIdentity, payload: unknown): ShellOutputEvent {
  const record = isRecord(payload) ? payload : {}
  return {
    session,
    data: typeof record.data === 'string' ? record.data : '',
    instanceId: typeof record.instance_id === 'number' ? record.instance_id : null,
  }
}

function normalizeShellExitEvent(session: ShellSessionIdentity, payload: unknown): ShellExitEvent {
  const record = isRecord(payload) ? payload : {}
  return {
    session,
    instanceId: typeof record.instance_id === 'number' ? record.instance_id : null,
  }
}

async function startTaskImplementationFromPluginRequest(request: StartTaskImplementationRequest): Promise<ImplementationRun> {
  const task = await getTaskDetail(request.taskId)
  if (!task.project_id) {
    throw new Error(`Cannot start task ${request.taskId}: task is not associated with a project`)
  }

  const project = (await getProjects()).find((candidate) => candidate.id === task.project_id)
  if (!project) {
    throw new Error(`Cannot start task ${request.taskId}: project ${task.project_id} not found`)
  }

  return normalizeImplementationRun(await startImplementation(request.taskId, project.path))
}

export function clearPluginRuntimeHostState(pluginId: string): void {
  pluginBackendReadyStates.delete(pluginId)
}

export function createPluginRuntimeHost(pluginId: string) {
  const entry = get(installedPlugins).get(pluginId)
  if (entry?.manifest.backend && entry.state !== 'active') {
    pluginBackendReadyStates.set(pluginId, 'starting')
  } else if (!entry?.manifest.backend) {
    pluginBackendReadyStates.delete(pluginId)
  }

  return {
    listProjects: () => getProjects(),
    getProject: async (projectId: string) => (await getProjects()).find((project) => project.id === projectId) ?? null,
    listTasks: (request?: { projectId?: string }) => request?.projectId ? getTasksForProject(request.projectId) : getAllTasks(),
    getTask: (taskId: string) => getTaskDetail(taskId),
    createTask: (request: CreateTaskRequest) => createTaskFromPluginRequest(request),
    updateTaskSummary: (taskId: string, summary: string) => updateTaskSummary(taskId, summary),
    updateTaskStatus: (taskId: string, status: Parameters<typeof updateTaskStatus>[1]) => updateTaskStatus(taskId, status),
    startTaskImplementation: (request: StartTaskImplementationRequest) => startTaskImplementationFromPluginRequest(request),
    getTaskWorkspace: (taskId: string) => getTaskWorkspace(taskId),
    getLatestSession: (taskId: string) => getLatestSession(taskId),
    readDir: (request: { projectId: string; path?: string | null }) => fsReadDir(request.projectId, request.path ?? null),
    readFile: (request: { projectId: string; path: string }) => fsReadFile(request.projectId, request.path),
    searchFiles: (request: { projectId: string; query: string; limit?: number }) => fsSearchFiles(request.projectId, request.query, request.limit),
    spawnShell: async (request: ShellSpawnRequest) => {
      if ('session' in request) {
        const resolved = resolveShellSession(pluginId, request)
        await waitForTerminalEventSubscriptionsForKey(resolved.terminalKey)
        return spawnShellPty(resolved.hostTaskId, request.cwd, request.cols, request.rows, resolved.terminalIndex)
      }

      await waitForTerminalEventSubscriptions(request as unknown as Record<string, unknown>)
      return spawnShellPty(request.taskId, request.cwd, request.cols, request.rows, request.terminalIndex)
    },
    writeShell: (request: ShellWriteRequest) => {
      const terminalKey = 'session' in request ? resolveShellSession(pluginId, request).terminalKey : request.taskId
      return writePty(terminalKey, request.data)
    },
    resizeShell: (request: ShellResizeRequest) => {
      const terminalKey = 'session' in request ? resolveShellSession(pluginId, request).terminalKey : request.taskId
      return resizePty(terminalKey, request.cols, request.rows)
    },
    killShell: (request: ShellKillRequest) => {
      const terminalKey = 'session' in request ? resolveShellSession(pluginId, request).terminalKey : request.taskId
      return killPty(terminalKey)
    },
    getShellBuffer: (request: ShellBufferRequest) => {
      const terminalKey = 'session' in request ? resolveShellSession(pluginId, request).terminalKey : request.taskId
      return getPtyBuffer(terminalKey)
    },
    onShellEvent: (request: { session: ShellSessionIdentity; type: 'output' | 'exit' }, handler: ((event: ShellOutputEvent) => void) | ((event: ShellExitEvent) => void)) => {
      const resolved = resolveShellSession(pluginId, request)
      const eventName = request.type === 'output' ? `pty-output-${resolved.terminalKey}` : `pty-exit-${resolved.terminalKey}`
      const eventHandler = (payload: unknown) => {
        if (request.type === 'output') {
          ;(handler as (event: ShellOutputEvent) => void)(normalizeShellOutputEvent(request.session, payload))
        } else {
          ;(handler as (event: ShellExitEvent) => void)(normalizeShellExitEvent(request.session, payload))
        }
      }
      return subscribeToPluginHostEvent(pluginId, eventName, eventHandler)
    },
    notify: async (request: unknown) => {
      await Promise.resolve()
      emitPluginHostEvent('openforge.notification', request)
    },
    getAttention: () => getProjectAttention(),
    openUrl: (url: string) => openUrl(url),
    getNavigation: () => ({
      activeProjectId: get(activeProjectId),
      currentView: get(currentView),
      selectedTaskId: get(selectedTaskId),
    }),
    navigate: async (request: { viewId?: string; projectId?: string | null; taskId?: string | null }) => {
      if (isAppView(request.viewId)) {
        currentView.set(request.viewId)
      }

      if (request.taskId !== undefined) {
        selectedTaskId.set(request.taskId)
      }

      if (request.projectId !== undefined) {
        activeProjectId.set(request.projectId)
      }

      return {
        activeProjectId: get(activeProjectId),
        currentView: get(currentView),
        selectedTaskId: get(selectedTaskId),
      }
    },
    getBackendState: () => {
      const entry = get(installedPlugins).get(pluginId)
      if (!entry?.manifest.backend) return 'missing' as const
      if (entry.state === 'error') return 'error' as const
      return pluginBackendReadyStates.get(pluginId) ?? 'starting'
    },
    whenBackendReady: async () => {
      const entry = get(installedPlugins).get(pluginId)
      if (!entry?.manifest.backend) {
        throw new Error(`Plugin backend is unavailable for ${pluginId}`)
      }
      if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
        pluginBackendReadyStates.set(pluginId, 'starting')
      }
      try {
        await pluginBackendWhenReady(pluginId)
        pluginBackendReadyStates.set(pluginId, 'ready')
      } catch (error) {
        pluginBackendReadyStates.set(pluginId, 'error')
        throw error
      }
    },
    onBackendReady: (handler: () => void) => {
      const entry = get(installedPlugins).get(pluginId)
      let disposed = false
      if (entry?.manifest.backend) {
        if (pluginBackendReadyStates.get(pluginId) !== 'ready') {
          pluginBackendReadyStates.set(pluginId, 'starting')
        }
        pluginBackendWhenReady(pluginId).then(() => {
          pluginBackendReadyStates.set(pluginId, 'ready')
          if (!disposed) handler()
        }).catch(() => {
          pluginBackendReadyStates.set(pluginId, 'error')
        })
      }
      return () => { disposed = true }
    },
    invokeBackendMethod: async (method: string, payload?: unknown) => {
      try {
        const result = await pluginInvoke(pluginId, method, payload ?? null)
        pluginBackendReadyStates.set(pluginId, 'ready')
        return result
      } catch (error) {
        pluginBackendReadyStates.set(pluginId, 'error')
        throw error
      }
    },
    getConfig: (key: string) => getConfig(key),
    setConfig: (key: string, value: unknown) => setConfig(key, typeof value === 'string' ? value : JSON.stringify(value)),
    getProjectConfig: (projectId: string, key: string) => getProjectConfig(projectId, key),
    setProjectConfig: (projectId: string, key: string, value: unknown) => setProjectConfig(projectId, key, typeof value === 'string' ? value : JSON.stringify(value)),
    invokeHostCommand: (command: string, payload: unknown) => {
      ensurePluginHostStoreSubscriptions()
      return invokePluginHostCommand(command, payload)
    },
    onHostEvent: (event: string, handler: (payload: unknown) => void) => {
      ensurePluginHostStoreSubscriptions()
      return subscribeToPluginHostEvent(pluginId, event, handler)
    },
  }
}

export async function invokePluginHostCommand(command: string, payload: unknown): Promise<unknown> {
  const commandPayload = payload !== null && typeof payload === 'object'
    ? payload as Record<string, unknown>
    : undefined

  switch (command) {
    case 'getContext':
      return getContextSnapshot()
    case 'getSelection':
      return { selectedTaskId: get(selectedTaskId) }
    case 'getNavigation':
      return {
        activeProjectId: get(activeProjectId),
        currentView: get(currentView),
      }
    case 'getTaskContext': {
      const taskId = typeof commandPayload?.taskId === 'string' ? commandPayload.taskId : get(selectedTaskId)
      return { taskId }
    }
    case 'getProjectContext': {
      const projectId = typeof commandPayload?.projectId === 'string' ? commandPayload.projectId : get(activeProjectId)
      return { projectId }
    }
    case 'createTask': {
      const projectId = typeof commandPayload?.projectId === 'string' ? commandPayload.projectId : null
      if (!projectId) {
        throw new Error('createTask requires projectId')
      }
      return createTask(
        String(commandPayload?.initialPrompt ?? ''),
        'backlog',
        projectId,
        null,
        stringArray(commandPayload?.dependsOn),
        stringArray(commandPayload?.labelNames),
      )
    }
    case 'startImplementation':
      return startTaskImplementationFromPluginRequest({ taskId: String(commandPayload?.taskId ?? '') })
    case 'navigate': {
      if (isAppView(commandPayload?.currentView)) {
        currentView.set(commandPayload.currentView)
      }

      if (typeof commandPayload?.selectedTaskId === 'string' || commandPayload?.selectedTaskId === null) {
        selectedTaskId.set(commandPayload?.selectedTaskId ?? null)
      }

      if (typeof commandPayload?.activeProjectId === 'string' || commandPayload?.activeProjectId === null) {
        activeProjectId.set(commandPayload?.activeProjectId ?? null)
      }

      return getContextSnapshot()
    }
    case 'forceGithubSync':
      return forceGithubSync()
    case 'openUrl':
      return openUrl(String(commandPayload?.url ?? ''))
    case 'fsReadDir':
      return fsReadDir(String(commandPayload?.projectId ?? ''), typeof commandPayload?.dirPath === 'string' ? commandPayload.dirPath : null)
    case 'fsReadFile':
      return fsReadFile(String(commandPayload?.projectId ?? ''), String(commandPayload?.filePath ?? ''))
    case 'fetchReviewPrs':
      return fetchReviewPrs()
    case 'getReviewPrs':
      return getReviewPrs()
    case 'fetchAuthoredPrs':
      return fetchAuthoredPrs()
    case 'getAuthoredPrs':
      return getAuthoredPrs()
    case 'markReviewPrViewed':
      return markReviewPrViewed(Number(commandPayload?.prId), String(commandPayload?.headSha ?? ''))
    case 'getPrFileDiffs':
      return getPrFileDiffs(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getFileContent':
      return getFileContent(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.sha ?? ''))
    case 'getFileAtRef':
      return getFileAtRef(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), String(commandPayload?.path ?? ''), String(commandPayload?.refSha ?? ''))
    case 'getReviewComments':
      return getReviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'getPrOverviewComments':
      return getPrOverviewComments(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber))
    case 'submitPrReview':
      return submitPrReview(String(commandPayload?.owner ?? ''), String(commandPayload?.repo ?? ''), Number(commandPayload?.prNumber), String(commandPayload?.event ?? ''), String(commandPayload?.body ?? ''), Array.isArray(commandPayload?.comments) ? commandPayload.comments as never : [], String(commandPayload?.commitId ?? ''))
    case 'getAgentReviewComments':
      return getAgentReviewComments(Number(commandPayload?.reviewPrId))
    case 'updateAgentReviewCommentStatus':
      return updateAgentReviewCommentStatus(Number(commandPayload?.commentId), String(commandPayload?.status ?? ''))
    case 'getProjectConfig':
      return getProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''))
    case 'setProjectConfig':
      return setProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    case 'spawnShellPty':
      await waitForTerminalEventSubscriptions(commandPayload)
      return spawnShellPty(String(commandPayload?.taskId ?? ''), String(commandPayload?.cwd ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows), Number(commandPayload?.terminalIndex))
    case 'writePty':
      return writePty(String(commandPayload?.taskId ?? ''), String(commandPayload?.data ?? ''))
    case 'resizePty':
      return resizePty(String(commandPayload?.taskId ?? ''), Number(commandPayload?.cols), Number(commandPayload?.rows))
    case 'killPty':
      return killPty(String(commandPayload?.taskId ?? ''))
    case 'getPtyBuffer':
      return getPtyBuffer(String(commandPayload?.taskId ?? ''))
    case 'getTaskWorkspace':
      return getTaskWorkspace(String(commandPayload?.taskId ?? ''))
    case 'getConfig':
      return getConfig(String(commandPayload?.key ?? ''))
    case 'setConfig':
      return setConfig(String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    default:
      throw new Error(`Unknown plugin host command: ${command}`)
  }
}
