import type {
  FrontendOpenForgeAPI,
  FrontendPlugin,
  FrontendPluginContext,
} from '@openforge-app/plugin-sdk/frontend'
import type {
  BackendOpenForgeAPI,
  BackendPlugin,
  BackendPluginContext,
} from '@openforge-app/plugin-sdk/backend'
import type {
  AgentCommandDescriptor,
  Disposable,
  InjectionPointLocation,
  OpenForgeContextSnapshot,
  OpenForgePackageMetadata,
  PluginCommandInvocationContext,
} from '@openforge-app/plugin-sdk'
import { RuntimeBackendServices } from './runtimeBackendServices'
import { RuntimeCommonApiRegistry } from './runtimeCommonApi'
import {
  RuntimeRegistryServices,
  RuntimeSubscriptionSink,
  qualifyLocalContributionId,
} from './runtimeContributionSupport'
import { RuntimeFrontendContributionRegistry, type LiveFrontendContributions } from './runtimeFrontendContributions'
import type {
  RuntimeContributionSnapshot,
  RuntimeInjectionPointContribution,
  RuntimeViewReplacementContribution,
  RuntimeOptions,
  RuntimeTaskStartPrefixProviderContribution,
} from './runtimeContributionTypes'

export type {
  RuntimeBackendMethodContribution,
  RuntimeBackgroundServiceContribution,
  RuntimeCommandContribution,
  RuntimeContributionSnapshot,
  RuntimeEventListenerContribution,
  RuntimeHostBridge,
  RuntimeInjectionPointContribution,
  RuntimeReviewRowActionContribution,
  RuntimeSettingsSectionContribution,
  RuntimeThemeContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeTaskStartPrefixProviderContribution,
  RuntimeTaskUISectionContribution,
  RuntimeViewContribution,
  RuntimeViewReplacementContribution,
} from './runtimeContributionTypes'
export { qualifyLocalContributionId }

type ActivationTransaction = {
  disposables: Disposable[]
}

export function createRuntimeContributionRegistry(options: RuntimeOptions) {
  return new RuntimeContributionRegistry(options)
}

export type RuntimeContributionRegistryInstance = ReturnType<typeof createRuntimeContributionRegistry>

class RuntimeContributionRegistry {
  private readonly packageMetadata: OpenForgePackageMetadata
  private readonly contextSnapshot: OpenForgeContextSnapshot
  private readonly services: RuntimeRegistryServices
  private readonly commonApi: RuntimeCommonApiRegistry
  private readonly frontendContributions: RuntimeFrontendContributionRegistry
  private readonly backendServices: RuntimeBackendServices
  private readonly frontendSubscriptions = new RuntimeSubscriptionSink()
  private readonly backendSubscriptions = new RuntimeSubscriptionSink()
  private frontendApi: FrontendOpenForgeAPI | null = null
  private backendApi: BackendOpenForgeAPI | null = null
  private activationTransaction: ActivationTransaction | null = null

  constructor(options: RuntimeOptions) {
    this.services = new RuntimeRegistryServices({
      ...options,
      trackDisposable: (disposable) => this.trackActivationDisposable(disposable),
    })
    this.packageMetadata = options.packageMetadata ?? {
      id: options.pluginId,
      apiVersion: 1,
      displayName: options.pluginId,
      description: '',
    }
    this.contextSnapshot = { pluginId: options.pluginId, projectId: options.projectId }
    this.commonApi = new RuntimeCommonApiRegistry(this.services)
    this.backendServices = new RuntimeBackendServices(this.services)
    this.frontendContributions = new RuntimeFrontendContributionRegistry(
      this.services,
      (method, payload) => this.backendServices.invokeMethod(method, payload),
    )
  }

  async activateFrontend(plugin: FrontendPlugin): Promise<void> {
    await this.runActivationTransaction(this.frontendSubscriptions, async () => {
      await plugin.activate(this.getFrontendApi(), this.createFrontendContext())
    })
  }

  prepareFrontendThemes(): Promise<void> {
    return this.frontendContributions.prepareThemes()
  }

  commitFrontendThemes(generation: number, isGenerationCurrent: () => boolean): boolean {
    return this.frontendContributions.commitThemes(generation, isGenerationCurrent)
  }

  async activateBackend(plugin: BackendPlugin): Promise<void> {
    await this.runActivationTransaction(this.backendSubscriptions, async () => {
      const before = this.backendServices.captureBackgroundServiceIds()
      await plugin.activate(this.getBackendApi(), this.createBackendContext())
      await this.backendServices.startNewBackgroundServices(before)
    })
  }

