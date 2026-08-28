import type {
  AgentCommandMetadata,
  CommandDescriptor,
  Disposable,
  JsonValue,
  OpenForgeContextSnapshot,
  OpenForgeNavigationRequest,
  OpenForgeNavigationSnapshot,
  OpenForgePackageMetadata,
  PluginStorage,
  PluginStorageScope,
  StartPromptContribution,
  SubscriptionSink,
} from '../types'
import type { AgentSession, Task } from '../domain'
import type {
  TestingCommandContribution,
  TestingMaybePromise,
  TestingExternalTextFile,
  TestingOpenForgeApiCalls,
  TestingOpenForgeApiOptions,
  TestingRuntimeKind,
  TestingRuntimeScope,
} from './contracts'

export function createDisposable(dispose: () => TestingMaybePromise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

export class TestingSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  add(subscription: Disposable | (() => void)): void {
    if (typeof subscription === 'function') {
      this.subscriptions.push(createDisposable(subscription))
      return
    }
    if (!subscription || typeof subscription.dispose !== 'function') {
      throw new Error('context.subscriptions.add requires a disposable or cleanup function')
    }
    this.subscriptions.push(subscription)
  }

  async disposeAll(): Promise<void> {
    const subscriptions = this.subscriptions.splice(0).reverse()
    for (const subscription of subscriptions) await subscription.dispose()
  }
}

export function createTestingCalls(): TestingOpenForgeApiCalls {
  return {
    commandInvocations: [],
    globalCommandInvocations: [],
    backendInvocations: [],
    emittedEvents: [],
    emittedGlobalEvents: [],
    openUrl: [],
    clipboardWrites: [],
    navigationRequests: [],
    notify: [],
    taskCreations: [],
    taskComposes: [],
    startPromptContributionConfigurations: [],
    taskImplementationStarts: [],
    taskFollowUps: [],
    taskListRequests: [],
    taskSessionListRequests: [],
    taskStatusUpdates: [],
    configWrites: [],
    fsWrites: [],
    fsUserDataReadDirs: [],
    fsUserDataReads: [],
    fsUserDataWrites: [],
    fsUserDataAppends: [],
    fsExternalReadDirs: [],
    fsExternalReads: [],
    fsExternalStats: [],
    fsExternalReadTextFileChunks: [],
    shellSpawns: [],
    shellWrites: [],
    shellResizes: [],
    shellKills: [],
    shellBuffers: [],
    browserSurfaceGetOrCreate: [],
    browserSurfaceAttachments: [],
    browserSurfaceDetaches: [],
    browserSurfaceDestroys: [],
    browserSurfaceNavigations: [],
    browserSurfaceControls: [],
    browserSurfaceSelections: [],
    browserSurfaceFeedbackClears: [],
    browserSurfaceFeedbackReplacements: [],
    browserSurfaceCaptureChecks: [],
    browserSurfaceCaptures: [],
    browserSurfaceCaptureDiscards: [],
    browserSurfaceSessionResets: [],
    storageGets: [],
    storageSets: [],
    storageDeletes: [],
  }
}

export function createMemoryPluginStorage(calls: TestingOpenForgeApiCalls = createTestingCalls()): PluginStorage {
  const values = new Map<string, JsonValue>()

  function scope(scopeKind: TestingRuntimeScope, scopeId: string | null): PluginStorageScope {
    const prefix = `${scopeKind}:${scopeId ?? ''}:`
    return {
      async get<T extends JsonValue = JsonValue>(key: string): Promise<T | null> {
        calls.storageGets.push({ scope: scopeKind, scopeId, key })
        return values.has(`${prefix}${key}`) ? values.get(`${prefix}${key}`) as T : null
      },
      async set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void> {
        values.set(`${prefix}${key}`, value)
        calls.storageSets.push({ scope: scopeKind, scopeId, key, value })
      },
      async delete(key: string): Promise<void> {
        values.delete(`${prefix}${key}`)
        calls.storageDeletes.push({ scope: scopeKind, scopeId, key })
      },
    }
  }

  return {
    global: scope('global', null),
    project: (projectId: string) => scope('project', projectId),
    task: (taskId: string) => scope('task', taskId),
  }
}

export function commandDescriptor(command: TestingCommandContribution): CommandDescriptor {
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

export function normalizeAgentCommandMetadata(metadata: unknown): AgentCommandMetadata | undefined {
  if (metadata === undefined) return undefined
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('commands registration agent metadata must be an object')
  }
  const candidate = metadata as Partial<AgentCommandMetadata>
  if (typeof candidate.description !== 'string' || candidate.description.trim().length === 0) {
    throw new Error('commands registration agent metadata requires a non-empty description')
  }
  if (candidate.examples !== undefined && (!Array.isArray(candidate.examples) || !candidate.examples.every(example => isJsonValue(example)))) {
    throw new Error('commands registration agent metadata examples must contain only JSON values')
  }
  if (candidate.discoverable !== undefined && typeof candidate.discoverable !== 'boolean') {
    throw new Error('commands registration agent metadata discoverable must be a boolean')
  }
  return {
    description: candidate.description.trim(),
    examples: candidate.examples ? [...candidate.examples] : [],
    discoverable: candidate.discoverable ?? true,
  }
}

