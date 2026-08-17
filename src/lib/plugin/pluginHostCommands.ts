import { get } from 'svelte/store'
import { TaskFollowUpError } from '@openforge-app/plugin-sdk'
import type { BackendReadyState, ComposeTaskRequest, ConfigureStartPromptContributionRequest, CreateTaskRequest, ImplementationRun, SendTaskFollowUpRequest, ShellSpawnRequest, StartPromptContribution, StartTaskImplementationRequest, TaskFollowUpReceipt, TaskLinkHandler, TaskLinkOpenRequest, TerminalImageProtocol } from '@openforge-app/plugin-sdk'
import {
  createTask,
  fsReadDir,
  fsReadFile,
  fsSearchFiles,
  getAllTasks,
  getConfig,
  getProjectAttention,
  getProjectConfig,
  getProjects,
  getPtyBuffer,
  getTaskDetail,
  getTasksForProject,
  getTaskWorkspace,
  getLatestSession,
  killPty,
  listOpenCodeCommands,
  openUrl,
  writeClipboardText,
  pluginBackendDeactivate,
  pluginBackendWhenReady,
  pluginInvoke,
  resizePty,
  setConfig,
  setProjectConfig,
  spawnShellPty,
  sendAgentFollowUp,
  startImplementation,
  updateTaskStatus,
  writePty,
} from '../ipc'
import { activeProjectId, currentView, selectedTaskId, taskActiveView } from '../stores'
import { requestTaskCompose } from '../taskCompose'
import type { AppView } from '../types'
import { installedPlugins } from './pluginStore'
import { createHostBrowserSurfaces, destroyHostPluginBrowserSurfaces } from './taskBrowserSurfaces'
import { taskLinkRouter } from './taskLinks'
import { isPluginViewKey } from './types'
import {
  emitPluginHostEvent,
  ensurePluginHostStoreSubscriptions,
  getContextSnapshot,
  subscribeToPluginHostEvent,
  waitForTerminalEventSubscriptions,
} from './pluginHostEvents'

const STATIC_APP_VIEWS = new Set<AppView>(['board', 'settings', 'global_settings', 'files'])
const pluginBackendReadyStates = new Map<string, BackendReadyState>()
const MAX_START_PROMPT_CONTRIBUTION_LENGTH = 16_000
const START_PROMPT_CONTRIBUTIONS_KEY = 'start_prompt_contributions'

function isAppView(value: unknown): value is AppView {
  return typeof value === 'string' && (STATIC_APP_VIEWS.has(value as AppView) || isPluginViewKey(value))
}

function createTaskFromPluginRequest(request: CreateTaskRequest) {
  return createTask(
    request.initialPrompt,
    'backlog',
    request.projectId,
    null,
    {
      dependsOn: request.dependsOn ?? [],
      labelNames: request.labelNames ?? [],
    },
  )
}

export async function composeTaskFromPluginRequest(request: ComposeTaskRequest) {
  const projectId = request?.projectId
  if (!projectId) throw new Error('composeTask requires a projectId')
  // The dialog creates against whichever project is active, so move there
  // first rather than silently writing the task to the wrong project.
  if (get(activeProjectId) !== projectId) {
    activeProjectId.set(projectId)
  }
  return requestTaskCompose(request)
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function shellSessionKey(request: { taskId: string; terminalIndex: number }): string {
  if (!request.taskId) {
    throw new Error('shell callback requires taskId')
  }
  if (!Number.isInteger(request.terminalIndex) || request.terminalIndex < 0) {
    throw new Error('shell callback requires a non-negative integer terminalIndex')
  }
  return `${request.taskId}-shell-${request.terminalIndex}`
}

function shellSessionKeyFromPayload(commandPayload: Record<string, unknown> | undefined): string {
  const terminalIndex = commandPayload?.terminalIndex
  if (typeof terminalIndex !== 'number') {
    throw new Error('shell callback requires a non-negative integer terminalIndex')
  }

  return shellSessionKey({
    taskId: String(commandPayload?.taskId ?? ''),
    terminalIndex,
  })
}

function normalizeImplementationRun(status: Awaited<ReturnType<typeof startImplementation>>): ImplementationRun {
  return {
    taskId: status.task_id,
    sessionId: status.session_id,
    workspacePath: status.workspace_path,
  }
}

async function sendTaskFollowUpFromPluginRequest(request: SendTaskFollowUpRequest): Promise<TaskFollowUpReceipt> {
  if (!request.taskId?.trim()) {
    throw new TaskFollowUpError('DELIVERY_FAILED', 'Sending Agent follow-up requires a Task ID')
  }
  if (!request.message?.trim()) {
    throw new TaskFollowUpError('DELIVERY_FAILED', 'Sending Agent follow-up requires a message')
  }

  try {
    return await sendAgentFollowUp(request.taskId, request.message)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const noSessionPrefix = 'AGENT_FOLLOW_UP_NO_SESSION:'
    const deliveryPrefix = 'AGENT_FOLLOW_UP_DELIVERY_FAILED:'
    if (message.includes(noSessionPrefix)) {
      throw new TaskFollowUpError('NO_SESSION', message.slice(message.indexOf(noSessionPrefix) + noSessionPrefix.length).trim())
    }
    if (message.includes(deliveryPrefix)) {
      throw new TaskFollowUpError('DELIVERY_FAILED', message.slice(message.indexOf(deliveryPrefix) + deliveryPrefix.length).trim())
    }
    throw new TaskFollowUpError('DELIVERY_FAILED', message)
  }
}

function normalizeStartPromptContributions(value: string | null): StartPromptContribution[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((entry): entry is StartPromptContribution => entry && typeof entry === 'object' && typeof entry.id === 'string' && typeof entry.content === 'string')
      .map((entry) => ({
        id: entry.id,
        enabled: entry.enabled !== false,
        content: entry.content,
        order: typeof entry.order === 'number' && Number.isFinite(entry.order) ? entry.order : 0,
      }))
  } catch {
    return []
  }
}

