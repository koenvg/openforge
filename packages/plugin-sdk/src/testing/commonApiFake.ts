import { MAX_AGENT_SESSION_PAGE_SIZE, resolveExternalTextFileChunkSize } from '../types.js'
import type { FileEntry } from '../domain.js'
import type {
  BackendOpenForgeAPI,
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
} from './support.js'
import type {
  TestingCommandContribution,
  TestingCommandHandler,
  TestingEventHandler,
  TestingEventListenerContribution,
  TestingExternalTextFile,
} from './contracts'

const UTF8_ENCODER = new TextEncoder()
const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true })

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

  createBackendApi(): TestingCommonApi & Pick<BackendOpenForgeAPI, 'fs'> {
    const api = this.createApi()
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
