import {
  MAX_AGENT_SESSION_PAGE_SIZE,
  ScopedAgentSessionError,
  resolveExternalTextFileChunkSize,
} from '../types.js'
import type { FileEntry } from '../domain.js'
import type {
  BackendOpenForgeAPI,
  AgentCommandDescriptor,
  AgentCommandRuntime,
  CommandRegistration,
  Disposable,
  FrontendOpenForgeAPI,
  JsonValue,
  TaskChangeEvent,
  OpenForgeCommonAPI,
  PluginCommandInvocationContext,
  CreateReviewThreadRequest,
  MarkReviewThreadSeenRequest,
  ReplyToReviewThreadRequest,
  ReviewThread,
  ReviewThreadAnchor,
  ReviewThreadChangeEvent,
  ReviewThreadScope,
  ScopedAgentSessionChangeEvent,
  ScopedAgentSessionState,
  SessionScope,
  SetReviewThreadAwaitingRequest,
  SetReviewThreadStatusRequest,
} from '../types.js'
import type { ActiveTasks, CompletedTaskPage, CompletedTaskQuery, Task, TaskDetail, TaskLabel, TaskRead, TaskReference, TaskSummary } from '../domain.js'
import {
  assertFunction,
  assertTitle,
  commandDescriptor,
  createDisposable,
  isJsonValue,
  normalizeAgentCommandMetadata,
  type TestingRegistryServices,
} from './support.js'
import type {
  TestingCommandContribution,
  TestingCommandHandler,
  TestingEventHandler,
  TestingEventListenerContribution,
  TestingExternalTextFile,
  TestingTaskWorkspaceFixture,
} from './contracts.js'

const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

function testingTaskWorkspace(
  workspaces: Readonly<Record<string, TestingTaskWorkspaceFixture>>,
  taskId: string,
): TestingTaskWorkspaceFixture {
  const workspace = workspaces[taskId]
  if (!workspace) throw new Error(`No workspace found for task ${taskId}`)
  if (workspace.error) throw new Error(workspace.error)
  return workspace
}

function readTestingUserDataDir(
  files: ReadonlyMap<string, string>,
  directoryPath: string | null | undefined,
): FileEntry[] {
  const prefix = directoryPath ? `${directoryPath}/` : ''
  const entries = new Map<string, FileEntry>()

  for (const [filePath, content] of files) {
    if (!filePath.startsWith(prefix)) continue
    const childPath = filePath.slice(prefix.length)
    const separatorIndex = childPath.indexOf('/')
    const name = separatorIndex === -1 ? childPath : childPath.slice(0, separatorIndex)
    if (!name) continue

    entries.set(name, separatorIndex === -1
      ? {
          name,
          path: `${prefix}${name}`,
          isDir: false,
          size: UTF8_ENCODER.encode(content).byteLength,
          modifiedAt: null,
        }
      : {
          name,
          path: `${prefix}${name}`,
          isDir: true,
          size: null,
          modifiedAt: null,
        })
  }

  return [...entries.values()].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0
  })
}

const TERMINAL_AGENT_SESSION_STATUSES = new Set(['completed', 'failed', 'interrupted'])

interface AgentSessionCursorPayload {
  version: 1
  createdAt: number
  id: string
  filters: {
    provider: string
    startInclusive: number
    endExclusive: number
    taskId: string | null
  }
}

