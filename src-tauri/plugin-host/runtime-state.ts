import type { OpenForgePackageMetadata, PluginStorage, SubscriptionSink } from '@openforge-app/plugin-sdk'
import type { Disposable } from '@openforge-app/plugin-sdk/backend'
import { logPluginHostError, toError } from './console-attribution'
import type { RuntimePluginState } from './runtime-types'

export function createDisposable(dispose: () => void | Promise<void>): Disposable {
  let disposed = false
  return {
    async dispose() {
      if (disposed) return
      disposed = true
      await dispose()
    },
  }
}

export class RuntimeSubscriptionSink implements SubscriptionSink {
  readonly subscriptions: Disposable[] = []

  constructor(private readonly pluginId: string) {}

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
    for (const subscription of subscriptions) {
      try {
        await subscription.dispose()
      } catch (error) {
        logPluginHostError(this.pluginId, `subscription dispose error: ${toError(error).message}`)
      }
    }
  }
}

export function createDefaultPackageMetadata(pluginId: string): OpenForgePackageMetadata {
  return {
    id: pluginId,
    apiVersion: 1,
    displayName: pluginId,
    description: '',
  }
}

export function createInitialPluginState(pluginId: string, storage: PluginStorage): RuntimePluginState {
  return {
    pluginId,
    backendPath: null,
    projectId: null,
    packageMetadata: createDefaultPackageMetadata(pluginId),
    state: 'missing',
    error: null,
    activationPromise: null,
    deactivationPromise: null,
    activationGeneration: 0,
    activationCount: 0,
    reloadCount: 0,
    importGeneration: 0,
    module: null,
    methods: new Map(),
    commands: new Map(),
    eventHandlers: new Map(),
    contextChangeHandlers: new Set(),
    backgroundServices: new Map(),
    storage,
    subscriptions: new RuntimeSubscriptionSink(pluginId),
    crashTimestamps: [],
    crashLoopGuardTripped: false,
  }
}
