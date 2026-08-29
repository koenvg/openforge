import { loadBackendModule } from './backend-module-loader'
import type { PluginStorage } from '@openforge-app/plugin-sdk'
import type { BackendOpenForgeAPI, BackendPlugin, BackendPluginContext } from '@openforge-app/plugin-sdk/backend'
import { logPluginHostError, toError, withPluginConsole } from './console-attribution'
import type { ContributionRegistry } from './contribution-registry'
import { createDefaultPackageMetadata, createDisposable, createInitialPluginState, RuntimeSubscriptionSink } from './runtime-state'
import { createHostStorage, createMemoryStorage } from './storage'
import type {
  ActivateBackendInput,
  BackendStateSnapshot,
  HostCallbackHandler,
  PluginLifecycleDiagnostics,
  ReadyBackendInput,
  RuntimePluginState,
} from './runtime-types'
import { assertLocalId, isNonEmptyString } from './validation'

const DEFAULT_CRASH_LOOP_LIMIT = 3
const DEFAULT_CRASH_LOOP_WINDOW_MS = 60_000
export const MAX_PLUGIN_LIFECYCLE_DIAGNOSTICS = 100

function extractBackendPlugin(module: Record<string, unknown>): BackendPlugin | null {
  const candidate = module.default ?? module
  if (typeof candidate === 'object' && candidate !== null && typeof (candidate as BackendPlugin).activate === 'function') {
    return candidate as BackendPlugin
  }
  return null
}


export type BackendLifecycleOptions = {
  crashLoopLimit?: number
  crashLoopWindowMs?: number
  hostCallbacks: HostCallbackHandler | null
  contributions: ContributionRegistry
  createBackendApi(state: RuntimePluginState): BackendOpenForgeAPI
}

export class BackendLifecycle {
  private readonly plugins = new Map<string, RuntimePluginState>()
  private readonly crashLoopLimit: number
  private readonly crashLoopWindowMs: number

  constructor(private readonly options: BackendLifecycleOptions) {
    this.crashLoopLimit = options.crashLoopLimit ?? DEFAULT_CRASH_LOOP_LIMIT
    this.crashLoopWindowMs = options.crashLoopWindowMs ?? DEFAULT_CRASH_LOOP_WINDOW_MS
  }

  async activate(input: ActivateBackendInput): Promise<BackendStateSnapshot> {
    assertLocalId('backend', input.pluginId)
    if (!isNonEmptyString(input.backendPath)) {
      throw new Error('backend activation requires a backendPath')
    }

    const state = this.getState(input.pluginId)
    if (state.deactivationPromise) {
      await state.deactivationPromise
      return await this.activate(input)
    }
    if (state.activationPromise) {
      await state.activationPromise
      return await this.activate(input)
    }
    this.refreshCrashLoopGuard(state)
    if (state.crashLoopGuardTripped) {
      throw new Error(`Plugin ${input.pluginId} activation blocked by crash-loop guard`)
    }

    if (
      state.state === 'ready'
      && state.backendPath === input.backendPath
      && state.projectId === (input.projectId ?? null)
    ) {
      return this.snapshot(input.pluginId)
    }

    state.activationGeneration += 1
    const activationGeneration = state.activationGeneration
    const activationPromise = this.transitionToActivation(state, input, activationGeneration)
    state.activationPromise = activationPromise
    try {
      await activationPromise
    } finally {
      if (state.activationPromise === activationPromise) {
        state.activationPromise = null
      }
    }
    return this.snapshot(input.pluginId)
  }

  private async transitionToActivation(
    state: RuntimePluginState,
    input: ActivateBackendInput,
    activationGeneration: number,
  ): Promise<void> {
    if (state.state === 'ready' || state.state === 'error') {
      await this.cleanup(state)
    }
    if (!this.isCurrentActivation(state, activationGeneration)) return

    state.backendPath = input.backendPath
    state.projectId = input.projectId ?? null
    state.packageMetadata = input.packageMetadata ?? createDefaultPackageMetadata(input.pluginId)
    state.state = 'starting'
    state.error = null

    await this.activateState(state, activationGeneration)
  }

  async deactivate(pluginId: string): Promise<BackendStateSnapshot> {
    assertLocalId('backend', pluginId)
    const state = this.getState(pluginId)
    if (state.deactivationPromise) {
      await state.deactivationPromise
      return this.snapshot(pluginId)
    }

    const deactivationPromise = this.deactivateState(state)
    state.deactivationPromise = deactivationPromise
    try {
      await deactivationPromise
    } finally {
      if (state.deactivationPromise === deactivationPromise) {
        state.deactivationPromise = null
      }
    }
    return this.snapshot(pluginId)
  }