async function listStartPromptContributionsForProject(projectId: string): Promise<StartPromptContribution[]> {
  if (!projectId) {
    throw new Error('start prompt contributions require projectId')
  }

  return normalizeStartPromptContributions(await getProjectConfig(projectId, START_PROMPT_CONTRIBUTIONS_KEY))
}

async function configureStartPromptContributionForProject(request: ConfigureStartPromptContributionRequest): Promise<StartPromptContribution[]> {
  const projectId = request.projectId
  if (!projectId) {
    throw new Error('start prompt contributions require projectId')
  }
  if (!request.id?.trim()) {
    throw new Error('start prompt contribution requires id')
  }
  if (typeof request.content !== 'string') {
    throw new Error('start prompt contribution requires string content')
  }
  if (request.content && request.content.length > MAX_START_PROMPT_CONTRIBUTION_LENGTH) {
    throw new Error(`start prompt contribution content exceeds ${MAX_START_PROMPT_CONTRIBUTION_LENGTH} characters`)
  }

  const existing = await listStartPromptContributionsForProject(projectId)
  const contribution: StartPromptContribution = {
    id: request.id.trim(),
    enabled: request.enabled !== false,
    content: request.content,
    order: typeof request.order === 'number' && Number.isFinite(request.order) ? request.order : 0,
  }
  const next = [
    ...existing.filter((entry) => entry.id !== contribution.id),
    contribution,
  ].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))

  await setProjectConfig(projectId, START_PROMPT_CONTRIBUTIONS_KEY, JSON.stringify(next))
  return next
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

  // Plugin-initiated starts intentionally omit a divergenceResolution, so the
  // backend defaults to `Auto`. This is a headless call with no UI to surface
  // the divergence modal, so for a diverged existing-branch task the backend's
  // Auto path fails safe with a structured error rather than silently mutating
  // the branch. Interactive starts route through resolveBranchStart (branchStart.ts)
  // to prompt the user instead.
  return normalizeImplementationRun(await startImplementation(request.taskId, project.path))
}

export function clearPluginRuntimeHostState(pluginId: string): void {
  pluginBackendReadyStates.delete(pluginId)
}

export async function deactivatePluginBackend(pluginId: string): Promise<void> {
  const entry = get(installedPlugins).get(pluginId)
  if (!entry?.manifest.backend) return

  await pluginBackendDeactivate(pluginId)
  clearPluginRuntimeHostState(pluginId)
}

export async function destroyPluginBrowserSurfaces(pluginId: string): Promise<void> {
  await destroyHostPluginBrowserSurfaces(pluginId)
}

export async function ensurePluginBackendReady(pluginId: string): Promise<void> {
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
}

