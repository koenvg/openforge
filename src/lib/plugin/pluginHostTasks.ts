import { get } from 'svelte/store'
import { TaskFollowUpError } from '@openforge-app/plugin-sdk'
import type {
  ComposeTaskRequest,
  ConfigureStartPromptContributionRequest,
  CreateTaskRequest,
  ImplementationRun,
  ListTaskSessionsRequest,
  SendTaskFollowUpRequest,
  StartPromptContribution,
  StartTaskImplementationRequest,
  TaskFollowUpReceipt,
} from '@openforge-app/plugin-sdk'
import {
  createTask,
  getAllTasks,
  getLatestSession,
  listAgentSessions,
  getProjectConfig,
  getProjects,
  getTaskDetail,
  getTasksForProject,
  getTaskWorkspace,
  sendAgentFollowUp,
  configureStartPromptContribution as configureStartPromptContributionIpc,
  startImplementation,
  updateTaskStatus,
} from '../ipc'
import { activeProjectId, selectedTaskId } from '../stores'
import { requestTaskCompose } from '../taskCompose'
import type { PluginHostCommandEntries } from './pluginHostCommandRegistry'
import type { RuntimeHostBridge } from './runtimeContributionTypes'

const MAX_START_PROMPT_CONTRIBUTION_LENGTH = 16_000
const START_PROMPT_CONTRIBUTIONS_KEY = 'start_prompt_contributions'

type TaskHostCapabilities = Required<Pick<RuntimeHostBridge,
  | 'listTasks'
  | 'getTask'
  | 'createTask'
  | 'composeTask'
  | 'updateTaskStatus'
  | 'listStartPromptContributions'
  | 'configureStartPromptContribution'
  | 'startTaskImplementation'
  | 'sendTaskFollowUp'
  | 'getTaskWorkspace'
  | 'getLatestSession'
  | 'listTaskSessions'
>>

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

function normalizeStartPromptContributions(
  value: string | null,
  projectId: string,
): StartPromptContribution[] {
  if (value === null) return []

  const errorPrefix = `failed to parse stored start prompt contributions for project ${projectId}`
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`${errorPrefix}: ${detail}`)
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${errorPrefix}: expected an array`)
  }

  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || typeof entry.content !== 'string') {
      throw new Error(`${errorPrefix}: invalid contribution at index ${index}`)
    }
    if (entry.ownerPluginId !== undefined && entry.ownerPluginId !== null && typeof entry.ownerPluginId !== 'string') {
      throw new Error(`${errorPrefix}: ownerPluginId must be a string or null at index ${index}`)
    }
    if (entry.enabled !== undefined && typeof entry.enabled !== 'boolean') {
      throw new Error(`${errorPrefix}: enabled must be a boolean at index ${index}`)
    }
    if (entry.order !== undefined && !Number.isSafeInteger(entry.order)) {
      throw new Error(`${errorPrefix}: order must be a safe integer at index ${index}`)
    }

    return {
      ...(typeof entry.ownerPluginId === 'string' ? { ownerPluginId: entry.ownerPluginId } : {}),
      id: entry.id,
      enabled: entry.enabled ?? true,
      content: entry.content,
      order: entry.order ?? 0,
    }
  })
}

async function listStartPromptContributionsForProject(projectId: string): Promise<StartPromptContribution[]> {
  if (!projectId) {
    throw new Error('start prompt contributions require projectId')
  }

  return normalizeStartPromptContributions(
    await getProjectConfig(projectId, START_PROMPT_CONTRIBUTIONS_KEY),
    projectId,
  )
}

async function configureStartPromptContributionForProject(
  request: ConfigureStartPromptContributionRequest,
  ownerPluginId?: string,
): Promise<StartPromptContribution[]> {
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

  return configureStartPromptContributionIpc(ownerPluginId, {
    projectId,
    id: request.id.trim(),
    enabled: request.enabled !== false,
    content: request.content,
    order: request.order,
  })
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

export function createPluginTaskHostCapabilities(pluginId: string): TaskHostCapabilities {
  return {
    listTasks: (request) => request?.projectId ? getTasksForProject(request.projectId, request.includeDone) : getAllTasks(),
    getTask: (taskId) => getTaskDetail(taskId),
    createTask: createTaskFromPluginRequest,
    composeTask: composeTaskFromPluginRequest,
    updateTaskStatus: (taskId, status) => updateTaskStatus(taskId, status),
    listStartPromptContributions: listStartPromptContributionsForProject,
    configureStartPromptContribution: (request) => configureStartPromptContributionForProject(request, pluginId),
    startTaskImplementation: startTaskImplementationFromPluginRequest,
    sendTaskFollowUp: sendTaskFollowUpFromPluginRequest,
    getTaskWorkspace: (taskId) => getTaskWorkspace(taskId),
    getLatestSession: (taskId) => getLatestSession(taskId),
    listTaskSessions: (request: ListTaskSessionsRequest) => listAgentSessions(request),
  }
}

export const taskCommandHandlers: PluginHostCommandEntries = [
  ['getTaskContext', (payload) => {
    const taskId = typeof payload?.taskId === 'string' ? payload.taskId : get(selectedTaskId)
    return { taskId }
  }],
  ['createTask', (payload) => {
    const projectId = typeof payload?.projectId === 'string' ? payload.projectId : null
    if (!projectId) {
      throw new Error('createTask requires projectId')
    }
    return createTaskFromPluginRequest({
      initialPrompt: String(payload?.initialPrompt ?? ''),
      projectId,
      dependsOn: stringArray(payload?.dependsOn),
      labelNames: stringArray(payload?.labelNames),
    })
  }],
  ['listStartPromptContributions', (payload) =>
    listStartPromptContributionsForProject(String(payload?.projectId ?? ''))],
  ['configureStartPromptContribution', (payload, ownerPluginId) => {
    if (typeof payload?.content !== 'string') {
      throw new Error('start prompt contribution requires string content')
    }
    return configureStartPromptContributionForProject({
      projectId: String(payload?.projectId ?? ''),
      id: String(payload?.id ?? ''),
      enabled: payload?.enabled !== false,
      content: payload.content,
      order: typeof payload?.order === 'number' ? payload.order : undefined,
    }, ownerPluginId)
  }],
  ['startImplementation', (payload) =>
    startTaskImplementationFromPluginRequest({ taskId: String(payload?.taskId ?? '') })],
  ['sendTaskFollowUp', (payload) => sendTaskFollowUpFromPluginRequest({
    taskId: String(payload?.taskId ?? ''),
    message: String(payload?.message ?? ''),
  })],
  ['getTaskWorkspace', (payload) => getTaskWorkspace(String(payload?.taskId ?? ''))],
]
