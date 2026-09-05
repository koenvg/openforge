import { sanitizePluginIcon } from '@openforge-app/plugin-sdk/pluginIcons'
import type { Disposable, PluginStorage, SubscriptionSink } from '@openforge-app/plugin-sdk'
import type {
  MaybePromise,
  RuntimeHandler,
  RuntimeHostBridge,
  RuntimeKind,
  RuntimeOptions,
  RuntimeScope,
} from './runtimeContributionTypes'

export class RuntimeValidationError extends Error {
  constructor(kind: RuntimeKind, message: string) {
    super(`${kind} registration ${message}`)
    this.name = 'RuntimeValidationError'
  }
}

async function disposeSubscriptions(subscriptions: Disposable[]): Promise<void> {
  let firstError: unknown
  let hasError = false
  for (const subscription of subscriptions) {
    try {
      await subscription.dispose()
    } catch (error) {
      if (!hasError) {
        firstError = error
        hasError = true
      }
    }
  }
  if (hasError) throw firstError
}

export class RuntimeSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  get size(): number {
    return this.subscriptions.length
  }

  add(subscription: Disposable | (() => void)): void {
    if (typeof subscription === 'function') {
      this.subscriptions.push({ dispose: subscription })
      return
    }
    if (!subscription || typeof subscription.dispose !== 'function') {
      throw new Error('context.subscriptions.add requires a disposable or cleanup function')
    }
    this.subscriptions.push(subscription)
  }

  async disposeFrom(index: number): Promise<void> {
    await disposeSubscriptions(this.subscriptions.splice(index).reverse())
  }

  async disposeAll(): Promise<void> {
    await disposeSubscriptions(this.subscriptions.splice(0).reverse())
  }
}

export function qualifyLocalContributionId(pluginId: string, localId: string): string {
  return `${pluginId}.${localId}`
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function'
}

export function assertLocalId(kind: RuntimeKind, id: unknown): asserts id is string {
  if (!isNonEmptyString(id)) {
    throw new RuntimeValidationError(kind, 'requires a non-empty id')
  }
  const trimmed = id.trim()
  if (trimmed.startsWith('openforge.')) {
    throw new RuntimeValidationError(kind, 'cannot use openforge.* reserved namespace')
  }
  if (trimmed.includes(':') || trimmed.startsWith('.') || trimmed.endsWith('.') || trimmed.includes('..')) {
    throw new RuntimeValidationError(kind, `has invalid id "${trimmed}"`)
  }
}

export function assertTitle(kind: RuntimeKind, title: unknown): asserts title is string {
  if (!isNonEmptyString(title)) {
    throw new RuntimeValidationError(kind, 'requires a non-empty title')
  }
}

export function assertHandler(kind: RuntimeKind, handler: unknown): asserts handler is RuntimeHandler {
  if (!isFunction(handler)) {
    throw new RuntimeValidationError(kind, 'requires a handler function')
  }
}

export function assertComponent(kind: RuntimeKind, component: unknown): void {
  if (!isFunction(component)) {
    throw new RuntimeValidationError(kind, 'requires a component')
  }
}

export function sanitizeViewIcon(icon: unknown, kind: RuntimeKind = 'views') {
  try {
    return sanitizePluginIcon(icon)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new RuntimeValidationError(kind, `has invalid icon: ${message}`)
  }
}

export function assertScope(scope: unknown): asserts scope is RuntimeScope {
  if (scope !== 'global' && scope !== 'project' && scope !== 'task') {
    throw new RuntimeValidationError('background', 'requires scope to be global, project, or task')
  }
}

export function createDisposable(dispose: () => MaybePromise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

function createMemoryStorageScope() {
  const values = new Map<string, unknown>()
  return {
    async get<T>(key: string): Promise<T | null> {
      return values.has(key) ? values.get(key) as T : null
    },
    async set<T>(key: string, value: T): Promise<void> {
      values.set(key, value)
    },
    async delete(key: string): Promise<void> {
      values.delete(key)
    },
  }
}

export function createMemoryStorage(): PluginStorage {
  const global = createMemoryStorageScope()
  const projects = new Map<string, ReturnType<typeof createMemoryStorageScope>>()
  const tasks = new Map<string, ReturnType<typeof createMemoryStorageScope>>()
  return {
    global,
    project(projectId: string) {
      let scope = projects.get(projectId)
      if (!scope) {
        scope = createMemoryStorageScope()
        projects.set(projectId, scope)
      }
      return scope
    },
    task(taskId: string) {
      let scope = tasks.get(taskId)
      if (!scope) {
        scope = createMemoryStorageScope()
        tasks.set(taskId, scope)
      }
      return scope
    },
  }
}

export class RuntimeContributionClaims {
  private readonly keys = new Set<string>()

  claim(kind: RuntimeKind, qualifiedId: string): void {
    const key = this.key(kind, qualifiedId)
    if (this.keys.has(key)) {
      throw new Error(`Duplicate runtime contribution id: ${qualifiedId}`)
    }
    this.keys.add(key)
  }

  release(kind: RuntimeKind, qualifiedId: string): void {
    this.keys.delete(this.key(kind, qualifiedId))
  }

  has(kind: RuntimeKind, qualifiedId: string): boolean {
    return this.keys.has(this.key(kind, qualifiedId))
  }

  private key(kind: RuntimeKind, qualifiedId: string): string {
    return kind === 'commands' ? `commands:${qualifiedId}` : `${kind}:${qualifiedId}`
  }
}

type RuntimeRegistryServicesOptions = RuntimeOptions & {
  claims?: RuntimeContributionClaims
  trackDisposable?: <TDisposable extends Disposable>(disposable: TDisposable) => TDisposable
}

export class RuntimeRegistryServices {
  readonly pluginId: string
  projectId: string | null
  readonly packageMetadata: RuntimeOptions['packageMetadata']
  readonly host: RuntimeHostBridge
  readonly storage: PluginStorage
  readonly claims: RuntimeContributionClaims
  private readonly disposableTracker: <TDisposable extends Disposable>(disposable: TDisposable) => TDisposable

  constructor(options: RuntimeRegistryServicesOptions) {
    assertLocalId('backend', options.pluginId)
    this.pluginId = options.pluginId
    this.projectId = options.projectId
    this.packageMetadata = options.packageMetadata
    this.host = options.host ?? {}
    this.storage = options.storage ?? createMemoryStorage()
    this.claims = options.claims ?? new RuntimeContributionClaims()
    this.disposableTracker = options.trackDisposable ?? ((disposable) => disposable)
  }

  updateProjectId(projectId: string | null): void {
    this.projectId = projectId
  }

  qualifiedId(kind: RuntimeKind, localId: string): string {
    assertLocalId(kind, localId)
    return qualifyLocalContributionId(this.pluginId, localId.trim())
  }

  trackDisposable<TDisposable extends Disposable>(disposable: TDisposable): TDisposable {
    return this.disposableTracker(disposable)
  }
}