  private async deactivateState(state: RuntimePluginState): Promise<void> {
    state.activationGeneration += 1
    state.crashTimestamps = []
    state.crashLoopGuardTripped = false
    state.state = 'missing'
    state.error = null
    state.backendPath = null
    state.projectId = null
    await this.cleanup(state)
  }

  async whenReady(input: ReadyBackendInput): Promise<BackendStateSnapshot> {
    assertLocalId('backend', input.pluginId)
    const state = this.getState(input.pluginId)

    if (
      state.state === 'ready'
      && input.preserveActivation === true
      && input.backendPath
      && state.backendPath === input.backendPath
    ) {
      const projectId = input.projectId ?? null
      if (state.projectId !== projectId) {
        state.projectId = projectId
        await this.publishContextChange(state)
      }
      return this.snapshot(input.pluginId)
    }

    if (
      state.state === 'ready'
      && (!input.backendPath || (
        state.backendPath === input.backendPath
        && (input.projectId === undefined || state.projectId === (input.projectId ?? null))
      ))
    ) {
      return this.snapshot(input.pluginId)
    }

    if (state.state === 'ready' && input.backendPath) {
      return await this.activate({
        pluginId: input.pluginId,
        backendPath: input.backendPath,
        projectId: input.projectId,
        packageMetadata: input.packageMetadata,
      })
    }

    if (state.state === 'starting' && state.activationPromise) {
      await state.activationPromise
      return await this.whenReady(input)
    }

    if (input.backendPath) {
      return await this.activate({
        pluginId: input.pluginId,
        backendPath: input.backendPath,
        projectId: input.projectId,
        packageMetadata: input.packageMetadata,
      })
    }

    if (state.state === 'error') {
      throw new Error(state.error?.message ?? `Plugin ${input.pluginId} backend is in error state`)
    }

    throw new Error(`Plugin ${input.pluginId} backend is not ready`)
  }

  private async publishContextChange(state: RuntimePluginState): Promise<void> {
    const snapshot = { pluginId: state.pluginId, projectId: state.projectId }
    let firstError: unknown = null
    for (const handler of Array.from(state.contextChangeHandlers)) {
      try {
        await handler({ ...snapshot })
      } catch (error) {
        firstError ??= error
      }
    }
    if (firstError) throw firstError
  }

  lifecycleDiagnostics(): {
    plugins: PluginLifecycleDiagnostics[]
    pluginCount: number
    pluginsTruncated: boolean
  } {
    const states = Array.from(this.plugins.values()).sort((left, right) =>
      left.pluginId.localeCompare(right.pluginId),
    )
    const plugins = states.slice(0, MAX_PLUGIN_LIFECYCLE_DIAGNOSTICS).map(state => ({
      pluginId: state.pluginId,
      state: state.state,
      active: state.state === 'ready',
      activationCount: state.activationCount,
      reloadCount: state.reloadCount,
    }))

    return {
      plugins,
      pluginCount: states.length,
      pluginsTruncated: states.length > plugins.length,
    }
  }

  snapshot(pluginId: string): BackendStateSnapshot {
    assertLocalId('backend', pluginId)
    const state = this.getState(pluginId)
    this.refreshCrashLoopGuard(state)
    return {
      pluginId,
      state: state.state,
      ready: state.state === 'ready',
      error: state.error?.message ?? null,
      methods: Array.from(state.methods.values()).map(method => method.qualifiedId),
      backgroundServices: Array.from(state.backgroundServices.values()).map(service => service.qualifiedId),
      crashLoopGuardTripped: state.crashLoopGuardTripped,
    }
  }

  getState(pluginId: string): RuntimePluginState {
    let state = this.plugins.get(pluginId)
    if (!state) {
      const storage = this.createStorage(pluginId)
      state = createInitialPluginState(pluginId, storage)
      this.plugins.set(pluginId, state)
    }
    return state
  }

  private createStorage(pluginId: string): PluginStorage {
    return this.options.hostCallbacks
      ? createHostStorage(pluginId, this.options.hostCallbacks)
      : createMemoryStorage()
  }