  async deactivate(): Promise<void> {
    let firstError: unknown
    let hasError = false
    try {
      await this.backendSubscriptions.disposeAll()
    } catch (error) {
      firstError = error
      hasError = true
    }
    try {
      await this.frontendSubscriptions.disposeAll()
    } catch (error) {
      if (!hasError) {
        firstError = error
        hasError = true
      }
    }
    try {
      await this.services.host.destroyPluginBrowserSurfaces?.(this.services.pluginId)
    } catch (error) {
      if (!hasError) {
        firstError = error
        hasError = true
      }
    }
    if (hasError) throw firstError
  }

  observeFrontendContributions(observer: (snapshot: LiveFrontendContributions) => void): void {
    this.frontendSubscriptions.add(this.frontendContributions.observeContributions(observer))
  }

  observeViewReplacements(observer: (replacements: RuntimeViewReplacementContribution[]) => void): void {
    this.frontendSubscriptions.add(this.frontendContributions.observeViewReplacements(observer))
  }

  getSnapshot(): RuntimeContributionSnapshot {
    return {
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      ...this.frontendContributions.getSnapshot(),
      ...this.commonApi.getSnapshot(),
      ...this.backendServices.getSnapshot(),
    }
  }

  listFrontendAgentCommands(): AgentCommandDescriptor[] {
    return this.commonApi.listAgentCommands()
  }

  invokeFrontendAgentCommand(
    qualifiedId: string,
    input: unknown,
    context: PluginCommandInvocationContext,
  ): Promise<unknown> {
    return this.commonApi.invokeAgentCommand(qualifiedId, input, context)
  }
  getFrontendApi(): FrontendOpenForgeAPI {
    if (!this.frontendApi) {
      this.frontendApi = {
        ...this.commonApi.createApi(),
        ...this.frontendContributions.createApi(),
      }
    }
    return this.frontendApi
  }

  getBackendApi(): BackendOpenForgeAPI {
    if (!this.backendApi) {
      this.backendApi = {
        ...this.commonApi.createBackendApi(),
        ...this.backendServices.createApi(),
      }
    }
    return this.backendApi
  }

  listInjectionPoints(location: InjectionPointLocation): RuntimeInjectionPointContribution[] {
    return this.frontendContributions.listInjectionPoints(location)
  }

  listTaskStartPrefixProviders(): RuntimeTaskStartPrefixProviderContribution[] {
    return this.frontendContributions.listTaskStartPrefixProviders()
  }

  getPackageMetadata(): OpenForgePackageMetadata {
    return this.packageMetadata
  }

  getContextSnapshot(): OpenForgeContextSnapshot {
    return { ...this.contextSnapshot }
  }

  async publishContextChange(projectId: string | null): Promise<void> {
    this.services.updateProjectId(projectId)
    this.contextSnapshot.projectId = projectId
    await this.commonApi.publishContextChange(this.getContextSnapshot())
  }

  createRenderContextSnapshot(projectId: string | null, taskId: string | null): OpenForgeContextSnapshot {
    return {
      ...this.contextSnapshot,
      projectId,
      taskId,
    }
  }

  private createFrontendContext(): FrontendPluginContext {
    return {
      pluginId: this.services.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions: this.frontendSubscriptions,
      onDidChange: handler => this.commonApi.subscribeToContextChanges(handler),
    }
  }

  private createBackendContext(): BackendPluginContext {
    return {
      pluginId: this.services.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions: this.backendSubscriptions,
      onDidChange: handler => this.commonApi.subscribeToContextChanges(handler),
    }
  }

  private async runActivationTransaction<T>(
    subscriptionSink: RuntimeSubscriptionSink,
    activate: () => Promise<T>,
  ): Promise<T> {
    const previousTransaction = this.activationTransaction
    const transaction: ActivationTransaction = { disposables: [] }
    const subscriptionCheckpoint = subscriptionSink.size
    this.activationTransaction = transaction

    try {
      const result = await activate()
      this.activationTransaction = previousTransaction
      if (previousTransaction) {
        previousTransaction.disposables.push(...transaction.disposables)
      }
      return result
    } catch (error) {
      this.activationTransaction = previousTransaction
      await this.rollbackActivationTransaction(transaction, subscriptionSink, subscriptionCheckpoint)
      throw error
    }
  }

  private trackActivationDisposable<TDisposable extends Disposable>(disposable: TDisposable): TDisposable {
    this.activationTransaction?.disposables.push(disposable)
    return disposable
  }

  private async rollbackActivationTransaction(
    transaction: ActivationTransaction,
    subscriptionSink: RuntimeSubscriptionSink,
    subscriptionCheckpoint: number,
  ): Promise<void> {
    try {
      await subscriptionSink.disposeFrom(subscriptionCheckpoint)
    } catch {
      // Preserve the activation failure as the reported error; rollback continues below.
    }

    const disposables = transaction.disposables.splice(0).reverse()
    for (const disposable of disposables) {
      try {
        await disposable.dispose()
      } catch {
        // Preserve the activation failure as the reported error while continuing rollback.
      }
    }
  }
}