export function isJsonValue(value: unknown, seen = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'object') return false
  if (seen.has(value)) return false
  seen.add(value)
  const valid = Array.isArray(value)
    ? value.every(entry => isJsonValue(entry, seen))
    : Object.values(value).every(entry => isJsonValue(entry, seen))
  seen.delete(value)
  return valid
}

export function assertLocalId(kind: TestingRuntimeKind, id: string): void {
  if (typeof id !== 'string' || id.trim().length === 0) {
    throw new Error(`${kind} registration requires a non-empty id`)
  }
  const trimmed = id.trim()
  if (trimmed.startsWith('openforge.')) {
    throw new Error(`${kind} registration cannot use openforge.* reserved namespace`)
  }
  if (trimmed.includes(':') || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    throw new Error(`${kind} registration has invalid id "${trimmed}"`)
  }
}

export function assertTitle(kind: TestingRuntimeKind, title: string): void {
  if (typeof title !== 'string' || title.trim().length === 0) {
    throw new Error(`${kind} registration requires a non-empty title`)
  }
}

export function assertFunction(kind: TestingRuntimeKind, field: string, value: unknown): void {
  if (typeof value !== 'function') {
    throw new Error(`${kind} registration requires a ${field} function`)
  }
}

export class TestingContributionClaims {
  private readonly ids = new Set<string>()

  claim(kind: TestingRuntimeKind, qualifiedId: string): void {
    const key = this.key(kind, qualifiedId)
    if (this.ids.has(key)) {
      throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`)
    }
    this.ids.add(key)
  }

  release(kind: TestingRuntimeKind, qualifiedId: string): void {
    this.ids.delete(this.key(kind, qualifiedId))
  }

  private key(kind: TestingRuntimeKind, qualifiedId: string): string {
    return kind === 'commands' ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`
  }
}

export class TestingRegistryServices {
  readonly pluginId: string
  readonly projectId: string | null
  readonly taskId: string | null
  readonly viewId: string
  readonly packageMetadata: OpenForgePackageMetadata
  readonly calls: TestingOpenForgeApiCalls
  readonly storage: PluginStorage
  readonly config = new Map<string, JsonValue>()
  readonly seededTasks: Task[]
  readonly seededAgentSessions: AgentSession[]
  readonly externalTextFiles: TestingExternalTextFile[]
  readonly userDataTextFiles = new Map<string, string>()
  readonly claims = new TestingContributionClaims()

  constructor(options: TestingOpenForgeApiOptions = {}) {
    this.pluginId = options.pluginId ?? 'test-plugin'
    this.projectId = options.projectId ?? null
    this.taskId = options.taskId ?? null
    this.viewId = options.viewId ?? 'board'
    this.packageMetadata = options.packageMetadata ?? {
      id: this.pluginId,
      apiVersion: 1,
      displayName: this.pluginId,
      description: '',
    }
    this.calls = createTestingCalls()
    this.storage = options.storage ?? createMemoryPluginStorage(this.calls)
    this.seededTasks = options.tasks ?? []
    this.seededAgentSessions = options.agentSessions ?? []
    this.externalTextFiles = options.externalTextFiles ?? []
    for (const file of options.userDataTextFiles ?? []) {
      this.userDataTextFiles.set(file.path, file.content)
    }
  }

  localQualifiedId(kind: TestingRuntimeKind, id: string): string {
    assertLocalId(kind, id)
    return `${this.pluginId}.${id.trim()}`
  }

  getContextSnapshot(): OpenForgeContextSnapshot {
    return {
      pluginId: this.pluginId,
      projectId: this.projectId,
      ...(this.taskId === null ? {} : { taskId: this.taskId }),
    }
  }

  getNavigationSnapshot(overrides: OpenForgeNavigationRequest = {}): OpenForgeNavigationSnapshot {
    return {
      activeProjectId: overrides.projectId ?? this.projectId,
      currentView: overrides.viewId ?? this.viewId,
      selectedTaskId: overrides.taskId ?? this.taskId,
    }
  }

  startPromptContributions(projectId: string): StartPromptContribution[] {
    const raw = this.config.get(`project:${projectId}:start_prompt_contributions`) as unknown
    return Array.isArray(raw)
      ? raw.filter((entry): entry is StartPromptContribution => Boolean(entry)
        && typeof entry === 'object'
        && typeof (entry as { id?: unknown }).id === 'string'
        && typeof (entry as { content?: unknown }).content === 'string')
      : []
  }
}