  private async activateState(state: RuntimePluginState, activationGeneration: number): Promise<void> {
    const activationSubscriptions = state.subscriptions
    try {
      const loadedModule = await loadBackendModule(state.backendPath ?? '')
      state.module = loadedModule.exports
      state.releaseModule = loadedModule.release
      const plugin = extractBackendPlugin(state.module)

      if (!plugin) {
        throw new Error(`Backend entry for ${state.pluginId} does not export a defineBackendPlugin-compatible activate() function`)
      }

      await withPluginConsole(state.pluginId, async () => {
        await plugin.activate(this.options.createBackendApi(state), this.createBackendContext(state))
      })
      if (!this.isCurrentActivation(state, activationGeneration)) {
        await this.cleanupInvalidatedActivation(state, activationSubscriptions)
        return
      }

      await withPluginConsole(state.pluginId, async () => {
        await this.startBackgroundServices(state, activationGeneration)
      })
      if (!this.isCurrentActivation(state, activationGeneration)) {
        await this.cleanupInvalidatedActivation(state, activationSubscriptions)
        return
      }

      if (state.activationCount > 0) state.reloadCount += 1
      state.activationCount += 1
      state.state = 'ready'
      state.error = null
    } catch (error) {
      if (!this.isCurrentActivation(state, activationGeneration)) {
        await this.cleanupInvalidatedActivation(state, activationSubscriptions)
        return
      }

      const pluginError = toError(error)
      state.error = pluginError
      await this.cleanup(state)
      this.recordActivationCrash(state)
      state.state = 'error'
      logPluginHostError(state.pluginId, `activation error: ${pluginError.message}`)
      throw pluginError
    }
  }

  private isCurrentActivation(state: RuntimePluginState, activationGeneration: number): boolean {
    return state.activationGeneration === activationGeneration
  }

  private async cleanupInvalidatedActivation(
    state: RuntimePluginState,
    activationSubscriptions: RuntimePluginState['subscriptions'],
  ): Promise<void> {
    if (state.deactivationPromise) {
      await state.deactivationPromise
    }
    await this.cleanup(state, activationSubscriptions)
  }

  private refreshCrashLoopGuard(state: RuntimePluginState): void {
    const now = Date.now()
    state.crashTimestamps = state.crashTimestamps.filter(timestamp => now - timestamp <= this.crashLoopWindowMs)
    state.crashLoopGuardTripped = state.crashTimestamps.length >= this.crashLoopLimit
  }

  private recordActivationCrash(state: RuntimePluginState): void {
    this.refreshCrashLoopGuard(state)
    state.crashTimestamps.push(Date.now())
    state.crashLoopGuardTripped = state.crashTimestamps.length >= this.crashLoopLimit
  }

  private async cleanup(
    state: RuntimePluginState,
    subscriptions: RuntimePluginState['subscriptions'] = state.subscriptions,
  ): Promise<void> {
    await subscriptions.disposeAll()
    state.contextChangeHandlers.clear()

    const services = Array.from(state.backgroundServices.values()).reverse()
    for (const service of services) {
      if (!service.started) continue
      try {
        await withPluginConsole(state.pluginId, async () => await service.stop?.())
      } catch (error) {
        const pluginError = toError(error)
        logPluginHostError(state.pluginId, `background service stop error in ${service.qualifiedId}: ${pluginError.message}`)
      } finally {
        service.started = false
      }
    }

    this.options.contributions.removeStateContributions(state)
    if (state.subscriptions === subscriptions) {
      state.subscriptions = new RuntimeSubscriptionSink(state.pluginId)
    }
    state.module = null
    const releaseModule = state.releaseModule
    state.releaseModule = null
    releaseModule?.()
  }

  private async startBackgroundServices(state: RuntimePluginState, activationGeneration: number): Promise<void> {
    for (const service of state.backgroundServices.values()) {
      if (service.started) continue
      try {
        await service.start()
        service.started = true
        if (!this.isCurrentActivation(state, activationGeneration)) {
          try {
            await service.stop?.()
          } catch (error) {
            const pluginError = toError(error)
            logPluginHostError(state.pluginId, `background service stop error in ${service.qualifiedId}: ${pluginError.message}`)
          } finally {
            service.started = false
          }
          return
        }
      } catch (error) {
        if (!this.isCurrentActivation(state, activationGeneration)) {
          service.started = false
          return
        }
        const pluginError = toError(error)
        logPluginHostError(state.pluginId, `background service start error in ${service.qualifiedId}: ${pluginError.message}`)
        throw pluginError
      }
    }
  }

  private createBackendContext(state: RuntimePluginState): BackendPluginContext {
    return {
      pluginId: state.pluginId,
      apiVersion: 1,
      packageMetadata: state.packageMetadata,
      subscriptions: state.subscriptions,
      onDidChange: (handler) => {
        if (typeof handler !== 'function') {
          throw new Error('context.onDidChange requires a handler function')
        }
        state.contextChangeHandlers.add(handler)
        return createDisposable(() => {
          state.contextChangeHandlers.delete(handler)
        })
      },
    }
  }
}