export function createPluginRuntimeHost(pluginId: string) {
  const browserSurfaces = createHostBrowserSurfaces(pluginId)
  const entry = get(installedPlugins).get(pluginId)
  if (entry?.manifest.backend && entry.state !== 'active') {
    pluginBackendReadyStates.set(pluginId, 'starting')
  } else if (!entry?.manifest.backend) {
    pluginBackendReadyStates.delete(pluginId)
  }

  return {
    listProjects: () => getProjects(),
    getProject: async (projectId: string) => (await getProjects()).find((project) => project.id === projectId) ?? null,
    listTasks: (request?: { projectId?: string | null; includeDone?: boolean }) => request?.projectId ? getTasksForProject(request.projectId, request.includeDone) : getAllTasks(),
    getTask: (taskId: string) => getTaskDetail(taskId),
    createTask: (request: CreateTaskRequest) => createTaskFromPluginRequest(request),
    composeTask: composeTaskFromPluginRequest,
    updateTaskStatus: (taskId: string, status: Parameters<typeof updateTaskStatus>[1]) => updateTaskStatus(taskId, status),
    listStartPromptContributions: (projectId: string) => listStartPromptContributionsForProject(projectId),
    configureStartPromptContribution: (request: ConfigureStartPromptContributionRequest) => configureStartPromptContributionForProject(request),
    startTaskImplementation: (request: StartTaskImplementationRequest) => startTaskImplementationFromPluginRequest(request),
    sendTaskFollowUp: (request: SendTaskFollowUpRequest) => sendTaskFollowUpFromPluginRequest(request),
    getTaskWorkspace: (taskId: string) => getTaskWorkspace(taskId),
    getLatestSession: (taskId: string) => getLatestSession(taskId),
    // The Claude catalog is project-scoped in the sidecar; with no project there
    // are no project-independent entries to return yet, so yield an empty list.
    listCommandCatalog: (request?: { projectId?: string | null }) =>
      request?.projectId ? listOpenCodeCommands(request.projectId) : Promise.resolve([]),
    readDir: (request: { projectId: string; path?: string | null }) => fsReadDir(request.projectId, request.path ?? null),
    readFile: (request: { projectId: string; path: string }) => fsReadFile(request.projectId, request.path),
    searchFiles: (request: { projectId: string; query: string; limit?: number }) => fsSearchFiles(request.projectId, request.query, request.limit),
    spawnShell: async (request: ShellSpawnRequest) => {
      await waitForTerminalEventSubscriptions(request)
      return spawnShellPty(
        request.taskId,
        request.cwd,
        request.cols,
        request.rows,
        request.terminalIndex,
        request.terminalImageProtocol ?? null,
      )
    },
    writeShell: (request: { taskId: string; terminalIndex: number; data: string }) => writePty(shellSessionKey(request), request.data),
    resizeShell: (request: { taskId: string; terminalIndex: number; cols: number; rows: number }) => resizePty(shellSessionKey(request), request.cols, request.rows),
    killShell: (request: { taskId: string; terminalIndex: number }) => killPty(shellSessionKey(request)),
    getShellBuffer: (request: { taskId: string; terminalIndex: number }) => getPtyBuffer(shellSessionKey(request)),
    notify: async (request: unknown) => {
      await Promise.resolve()
      emitPluginHostEvent('openforge.notification', request)
    },
    getAttention: () => getProjectAttention(),
    openUrl: (url: string) => openUrl(url),
    writeClipboardText: (text: string) => writeClipboardText(text),
    openTaskLink: (request: TaskLinkOpenRequest) => taskLinkRouter.open(request),
    registerTaskLinkHandler: (qualifiedPluginId: string, handler: TaskLinkHandler) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Task link handler plugin identity mismatch')
      return taskLinkRouter.registerHandler(pluginId, handler)
    },
    getNavigation: () => ({
      activeProjectId: get(activeProjectId),
      currentView: get(currentView),
      selectedTaskId: get(selectedTaskId),
    }),
    navigate: async (request: { viewId?: string; projectId?: string | null; taskId?: string | null; taskViewId?: string }) => {
      let qualifiedTaskViewId: string | null = null
      if (request.taskViewId !== undefined) {
        if (request.taskId === undefined || request.taskId === null) {
          throw new Error('navigation.navigate taskViewId requires a non-null taskId')
        }
        const taskViewId = request.taskViewId.trim()
        if (taskViewId.length === 0) {
          throw new Error('navigation.navigate taskViewId must be non-empty')
        }
        qualifiedTaskViewId = `${pluginId}:${taskViewId}`
      }

      // Change the project first: the projectViewSnapshots capture subscriber
      // (router.svelte.ts) snapshots the OUTGOING project when activeProjectId changes
      // and must read the view stores while they still reflect where the user was —
      // before the lines below rewrite them for the destination.
      if (request.projectId !== undefined) {
        activeProjectId.set(request.projectId)
      }

      if (isAppView(request.viewId)) {
        currentView.set(request.viewId)
      }

      if (qualifiedTaskViewId !== null && request.taskId !== undefined && request.taskId !== null) {
        const nextActiveViews = new Map(get(taskActiveView))
        nextActiveViews.set(request.taskId, qualifiedTaskViewId)
        taskActiveView.set(nextActiveViews)
      }

      if (request.taskId !== undefined) {
        if (qualifiedTaskViewId !== null) currentView.set('board')
        selectedTaskId.set(request.taskId)
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
      await ensurePluginBackendReady(pluginId)
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
    getOrCreateBrowserSurface: (qualifiedPluginId: string, request: Parameters<typeof browserSurfaces.getOrCreate>[0]) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Task Browser Surface plugin identity mismatch')
      return browserSurfaces.getOrCreate(request)
    },
    resetBrowserSession: (qualifiedPluginId: string) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Plugin Browser Session plugin identity mismatch')
      return browserSurfaces.resetSession()
    },
    destroyPluginBrowserSurfaces: (qualifiedPluginId: string) => {
      if (qualifiedPluginId !== pluginId) throw new Error('Task Browser Surface plugin identity mismatch')
      return destroyPluginBrowserSurfaces(pluginId)
    },
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
        {
          dependsOn: stringArray(commandPayload?.dependsOn),
          labelNames: stringArray(commandPayload?.labelNames),
        },
      )
    }
    case 'listStartPromptContributions':
      return listStartPromptContributionsForProject(String(commandPayload?.projectId ?? ''))
    case 'configureStartPromptContribution': {
      if (typeof commandPayload?.content !== 'string') {
        throw new Error('start prompt contribution requires string content')
      }
      return configureStartPromptContributionForProject({
        projectId: String(commandPayload?.projectId ?? ''),
        id: String(commandPayload?.id ?? ''),
        enabled: commandPayload?.enabled !== false,
        content: commandPayload.content,
        order: typeof commandPayload?.order === 'number' ? commandPayload.order : undefined,
      })
    }
    case 'startImplementation':
      return startTaskImplementationFromPluginRequest({ taskId: String(commandPayload?.taskId ?? '') })
    case 'sendTaskFollowUp':
      return sendTaskFollowUpFromPluginRequest({
        taskId: String(commandPayload?.taskId ?? ''),
        message: String(commandPayload?.message ?? ''),
      })
    case 'navigate': {
      // activeProjectId first — see the capture-ordering note in the navigate() host
      // method above: the snapshot subscriber must see the outgoing project's view.
      if (typeof commandPayload?.activeProjectId === 'string' || commandPayload?.activeProjectId === null) {
        activeProjectId.set(commandPayload?.activeProjectId ?? null)
      }

      if (isAppView(commandPayload?.currentView)) {
        currentView.set(commandPayload.currentView)
      }

      if (typeof commandPayload?.selectedTaskId === 'string' || commandPayload?.selectedTaskId === null) {
        selectedTaskId.set(commandPayload?.selectedTaskId ?? null)
      }

      return getContextSnapshot()
    }
    case 'openUrl':
      return openUrl(String(commandPayload?.url ?? ''))
    case 'fsReadDir':
      return fsReadDir(String(commandPayload?.projectId ?? ''), typeof commandPayload?.dirPath === 'string' ? commandPayload.dirPath : null)
    case 'fsReadFile':
      return fsReadFile(String(commandPayload?.projectId ?? ''), String(commandPayload?.filePath ?? ''))
    case 'getProjectConfig':
      return getProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''))
    case 'setProjectConfig':
      return setProjectConfig(String(commandPayload?.projectId ?? ''), String(commandPayload?.key ?? ''), String(commandPayload?.value ?? ''))
    case 'spawnShellPty':
      await waitForTerminalEventSubscriptions(commandPayload)
      return spawnShellPty(
        String(commandPayload?.taskId ?? ''),
        String(commandPayload?.cwd ?? ''),
        Number(commandPayload?.cols),
        Number(commandPayload?.rows),
        Number(commandPayload?.terminalIndex),
        commandPayload?.terminalImageProtocol === 'iterm2' ? commandPayload.terminalImageProtocol as TerminalImageProtocol : null,
      )
    case 'writePty':
      return writePty(shellSessionKeyFromPayload(commandPayload), String(commandPayload?.data ?? ''))
    case 'resizePty':
      return resizePty(shellSessionKeyFromPayload(commandPayload), Number(commandPayload?.cols), Number(commandPayload?.rows))
    case 'killPty':
      return killPty(shellSessionKeyFromPayload(commandPayload))
    case 'getPtyBuffer':
      return getPtyBuffer(shellSessionKeyFromPayload(commandPayload))
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