function encodeAgentSessionCursor(payload: AgentSessionCursorPayload): string {
  const bytes = UTF8_ENCODER.encode(JSON.stringify(payload))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function parseAgentSessionCursor(cursor: string): AgentSessionCursorPayload {
  try {
    const base64 = cursor.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
    const payload = JSON.parse(UTF8_DECODER.decode(bytes)) as Partial<AgentSessionCursorPayload>
    const filters = payload.filters
    if (payload.version !== 1
      || !Number.isSafeInteger(payload.createdAt)
      || typeof payload.id !== 'string'
      || payload.id.length === 0
      || !filters
      || typeof filters.provider !== 'string'
      || !Number.isSafeInteger(filters.startInclusive)
      || !Number.isSafeInteger(filters.endExclusive)
      || (filters.taskId !== null && typeof filters.taskId !== 'string')) {
      throw new Error('invalid payload')
    }
    return payload as AgentSessionCursorPayload
  } catch {
    throw new TypeError('cursor is malformed')
  }
}

function providerSessionId(session: {
  provider: string
  opencode_session_id: string | null
  claude_session_id: string | null
  pi_session_id: string | null
  grok_session_id: string | null
}): string | null {
  switch (session.provider) {
    case 'opencode': return session.opencode_session_id
    case 'claude-code': return session.claude_session_id
    case 'pi': return session.pi_session_id
    case 'grok': return session.grok_session_id
    default: return null
  }
}
function assertNonNegativeSafeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative safe integer`)
  }
}

const SCOPED_EXECUTION_LIMIT = 4
const SCOPED_QUEUE_LIMIT = 32
const SCOPED_INPUT_LIMIT_BYTES = 64 * 1024
const SESSION_SCOPE_LIMITS = {
  namespace: 128,
  targetKey: 2_048,
  revision: 256,
} as const

type TestingScopedAgentSession = ScopedAgentSessionState & {
  scope: SessionScope
  ownerPluginId: string
  queueSequence: number | null
}

function sessionScopeKey(scope: SessionScope): string {
  return JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
}

function assertSessionScope(scope: SessionScope): void {
  for (const field of ['namespace', 'targetKey', 'revision'] as const) {
    const value = scope?.[field]
    if (typeof value !== 'string' || value.length === 0) {
      throw new ScopedAgentSessionError('INVALID_SCOPE', `Session Scope field '${field}' must not be empty`)
    }
    if (value.includes('\0')) {
      throw new ScopedAgentSessionError('INVALID_SCOPE', `Session Scope field '${field}' must not contain NUL`)
    }
    if (UTF8_ENCODER.encode(value).byteLength > SESSION_SCOPE_LIMITS[field]) {
      throw new ScopedAgentSessionError(
        'INVALID_SCOPE',
        `Session Scope field '${field}' exceeds the ${SESSION_SCOPE_LIMITS[field]}-byte limit`,
      )
    }
  }
}

function assertScopedInput(input: string): void {
  if (typeof input !== 'string') {
    throw new ScopedAgentSessionError('NOT_READY', 'Scoped Agent Session input must be a string')
  }
  if (UTF8_ENCODER.encode(input).byteLength > SCOPED_INPUT_LIMIT_BYTES) {
    throw new ScopedAgentSessionError('INPUT_TOO_LARGE', `Scoped Agent Session input exceeds the ${SCOPED_INPUT_LIMIT_BYTES}-byte limit`)
  }
}

function scopedTurnIdFromInput(input: string): string | null {
  return /\n\n<!-- openforge-turn-id:([A-Za-z0-9._:-]{1,128}) -->\s*$/.exec(input)?.[1] ?? null
}

function testingExternalFileIdentity(file: TestingExternalTextFile): string {
  return file.identity ?? `${file.root}:${file.path}`
}

function readTestingExternalTextRange(
  file: TestingExternalTextFile,
  startOffsetBytes: number,
  maxBytes: number | undefined,
  expectedIdentity: string | undefined,
): string {
  assertNonNegativeSafeInteger(startOffsetBytes, 'startOffsetBytes')
  if (maxBytes !== undefined) assertNonNegativeSafeInteger(maxBytes, 'maxBytes')
  const identity = testingExternalFileIdentity(file)
  if (expectedIdentity !== undefined && expectedIdentity !== identity) {
    throw new Error(`External file identity changed: expected ${expectedIdentity}, received ${identity}`)
  }
  const bytes = UTF8_ENCODER.encode(file.content)
  const endOffsetBytes = maxBytes === undefined
    ? bytes.byteLength
    : Math.min(bytes.byteLength, startOffsetBytes + maxBytes)
  return UTF8_DECODER.decode(bytes.slice(startOffsetBytes, endOffsetBytes))
}


function* splitExternalTextFile(content: string, maxBytes: number): Generator<string> {
  let chunk = ''
  let chunkBytes = 0
  for (const character of content) {
    const characterBytes = UTF8_ENCODER.encode(character).byteLength
    if (chunkBytes + characterBytes > maxBytes && chunk.length > 0) {
      yield chunk
      chunk = ''
      chunkBytes = 0
    }
    chunk += character
    chunkBytes += characterBytes
  }
  if (chunk.length > 0) yield chunk
}

function isTestingImageReferenceDefinition(line: string): boolean {
  const separator = line.indexOf(':')
  if (separator < 0) return false
  const marker = line.slice(0, separator)
  const value = line.slice(separator + 1)
  const imageNumber = marker.startsWith('[image#') && marker.endsWith(']')
    ? marker.slice('[image#'.length, -1)
    : null
  return imageNumber !== null
    && imageNumber.length > 0
    && /^\d+$/u.test(imageNumber)
    && value.trimStart().startsWith('data:image/')
    && value.includes(';base64,')
}

function testingTaskPromptPreview(task: Task): string {
  const lines = task.initial_prompt
    .split(/\r?\n/u)
    .filter(line => !isTestingImageReferenceDefinition(line))
  while (lines.at(-1)?.trim() === '') lines.pop()
  return [...lines.join('\n')].slice(0, 120).join('')
}

function testingTaskTitle(task: Task, preview: string): string {
  const explicitTitle = task.title?.trim()
  if (explicitTitle) return explicitTitle
  const fallback = preview.split(/\r?\n/u).map(line => line.trim()).find(Boolean) || task.id
  return [...fallback].slice(0, 120).join('')
}

function taskReference(task: Task): TaskReference {
  const preview = testingTaskPromptPreview(task)
  if (!task.project_id) throw new Error(`Task ${task.id} must belong to a project`)
  return {
    id: task.id,
    status: task.status,
    projectId: task.project_id,
    title: testingTaskTitle(task, preview),
    dependsOn: [...task.depends_on],
  }
}

function taskSummary(task: Task, labels: TaskLabel[] = []): TaskSummary {
  return {
    ...taskReference(task),
    createdAt: task.created_at,
    updatedAt: task.updated_at,
    promptPreview: testingTaskPromptPreview(task),
    labels: [...labels],
    sourceTicketUrl: task.source_ticket_url,
  }
}

function taskDetail(task: Task, labels: TaskLabel[] = []): TaskDetail {
  return {
    ...taskSummary(task, labels),
    prompt: task.initial_prompt,
    agent: task.agent,
    permissionMode: task.permission_mode,
    worktreeSource: task.worktree_source,
    worktreeBranch: task.worktree_branch,
    titleSource: task.title_source,
    titleGeneratedAt: task.title_generated_at,
  }
}

interface TestingCompletedTaskScope {
  projectId: string
  search: string
  labels: string[]
}

interface TestingCompletedTaskCursor {
  version: 1
  scope: TestingCompletedTaskScope
  updatedAt: number
  id: string
}

function asciiLowercase(value: string): string {
  return value.replace(/[A-Z]/gu, character => character.toLowerCase())
}

function compareCompletedTasks(left: Task, right: Task): number {
  if (left.updated_at !== right.updated_at) return right.updated_at - left.updated_at
  if (left.id === right.id) return 0
  return left.id > right.id ? -1 : 1
}

function testingCompletedTaskScope(
  projectId: string,
  query: CompletedTaskQuery,
 ): TestingCompletedTaskScope {
  return {
    projectId,
    search: asciiLowercase(query.search?.trim() ?? ''),
    labels: [...new Set((query.labels ?? [])
      .map(name => name.trim().toLowerCase())
      .filter(Boolean))].sort(),
  }
}

function encodeTestingCompletedTaskCursor(cursor: TestingCompletedTaskCursor): string {
  return `testing:${encodeURIComponent(JSON.stringify(cursor))}`
}

function decodeTestingCompletedTaskCursor(
  encoded: string,
  scope: TestingCompletedTaskScope,
 ): TestingCompletedTaskCursor {
  try {
    if (!encoded.startsWith('testing:')) throw new Error('wrong cursor format')
    const cursor = JSON.parse(decodeURIComponent(encoded.slice('testing:'.length))) as TestingCompletedTaskCursor
    if (cursor.version !== 1
      || !Number.isSafeInteger(cursor.updatedAt)
      || typeof cursor.id !== 'string'
      || JSON.stringify(cursor.scope) !== JSON.stringify(scope)) {
      throw new Error('invalid cursor payload')
    }
    return cursor
  } catch {
    throw new Error('Invalid Task cursor')
  }
}

function listTestingCompletedTasks(
  allTasks: Task[],
  projectId: string,
  query: CompletedTaskQuery = {},
  labelsByTaskId: ReadonlyMap<string, TaskLabel[]> = new Map(),
): CompletedTaskPage {
  if (!projectId.trim()) throw new RangeError('projectId is required')
  const submittedLabels = query.labels ?? []
  if (submittedLabels.length > 20) {
    throw new RangeError('Completed Task reads support at most 20 Task Label filters')
  }
  if (submittedLabels.some(name => [...name.trim()].length > 40)) {
    throw new RangeError('Completed Task Label filters must be 40 characters or fewer')
  }
  if ([...(query.search?.trim() ?? '')].length > 200) {
    throw new RangeError('Completed Task search must be 200 characters or fewer')
  }
  const scope = testingCompletedTaskScope(projectId, query)
  const labels = new Set(scope.labels)
  const cursor = query.cursor ? decodeTestingCompletedTaskCursor(query.cursor, scope) : null
  const matching = allTasks
    .filter(task => task.status === 'done' && task.project_id === projectId)
    .filter(task => {
      const summary = taskSummary(task, labelsByTaskId.get(task.id))
      return !scope.search || [summary.id, summary.title, summary.promptPreview]
        .some(value => asciiLowercase(value).includes(scope.search))
    })
    .filter(task => {
      if (labels.size === 0) return true
      const names = taskSummary(task, labelsByTaskId.get(task.id))
        .labels.map(label => label.name.toLowerCase())
      return [...labels].every(label => names.includes(label))
    })
    .sort(compareCompletedTasks)
  const remaining = cursor
    ? matching.filter(task => task.updated_at < cursor.updatedAt
      || (task.updated_at === cursor.updatedAt && task.id < cursor.id))
    : matching
  const pageTasks = remaining.slice(0, 50)
  const tasks = pageTasks.map(task => taskSummary(task, labelsByTaskId.get(task.id)))
  const last = pageTasks.at(-1)
  const nextCursor = remaining.length > 50 && last
    ? encodeTestingCompletedTaskCursor({
        version: 1,
        scope,
        updatedAt: last.updated_at,
        id: last.id,
      })
    : null
  return { tasks, nextCursor }
}



type StoredReviewThread = Omit<ReviewThread, 'hasUnreadAgentMessage'>

function cloneReviewThread(thread: StoredReviewThread, seenCount: number): ReviewThread {
  return {
    ...thread,
    hasUnreadAgentMessage: thread.messages.slice(seenCount).some(message => message.role === 'agent'),
    anchor: { ...thread.anchor },
    messages: thread.messages.map(message => ({ ...message })),
  }
}

const REVIEW_THREAD_ORIGINS = new Set(['agent', 'human', 'plugin'])
const REVIEW_THREAD_ROLES = new Set(['agent', 'human'])
const REVIEW_THREAD_STATUSES = new Set(['open', 'resolved', 'dismissed'])
const REVIEW_THREAD_AWAITING = new Set(['none', 'agent', 'error'])

function reviewThreadScope(thread: StoredReviewThread): ReviewThreadScope {
  return { namespace: thread.namespace, targetKey: thread.targetKey, revision: thread.revision }
}

function reviewThreadScopeKey(scope: ReviewThreadScope): string {
  return JSON.stringify([scope.namespace, scope.targetKey, scope.revision])
}

function assertReviewThreadField(condition: boolean, field: string, reason: string): void {
  if (!condition) throw new TypeError(`Review Thread field '${field}' ${reason}`)
}

function assertReviewThreadScope(scope: ReviewThreadScope): void {
  assertReviewThreadField(scope?.namespace?.trim().length > 0, 'namespace', 'must not be empty')
  assertReviewThreadField(scope?.targetKey?.trim().length > 0, 'targetKey', 'must not be empty')
  assertReviewThreadField(scope?.revision?.trim().length > 0, 'revision', 'must not be empty')
}

function assertReviewThreadAnchor(anchor: ReviewThreadAnchor): void {
  if (anchor?.kind === 'custom') {
    assertReviewThreadField(anchor.key?.trim().length > 0, 'anchor.key', 'must not be empty')
    return
  }
  assertReviewThreadField(anchor?.kind === 'line', 'anchor.kind', 'must be line or custom')
  assertReviewThreadField(anchor.filePath?.trim().length > 0, 'filePath', 'must not be empty')
  assertReviewThreadField(Number.isSafeInteger(anchor.line) && anchor.line >= 1, 'line', 'must be at least 1')
  assertReviewThreadField(anchor.side === 'LEFT' || anchor.side === 'RIGHT', 'side', 'must be LEFT or RIGHT')
}

export type TestingCommonApi = Omit<OpenForgeCommonAPI, 'tasks' | 'reviewThreads'>
  & Pick<FrontendOpenForgeAPI, 'tasks' | 'reviewThreads' | 'navigation'>

export class TestingCommonApiFake {
  private readonly commands = new Map<string, TestingCommandContribution>()
  private readonly eventListeners = new Map<string, TestingEventListenerContribution>()
  private readonly eventHandlers = new Map<string, Set<TestingEventHandler>>()
  private readonly taskChangeHandlers = new Map<string, Set<(event: TaskChangeEvent) => void>>()
  private readonly reviewThreads: StoredReviewThread[] = []
  private readonly reviewThreadSeenCounts = new Map<string, number>()
  private readonly reviewThreadChangeHandlers = new Map<string, Set<(event: ReviewThreadChangeEvent) => void>>()
  private readonly scopedAgentSessions = new Map<string, TestingScopedAgentSession>()
  private readonly scopedAgentSessionChangeHandlers = new Map<string, Set<(event: ScopedAgentSessionChangeEvent) => void>>()
  private reviewThreadSequence = 0
  private scopedAgentSessionSequence = 0
  private scopedAgentTurnSequence = 0
  private scopedAgentSessionClock = 0
  private scopedAgentSessionAuthenticationAvailable = true
  private readonly scopedAgentSessionAttachmentGenerations = new Map<string, number>()
  private eventListenerSequence = 0

  constructor(private readonly services: TestingRegistryServices) {}

  setScopedAgentSessionAuthenticationAvailable(available: boolean): void {
    this.scopedAgentSessionAuthenticationAvailable = available
  }

  emitTaskChange(event: TaskChangeEvent): void {
    for (const handler of this.taskChangeHandlers.get(event.projectId) ?? []) {
      handler(event)
    }
  }

  emitReviewThreadChange(event: ReviewThreadChangeEvent): void {
    for (const handler of this.reviewThreadChangeHandlers.get(reviewThreadScopeKey(event)) ?? []) {
      handler({ namespace: event.namespace, targetKey: event.targetKey, revision: event.revision })
    }
  }

  completeScopedAgentSession(scope: SessionScope, succeeded = true): void {
    const previousQueuePositions = this.scopedQueuePositions()
    const session = this.requireScopedAgentSession(scope)
    session.status = succeeded ? 'completed' : 'failed'
    session.acceptsInput = true
    session.errorCode = succeeded ? null : 'PROVIDER_EXITED'
    session.errorMessage = succeeded ? null : 'Provider process exited unsuccessfully'
    session.updatedAt = this.nextScopedAgentSessionTime()
    this.promoteQueuedScopedAgentSession()
    this.emitScopedAgentSessionChange(scope)
    this.emitChangedScopedQueuePositions(previousQueuePositions)
  }

  pauseScopedAgentSession(scope: SessionScope): void {
    const session = this.requireScopedAgentSession(scope)
    if (session.status !== 'running' || session.turnId === null) {
      throw new ScopedAgentSessionError('NOT_READY', 'Scoped Agent Session has no active turn')
    }
    session.status = 'paused'
    session.acceptsInput = true
    session.updatedAt = this.nextScopedAgentSessionTime()
    this.emitScopedAgentSessionChange(scope)
  }

  mountScopedAgentTerminal(scope: SessionScope, element: HTMLElement): Disposable {
    assertSessionScope(scope)
    this.requireScopedAgentSession(scope)
    if (!(element instanceof HTMLElement)) {
      throw new TypeError('Scoped Agent Session terminal mount requires an HTMLElement')
    }
    const key = sessionScopeKey(scope)
    const generation = (this.scopedAgentSessionAttachmentGenerations.get(key) ?? 0) + 1
    this.scopedAgentSessionAttachmentGenerations.set(key, generation)
    this.services.calls.scopedAgentSessionTerminalMounts.push({ scope: { ...scope }, element })
    return createDisposable(() => {
      if (this.scopedAgentSessionAttachmentGenerations.get(key) !== generation) return
      this.scopedAgentSessionAttachmentGenerations.delete(key)
      this.services.calls.scopedAgentSessionTerminalDetaches.push({ ...scope })
    })
  }
  createApi(runtime: AgentCommandRuntime = 'frontend'): TestingCommonApi {
    const api: TestingCommonApi = {
      commands: {
        register: (registration) => this.registerCommand(registration, runtime),
        invoke: async <TOutput = unknown>(id: string, payload?: unknown) => this.invokeCommand<TOutput>(id, payload),
        invokeGlobal: async <TOutput = unknown>(qualifiedId: string, payload?: unknown) => this.invokeGlobalCommand<TOutput>(qualifiedId, payload),
        list: async () => Array.from(this.commands.values()).map(commandDescriptor),
        listCatalog: async () => [],
        listInstalledProviders: async () => [...this.services.installedProviders],
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
      agentSessions: {
        list: async (request) => {
          if (typeof request.provider !== 'string' || request.provider.trim().length === 0) {
            throw new TypeError('provider must be a non-empty string')
          }
          if (request.taskId !== undefined && (typeof request.taskId !== 'string' || request.taskId.trim().length === 0)) {
            throw new TypeError('taskId must be a non-empty string')
          }
          if (request.cursor !== undefined && (typeof request.cursor !== 'string' || request.cursor.length === 0)) {
            throw new TypeError('cursor must be a non-empty string')
          }
          if (!request.overlaps || typeof request.overlaps !== 'object') {
            throw new TypeError('overlaps must contain startInclusive and endExclusive')
          }
          assertNonNegativeSafeInteger(request.overlaps.startInclusive, 'overlaps.startInclusive')
          assertNonNegativeSafeInteger(request.overlaps.endExclusive, 'overlaps.endExclusive')
          if (request.overlaps.startInclusive >= request.overlaps.endExclusive) {
            throw new RangeError('overlaps must satisfy startInclusive < endExclusive')
          }
          if (!Number.isSafeInteger(request.pageSize)
            || request.pageSize < 1
            || request.pageSize > MAX_AGENT_SESSION_PAGE_SIZE) {
            throw new RangeError(`pageSize must be between 1 and ${MAX_AGENT_SESSION_PAGE_SIZE}`)
          }

          const filters = {
            provider: request.provider,
            startInclusive: request.overlaps.startInclusive,
            endExclusive: request.overlaps.endExclusive,
            taskId: request.taskId ?? null,
          }
          const cursor = request.cursor === undefined ? null : parseAgentSessionCursor(request.cursor)
          if (cursor !== null
            && (cursor.filters.provider !== filters.provider
              || cursor.filters.startInclusive !== filters.startInclusive
              || cursor.filters.endExclusive !== filters.endExclusive
              || cursor.filters.taskId !== filters.taskId)) {
            throw new TypeError('cursor does not match request filters')
          }

          this.services.calls.agentSessionListRequests.push({
            ...request,
            overlaps: { ...request.overlaps },
          })
          const taskById = new Map(this.services.seededTasks.map((task) => [task.id, task]))
          const rows = this.services.seededAgentSessions
            .filter((session) => taskById.has(session.ticket_id))
            .filter((session) => session.provider === request.provider)
            .filter((session) => request.taskId === undefined || session.ticket_id === request.taskId)
            .filter((session) => session.created_at < request.overlaps.endExclusive
              && (!TERMINAL_AGENT_SESSION_STATUSES.has(session.status)
                || session.updated_at > request.overlaps.startInclusive))
            .filter((session) => cursor === null
              || session.created_at > cursor.createdAt
              || (session.created_at === cursor.createdAt && session.id > cursor.id))
            .slice()
            .sort((left, right) => left.created_at - right.created_at
              || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
          const pageRows = rows.slice(0, request.pageSize)
          const items = pageRows.map((session) => {
            const task = taskById.get(session.ticket_id)
            if (!task) throw new Error(`Missing seeded Task for Agent Session ${session.id}`)
            const workspace = this.services.agentSessionWorkspaces[task.id]
            return {
              id: session.id,
              provider: session.provider,
              providerSessionId: providerSessionId(session),
              createdAt: session.created_at,
              updatedAt: session.updated_at,
              task: {
                id: task.id,
                title: task.title?.trim() || task.id,
                status: task.status,
                createdAt: task.created_at,
                updatedAt: task.updated_at,
              },
              workspace: workspace
                ? { rootPath: workspace.rootPath, kind: workspace.kind }
                : null,
            }
          })
          const last = pageRows.at(-1)
          return {
            items,
            nextCursor: rows.length > request.pageSize && last
              ? encodeAgentSessionCursor({
                  version: 1,
                  createdAt: last.created_at,
                  id: last.id,
                  filters,
                })
              : null,
          }
        },
        start: async (request) => {
          assertSessionScope(request.scope)
          assertScopedInput(request.initialInput)
          if (typeof request.projectId !== 'string' || request.projectId.length === 0) {
            throw new ScopedAgentSessionError('PROJECT_NOT_FOUND', 'Scoped Agent Session requires a Project')
          }
          if (request.toolPolicy !== 'review-read-only') {
            throw new ScopedAgentSessionError('UNSUPPORTED_TOOL_POLICY', `Unsupported Session Tool Policy: ${request.toolPolicy}`)
          }
          if (!this.scopedAgentSessionAuthenticationAvailable) {
            throw new ScopedAgentSessionError(
              'AUTHENTICATION_UNAVAILABLE',
              'Provider authentication is unavailable; authenticate the normal provider first',
            )
          }
          const key = sessionScopeKey(request.scope)
          this.services.calls.scopedAgentSessionStarts.push({ ...request, scope: { ...request.scope } })
          const previousQueuePositions = this.scopedQueuePositions()
          const previousRevisions = [...this.scopedAgentSessions.values()].filter(session =>
            session.scope.namespace === request.scope.namespace
            && session.scope.targetKey === request.scope.targetKey
            && session.scope.revision !== request.scope.revision)
          for (const previous of previousRevisions) {
            this.assertScopedAgentSessionOwner(previous)
            const freedSlot = ['starting', 'running', 'paused'].includes(previous.status)
            this.scopedAgentSessions.delete(sessionScopeKey(previous.scope))
            if (freedSlot) this.promoteQueuedScopedAgentSession()
            this.emitScopedAgentSessionChange(previous.scope)
          }
          this.emitChangedScopedQueuePositions(previousQueuePositions)
          const existing = this.scopedAgentSessions.get(key)
          if (existing && ['queued', 'starting', 'running', 'paused'].includes(existing.status)) {
            throw new ScopedAgentSessionError(
              'DUPLICATE_SCOPE',
              `Session Scope already has live Scoped Agent Session ${existing.id}`,
            )
          }
          if (existing) {
            throw new ScopedAgentSessionError('DUPLICATE_SCOPE', 'Release the existing Scoped Agent Session before starting another')
          }

          const executionCount = this.scopedExecutionCount()
          const queuedCount = this.scopedQueuedSessions().length
          if (executionCount >= SCOPED_EXECUTION_LIMIT && queuedCount >= SCOPED_QUEUE_LIMIT) {
            throw new ScopedAgentSessionError('CAPACITY', 'Scoped Agent Session queue is full')
          }
          const queued = executionCount >= SCOPED_EXECUTION_LIMIT
          const createdAt = this.nextScopedAgentSessionTime()
          const session: TestingScopedAgentSession = {
            id: `sas-${++this.scopedAgentSessionSequence}`,
            turnId: null,
            scope: { ...request.scope },
            ownerPluginId: this.services.pluginId,
            status: queued ? 'queued' : 'running',
            queueSequence: queued ? this.scopedAgentSessionSequence : null,
            queuePosition: null,
            queueReason: queued ? 'Waiting for an available scoped Agent Session slot' : null,
            acceptsInput: !queued,
            workspaceAvailable: !queued,
            errorCode: null,
            errorMessage: null,
            createdAt,
            updatedAt: createdAt,
          }
          this.scopedAgentSessions.set(key, session)
          this.emitScopedAgentSessionChange(request.scope)
          return this.scopedAgentSessionState(session)
        },
        status: async (scope) => {
          assertSessionScope(scope)
          this.services.calls.scopedAgentSessionStatuses.push({ ...scope })
          const session = this.scopedAgentSessions.get(sessionScopeKey(scope))
          if (!session) return null
          this.assertScopedAgentSessionOwner(session)
          return this.scopedAgentSessionState(session)
        },
        input: async (scope, input) => {
          assertSessionScope(scope)
          assertScopedInput(input)
          this.services.calls.scopedAgentSessionInputs.push({ scope: { ...scope }, input })
          const session = this.requireScopedAgentSession(scope)
          if (['completed', 'failed', 'aborted', 'interrupted'].includes(session.status)) {
            if (!this.scopedAgentSessionAuthenticationAvailable) {
              throw new ScopedAgentSessionError(
                'AUTHENTICATION_UNAVAILABLE',
                'Provider authentication is unavailable; authenticate the normal provider first',
              )
            }
            const queued = this.scopedExecutionCount() >= SCOPED_EXECUTION_LIMIT
            if (queued && this.scopedQueuedSessions().length >= SCOPED_QUEUE_LIMIT) {
              throw new ScopedAgentSessionError('CAPACITY', 'Scoped Agent Session queue is full')
            }
            session.status = queued ? 'queued' : 'running'
            session.queueSequence = queued ? ++this.scopedAgentSessionSequence : null
            session.queueReason = queued ? 'Waiting for an available scoped Agent Session slot' : null
            session.workspaceAvailable = !queued
            session.errorCode = null
            session.errorMessage = null
            session.turnId = null
          } else if (session.status !== 'running' && session.status !== 'paused') {
            throw new ScopedAgentSessionError('NOT_READY', `Scoped Agent Session is not ready for input in status ${session.status}`)
          }
          if (session.status !== 'queued') {
            session.status = 'running'
            session.turnId = scopedTurnIdFromInput(input) ?? this.nextScopedAgentTurnId()
          }
          session.acceptsInput = session.status !== 'queued'
          session.updatedAt = this.nextScopedAgentSessionTime()
          this.emitScopedAgentSessionChange(scope)
          return this.scopedAgentSessionState(session)
        },
        abort: async (scope) => {
          assertSessionScope(scope)
          this.services.calls.scopedAgentSessionAborts.push({ ...scope })
          const session = this.requireScopedAgentSession(scope)
          const previousQueuePositions = this.scopedQueuePositions()
          const freedSlot = ['starting', 'running', 'paused'].includes(session.status)
          session.status = 'aborted'
          session.queueSequence = null
          session.queueReason = null
          session.acceptsInput = true
          session.updatedAt = this.nextScopedAgentSessionTime()
          if (freedSlot) this.promoteQueuedScopedAgentSession()
          this.emitScopedAgentSessionChange(scope)
          this.emitChangedScopedQueuePositions(previousQueuePositions)
          return this.scopedAgentSessionState(session)
        },
        release: async (scope) => {
          assertSessionScope(scope)
          this.services.calls.scopedAgentSessionReleases.push({ ...scope })
          const session = this.requireScopedAgentSession(scope)
          const previousQueuePositions = this.scopedQueuePositions()
          const freedSlot = ['starting', 'running', 'paused'].includes(session.status)
          this.scopedAgentSessions.delete(sessionScopeKey(scope))
          if (freedSlot) this.promoteQueuedScopedAgentSession()
          this.emitScopedAgentSessionChange(scope)
          this.emitChangedScopedQueuePositions(previousQueuePositions)
        },
        onDidChange: (scope, handler) => {
          assertSessionScope(scope)
          assertFunction('events', 'handler', handler)
          const key = sessionScopeKey(scope)
          const handlers = this.scopedAgentSessionChangeHandlers.get(key) ?? new Set()
          handlers.add(handler)
          this.scopedAgentSessionChangeHandlers.set(key, handlers)
          return createDisposable(() => {
            handlers.delete(handler)
            if (handlers.size === 0) this.scopedAgentSessionChangeHandlers.delete(key)
          })
        },
      },
      reviewThreads: {
        onDidChange: (scope, handler) => {
          assertReviewThreadScope(scope)
          const key = reviewThreadScopeKey(scope)
          const handlers = this.reviewThreadChangeHandlers.get(key) ?? new Set<(event: ReviewThreadChangeEvent) => void>()
          handlers.add(handler)
          this.reviewThreadChangeHandlers.set(key, handlers)
          return createDisposable(() => {
            handlers.delete(handler)
            if (handlers.size === 0) this.reviewThreadChangeHandlers.delete(key)
          })
        },
        list: async (scope) => {
          assertReviewThreadScope(scope)
          const key = reviewThreadScopeKey(scope)
          return this.reviewThreads
            .filter(thread => reviewThreadScopeKey(thread) === key)
            .map(thread => this.cloneReviewThread(thread))
        },
        create: async (request) => this.createReviewThread(request),
        reply: async (request) => this.replyToReviewThread(request),
        setStatus: async (request) => this.setReviewThreadStatus(request),
        setAwaiting: async (request) => this.setReviewThreadAwaiting(request),
        markSeen: async (request) => this.markReviewThreadSeen(request),
      },
      tasks: {
        onDidChange: (projectId, handler) => {
          const handlers = this.taskChangeHandlers.get(projectId) ?? new Set<(event: TaskChangeEvent) => void>()
          handlers.add(handler)
          this.taskChangeHandlers.set(projectId, handlers)
          return createDisposable(() => {
            handlers.delete(handler)
            if (handlers.size === 0) this.taskChangeHandlers.delete(projectId)
          })
        },
        list: async (request) => {
          const projectId = request?.projectId ?? null
          const includeDone = request?.includeDone ?? false
          this.services.calls.taskListRequests.push({ projectId, includeDone })
          return this.services.seededTasks.filter((task) => {
            if (projectId !== null && task.project_id !== projectId) return false
            if (projectId !== null && !includeDone && task.status === 'done') return false
            return true
          })
        },
        get: async (taskId) => this.services.seededTasks.find(task => task.id === taskId) ?? null,
        active: async (projectId): Promise<ActiveTasks> => {
          this.services.calls.taskActiveRequests.push({ projectId })
          const activeTasks = this.services.seededTasks.filter(task =>
            task.project_id === projectId && task.status !== 'done')
          const activeIds = new Set(activeTasks.map(task => task.id))
          const relatedIds = new Set<string>()
          for (const task of this.services.seededTasks) {
            if (activeIds.has(task.id)) {
              for (const dependencyId of task.depends_on) relatedIds.add(dependencyId)
            } else if (task.depends_on.some(dependencyId => activeIds.has(dependencyId))) {
              relatedIds.add(task.id)
            }
          }
          return {
            tasks: activeTasks.map(task => taskDetail(
              task,
              this.services.seededTaskLabelAssignments.get(task.id),
            )),
            related: this.services.seededTasks
              .filter(task => relatedIds.has(task.id) && !activeIds.has(task.id))
              .map(taskReference),
          }
        },
        completed: async (projectId, query = {}) => {
          this.services.calls.taskCompletedRequests.push({ projectId, ...query })
          return listTestingCompletedTasks(
            this.services.seededTasks,
            projectId,
            query,
            this.services.seededTaskLabelAssignments,
          )
        },
        detail: async (projectId, taskId): Promise<TaskRead | null> => {
          this.services.calls.taskDetailRequests.push({ projectId, taskId })
          const task = this.services.seededTasks.find(candidate =>
            candidate.id === taskId && candidate.project_id === projectId)
          if (!task) return null
          const relatedIds = new Set(task.depends_on)
          for (const candidate of this.services.seededTasks) {
            if (candidate.depends_on.includes(taskId)) relatedIds.add(candidate.id)
          }
          return {
            task: taskDetail(task, this.services.seededTaskLabelAssignments.get(task.id)),
            related: this.services.seededTasks
              .filter(candidate => relatedIds.has(candidate.id))
              .map(taskReference),
          }
        },
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
            agent: null,
            permission_mode: null,
            worktree_source: null,
            worktree_branch: null,
            source_ticket_url: null,
            depends_on: request.dependsOn ?? [],
            project_id: request.projectId,
            created_at: 0,
            updated_at: 0,
          }
        },
        // The fake stands in for the host dialog: it records the request and
        // reports a created-but-not-started task, so consumers can assert what
        // they asked for without a UI. Override per test for the other outcomes.
        compose: async (request) => {
          this.services.calls.taskComposes.push(request)
          const task = await api.tasks.create({
            projectId: request.projectId,
            initialPrompt: request.initialPrompt,
          })
          return { task, started: false }
        },
        updateStatus: async (taskId, status) => {
          this.services.calls.taskStatusUpdates.push({ taskId, status })
        },
        listStartPromptContributions: async (projectId) => this.services.startPromptContributions(projectId),
        configureStartPromptContribution: async (request) => {
          this.services.calls.startPromptContributionConfigurations.push(request)
          const contribution = { ...request, ownerPluginId: this.services.pluginId }
          const existing = this.services.startPromptContributions(request.projectId)
            .filter((entry) => entry.id !== request.id
              || (entry.ownerPluginId !== undefined && entry.ownerPluginId !== contribution.ownerPluginId))
          const next = [...existing, contribution].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)
            || a.id.localeCompare(b.id)
            || (a.ownerPluginId ?? '').localeCompare(b.ownerPluginId ?? ''))
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
        listSessions: async (request) => {
          this.services.calls.taskSessionListRequests.push({ ...request })
          return this.services.seededAgentSessions
            .map((session, index) => ({ session, index }))
            .filter(({ session }) => session.ticket_id === request.taskId)
            .filter(({ session }) => request.provider === undefined || session.provider === request.provider)
            .filter(({ session }) => request.createdAtOrAfter === undefined || session.created_at >= request.createdAtOrAfter)
            .sort((left, right) => right.session.created_at - left.session.created_at || right.index - left.index)
            .map(({ session }) => session)
        },
      },
      projects: {
        list: async () => [],
        get: async () => null,
      },
      fs: {
        readDir: async () => [],
        readFile: async ({ path }) => this.services.projectFileContents[path]
          ?? { type: 'text', content: '', mimeType: null, size: 0 },
        readDocument: async ({ projectId, path }) => {
          const document = this.services.projectDocuments[projectId]?.[path]
          if (!document) throw new Error('DOCUMENT_PREVIEW_NOT_FOUND: document fixture unavailable')
          return document
        },
        writeFile: async (request) => {
          this.services.calls.fsWrites.push(request)
        },
        searchFiles: async () => [],
        task: {
          readDir: async ({ taskId, path }) => {
            const directoryPath = path ?? ''
            const entries = testingTaskWorkspace(this.services.taskWorkspaces, taskId).directories?.[directoryPath]
            if (!entries) throw new Error(`Task workspace directory not found: ${taskId}:${directoryPath}`)
            return entries
          },
          readFile: async ({ taskId, path }) => {
            const file = testingTaskWorkspace(this.services.taskWorkspaces, taskId).files?.[path]
            if (!file) throw new Error(`Task workspace file not found: ${taskId}:${path}`)
            return file
          },
          readDocument: async ({ taskId, path }) => {
            const workspace = this.services.taskWorkspaces[taskId]
            if (workspace?.error) throw new Error(workspace.error)
            const document = workspace?.documents?.[path]
            if (!document) throw new Error('DOCUMENT_PREVIEW_NOT_FOUND: task document fixture unavailable')
            return document
          },
          searchFiles: async ({ taskId, query }) =>
            testingTaskWorkspace(this.services.taskWorkspaces, taskId).searches?.[query] ?? [],
        },
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
          return { buffer: null, isLive: false, instanceId: null }
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
        writeClipboardText: async (text) => {
          this.services.calls.clipboardWrites.push(text)
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

  private nextScopedAgentSessionTime(): number {
    this.scopedAgentSessionClock += 1
    return this.scopedAgentSessionClock
  }

  private nextScopedAgentTurnId(): string {
    this.scopedAgentTurnSequence += 1
    return `turn-${this.scopedAgentTurnSequence}`
  }

  private scopedExecutionCount(): number {
    return [...this.scopedAgentSessions.values()]
      .filter(session => ['starting', 'running', 'paused'].includes(session.status)).length
  }

  private scopedQueuedSessions(): TestingScopedAgentSession[] {
    return [...this.scopedAgentSessions.values()]
      .filter(session => session.status === 'queued')
      .sort((left, right) => (left.queueSequence ?? 0) - (right.queueSequence ?? 0))
  }

  private scopedQueuePositions(): Map<string, number> {
    return new Map(this.scopedQueuedSessions().map((session, index) => [sessionScopeKey(session.scope), index + 1]))
  }

  private emitChangedScopedQueuePositions(previous: Map<string, number>): void {
    for (const [key, position] of this.scopedQueuePositions()) {
      if (!previous.has(key) || previous.get(key) === position) continue
      const session = this.scopedAgentSessions.get(key)
      if (session) this.emitScopedAgentSessionChange(session.scope)
    }
  }

  private scopedAgentSessionState(session: TestingScopedAgentSession): ScopedAgentSessionState {
    const queuePosition = session.status === 'queued'
      ? this.scopedQueuedSessions().findIndex(candidate => candidate.id === session.id) + 1
      : null
    return {
      id: session.id,
      turnId: session.turnId,
      status: session.status,
      queuePosition,
      queueReason: session.queueReason,
      acceptsInput: session.acceptsInput,
      workspaceAvailable: session.workspaceAvailable,
      errorCode: session.errorCode,
      errorMessage: session.errorMessage,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
    }
  }

  private assertScopedAgentSessionOwner(session: TestingScopedAgentSession): void {
    if (session.ownerPluginId !== this.services.pluginId) {
      throw new ScopedAgentSessionError('FORBIDDEN', 'Scoped Agent Session belongs to another plugin')
    }
  }

  private requireScopedAgentSession(scope: SessionScope): TestingScopedAgentSession {
    const session = this.scopedAgentSessions.get(sessionScopeKey(scope))
    if (!session) throw new ScopedAgentSessionError('NOT_FOUND', 'Scoped Agent Session not found')
    this.assertScopedAgentSessionOwner(session)
    return session
  }

  private emitScopedAgentSessionChange(scope: SessionScope): void {
    const session = this.scopedAgentSessions.get(sessionScopeKey(scope))
    const event = {
      ...scope,
      state: session ? this.scopedAgentSessionState(session) : null,
    }
    for (const handler of this.scopedAgentSessionChangeHandlers.get(sessionScopeKey(scope)) ?? []) {
      handler(event)
    }
  }

  private promoteQueuedScopedAgentSession(): void {
    if (this.scopedExecutionCount() >= SCOPED_EXECUTION_LIMIT) return
    const session = this.scopedQueuedSessions()[0]
    if (!session) return
    session.status = 'running'
    session.queueSequence = null
    session.queueReason = null
    session.acceptsInput = true
    session.workspaceAvailable = true
    session.turnId = this.nextScopedAgentTurnId()
    session.updatedAt = this.nextScopedAgentSessionTime()
    this.emitScopedAgentSessionChange(session.scope)
  }

  createBackendApi(): TestingCommonApi & Pick<BackendOpenForgeAPI, 'fs'> {
    const api = this.createApi('backend')
    return {
      ...api,
      fs: {
        ...api.fs,
        userData: {
          readDir: async (request = {}) => {
            this.services.calls.fsUserDataReadDirs.push(request)
            return readTestingUserDataDir(this.services.userDataTextFiles, request.path)
          },
          readTextFile: async (request) => {
            this.services.calls.fsUserDataReads.push(request)
            return this.services.userDataTextFiles.get(request.path) ?? ''
          },
          writeTextFile: async (request) => {
            this.services.calls.fsUserDataWrites.push(request)
            this.services.userDataTextFiles.set(request.path, request.content)
          },
          appendTextFile: async (request) => {
            this.services.calls.fsUserDataAppends.push(request)
            const content = `${this.services.userDataTextFiles.get(request.path) ?? ''}${request.content}`
            this.services.userDataTextFiles.set(request.path, content)
            return { sizeBytes: UTF8_ENCODER.encode(content).byteLength }
          },
        },
        external: {
          readDir: async (request) => {
            this.services.calls.fsExternalReadDirs.push(request)
            return []
          },
          readTextFile: async (request) => {
            this.services.calls.fsExternalReads.push(request)
            return ''
          },
          stat: async (request) => {
            this.services.calls.fsExternalStats.push(request)
            const file = this.services.externalTextFiles.find(
              candidate => candidate.root === request.root && candidate.path === request.path,
            )
            if (!file) throw new Error(`External file not found: ${request.root}/${request.path}`)
            return {
              identity: testingExternalFileIdentity(file),
              sizeBytes: UTF8_ENCODER.encode(file.content).byteLength,
              modifiedAtMs: file.modifiedAtMs ?? null,
            }
          },
          readTextFileChunks: (request) => {
            const chunkSizeBytes = resolveExternalTextFileChunkSize(request.chunkSizeBytes)
            const {
              root,
              path,
              signal,
              expectedIdentity,
              startOffsetBytes = 0,
              maxBytes,
            } = request
            this.services.calls.fsExternalReadTextFileChunks.push({
              root,
              path,
              chunkSizeBytes,
              ...(expectedIdentity === undefined ? {} : { expectedIdentity }),
              ...(request.startOffsetBytes === undefined ? {} : { startOffsetBytes }),
              ...(maxBytes === undefined ? {} : { maxBytes }),
            })
            const file = this.services.externalTextFiles.find(
              candidate => candidate.root === root && candidate.path === path,
            )
            return (async function* () {
              signal?.throwIfAborted()
              if (!file) throw new Error(`External file not found: ${root}/${path}`)
              const content = readTestingExternalTextRange(
                file,
                startOffsetBytes,
                maxBytes,
                expectedIdentity,
              )
              for (const chunk of splitExternalTextFile(content, chunkSizeBytes)) {
                signal?.throwIfAborted()
                if (expectedIdentity !== undefined && testingExternalFileIdentity(file) !== expectedIdentity) {
                  throw new Error(
                    `External file identity changed: expected ${expectedIdentity}, received ${testingExternalFileIdentity(file)}`,
                  )
                }
                yield chunk
              }
              signal?.throwIfAborted()
            })()
          },
        },
      },
    }
  }

  getSnapshot(): {
    commands: TestingCommandContribution[]
    agentCommands: AgentCommandDescriptor[]
    eventListeners: TestingEventListenerContribution[]
  } {
    return {
      commands: Array.from(this.commands.values()),
      agentCommands: Array.from(this.commands.values()).flatMap(command => command.agent
        ? [{
            qualifiedId: command.qualifiedId,
            pluginId: command.pluginId,
            runtime: command.runtime,
            description: command.agent.description,
            examples: command.agent.examples ?? [],
            discoverable: command.agent.discoverable ?? true,
            input: command.input,
            output: command.output,
          }]
        : []),
      eventListeners: Array.from(this.eventListeners.values()),
    }
  }

  async invokeAgentCommand<TOutput>(
    qualifiedId: string,
    payload: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<TOutput> {
    const command = this.commands.get(qualifiedId)
    if (!command?.agent) throw new Error(`Unknown agent-facing Plugin Command: ${qualifiedId}`)
    return await command.handler(payload, context) as TOutput
  }

  private createReviewThread(request: CreateReviewThreadRequest): ReviewThread {
    assertReviewThreadScope(request)
    assertReviewThreadAnchor(request.anchor)
    assertReviewThreadField(request.body?.trim().length > 0, 'body', 'must not be empty')
    const idempotencyKey = request.idempotencyKey ?? null
    if (idempotencyKey !== null) {
      assertReviewThreadField(idempotencyKey.trim().length > 0, 'idempotencyKey', 'must not be empty')
    }
    assertReviewThreadField(REVIEW_THREAD_ORIGINS.has(request.origin), 'origin', 'must be agent, human, or plugin')

    const stored = idempotencyKey === null
      ? undefined
      : this.reviewThreads.find(candidate =>
        candidate.idempotencyKey === idempotencyKey
        && candidate.namespace === request.namespace
        && candidate.targetKey === request.targetKey
        && candidate.revision === request.revision)
    if (stored) return this.cloneReviewThread(stored)

    this.reviewThreadSequence += 1
    const createdAt = this.reviewThreadSequence
    const thread: StoredReviewThread = {
      id: `rt_${this.reviewThreadSequence}`,
      namespace: request.namespace,
      targetKey: request.targetKey,
      revision: request.revision,
      runId: request.runId ?? null,
      origin: request.origin,
      anchor: { ...request.anchor },
      status: 'open',
      awaiting: 'none',
      idempotencyKey,
      seenAt: null,
      createdAt,
      updatedAt: createdAt,
      messages: [{
        id: `rtm_${this.reviewThreadSequence}_1`,
        role: request.origin === 'agent' ? 'agent' : 'human',
        body: request.body,
        createdAt,
      }],
    }
    this.reviewThreads.push(thread)
    return this.publishReviewThread(thread)
  }

  private replyToReviewThread(request: ReplyToReviewThreadRequest): ReviewThread {
    assertReviewThreadField(request.body?.trim().length > 0, 'body', 'must not be empty')
    assertReviewThreadField(REVIEW_THREAD_ROLES.has(request.role), 'role', 'must be agent or human')
    if (request.awaiting !== undefined) {
      assertReviewThreadField(REVIEW_THREAD_AWAITING.has(request.awaiting), 'awaiting', 'must be none, agent, or error')
    }
    const thread = this.requireReviewThread(request.threadId)

    this.reviewThreadSequence += 1
    thread.messages.push({
      id: `rtm_${thread.id}_${thread.messages.length + 1}`,
      role: request.role,
      body: request.body,
      createdAt: this.reviewThreadSequence,
    })
    if (request.awaiting !== undefined) thread.awaiting = request.awaiting
    thread.updatedAt = this.reviewThreadSequence
    return this.publishReviewThread(thread)
  }

  private setReviewThreadStatus(request: SetReviewThreadStatusRequest): ReviewThread {
    assertReviewThreadField(REVIEW_THREAD_STATUSES.has(request.status), 'status', 'must be open, resolved, or dismissed')
    const thread = this.requireReviewThread(request.threadId)

    thread.status = request.status
    this.reviewThreadSequence += 1
    thread.updatedAt = this.reviewThreadSequence
    return this.publishReviewThread(thread)
  }

  private setReviewThreadAwaiting(request: SetReviewThreadAwaitingRequest): ReviewThread {
    assertReviewThreadField(REVIEW_THREAD_AWAITING.has(request.awaiting), 'awaiting', 'must be none, agent, or error')
    const thread = this.requireReviewThread(request.threadId)

    thread.awaiting = request.awaiting
    this.reviewThreadSequence += 1
    thread.updatedAt = this.reviewThreadSequence
    return this.publishReviewThread(thread)
  }

  private markReviewThreadSeen(request: MarkReviewThreadSeenRequest): ReviewThread {
    const thread = this.requireReviewThread(request.threadId)

    this.reviewThreadSeenCounts.set(thread.id, thread.messages.length)
    this.reviewThreadSequence += 1
    thread.seenAt = this.reviewThreadSequence
    return this.publishReviewThread(thread)
  }

  private requireReviewThread(threadId: string): StoredReviewThread {
    const thread = this.reviewThreads.find(candidate => candidate.id === threadId)
    if (!thread) throw new Error(`Review Thread '${threadId}' does not exist`)
    return thread
  }

  private publishReviewThread(thread: StoredReviewThread): ReviewThread {
    this.emitReviewThreadChange(reviewThreadScope(thread))
    return this.cloneReviewThread(thread)
  }

  private cloneReviewThread(thread: StoredReviewThread): ReviewThread {
    return cloneReviewThread(thread, this.reviewThreadSeenCounts.get(thread.id) ?? 0)
  }

  private registerCommand(registration: CommandRegistration, runtime: AgentCommandRuntime): Disposable {
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
      runtime,
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
    return await command.handler(payload, {
      taskId: null,
      projectId: command.projectId,
      source: 'plugin',
    }) as TOutput
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
