import type { TaskBrowserSurfaceState } from '../browserSurfaces.js'
import type {
  BackendPlugin,
  BackendPluginContext,
  FrontendPlugin,
  FrontendPluginContext,
  OpenForgePackageMetadata,
  TaskChangeEvent,
  PluginStorage,
} from '../types.js'
import { TestingBackendServicesFake } from './backendServicesFake.js'
import { TestingCommonApiFake } from './commonApiFake.js'
import type {
  MockBackendOpenForgeAPI,
  MockFrontendOpenForgeAPI,
  TestingOpenForgeApiCalls,
  TestingOpenForgeApiOptions,
  TestingOpenForgeRegistrySnapshot,
} from './contracts.js'
import { TestingFrontendContributionFake } from './frontendContributionFake.js'
import {
  TestingRegistryServices,
  TestingSubscriptionSink,
} from './support.js'

export class TestingOpenForgeRegistryFake {
  readonly pluginId: string
  readonly projectId: string | null
  readonly taskId: string | null
  readonly viewId: string
  readonly packageMetadata: OpenForgePackageMetadata
  readonly calls: TestingOpenForgeApiCalls
  readonly storage: PluginStorage
  readonly frontendSubscriptions = new TestingSubscriptionSink()
  readonly backendSubscriptions = new TestingSubscriptionSink()

  private readonly services: TestingRegistryServices
  private readonly commonApi: TestingCommonApiFake
  private readonly frontendContributions: TestingFrontendContributionFake
  private readonly backendServices: TestingBackendServicesFake
  private cachedFrontendApi: MockFrontendOpenForgeAPI | null = null
  private cachedBackendApi: MockBackendOpenForgeAPI | null = null

  constructor(options: TestingOpenForgeApiOptions = {}) {
    this.services = new TestingRegistryServices(options)
    this.pluginId = this.services.pluginId
    this.projectId = this.services.projectId
    this.taskId = this.services.taskId
    this.viewId = this.services.viewId
    this.packageMetadata = this.services.packageMetadata
    this.calls = this.services.calls
    this.storage = this.services.storage
    this.commonApi = new TestingCommonApiFake(this.services)
    this.backendServices = new TestingBackendServicesFake(this.services)
    this.frontendContributions = new TestingFrontendContributionFake(
      this.services,
      (method, payload) => this.backendServices.invokeMethod(method, payload),
    )
  }

  get frontendApi(): MockFrontendOpenForgeAPI {
    return this.createFrontendApi()
  }

  get backendApi(): MockBackendOpenForgeAPI {
    return this.createBackendApi()
  }

  get snapshot(): TestingOpenForgeRegistrySnapshot {
    return this.getSnapshot()
  }

  createFrontendApi(): MockFrontendOpenForgeAPI {
    if (this.cachedFrontendApi) return this.cachedFrontendApi

    const api = {
      ...this.commonApi.createApi(),
      ...this.frontendContributions.createApi(),
      __testing: {
        calls: this.calls,
        registry: this,
      },
    } satisfies MockFrontendOpenForgeAPI

    this.cachedFrontendApi = api
    return api
  }

  createBackendApi(): MockBackendOpenForgeAPI {
    if (this.cachedBackendApi) return this.cachedBackendApi

    const api = {
      ...this.commonApi.createBackendApi(),
      ...this.backendServices.createApi(),
      __testing: {
        calls: this.calls,
        registry: this,
      },
    } satisfies MockBackendOpenForgeAPI

    this.cachedBackendApi = api
    return api
  }

  createFrontendContext(): FrontendPluginContext {
    return this.createContext(this.frontendSubscriptions)
  }

  createBackendContext(): BackendPluginContext {
    return this.createContext(this.backendSubscriptions)
  }

  async activateFrontend(plugin: FrontendPlugin): Promise<void> {
    await plugin.activate(this.frontendApi, this.createFrontendContext())
  }

  async activateBackend(plugin: BackendPlugin): Promise<void> {
    const existingServices = this.backendServices.captureBackgroundServiceIds()
    await plugin.activate(this.backendApi, this.createBackendContext())
    await this.backendServices.startNewBackgroundServices(existingServices)
  }

  emitTaskChange(event: TaskChangeEvent): void {
    this.commonApi.emitTaskChange(event)
  }

  setBrowserSurfaceState(taskId: string, id: string, patch: Partial<TaskBrowserSurfaceState>): void {
    this.frontendContributions.setBrowserSurfaceState(taskId, id, patch)
  }

  async disposeAll(): Promise<void> {
    await this.backendSubscriptions.disposeAll()
    await this.frontendSubscriptions.disposeAll()
  }

  getSnapshot(): TestingOpenForgeRegistrySnapshot {
    return {
      pluginId: this.pluginId,
      projectId: this.projectId,
      ...this.frontendContributions.getSnapshot(),
      ...this.commonApi.getSnapshot(),
      ...this.backendServices.getSnapshot(),
    }
  }

  private createContext(subscriptions: TestingSubscriptionSink): FrontendPluginContext {
    return {
      pluginId: this.pluginId,
      apiVersion: 1,
      packageMetadata: this.packageMetadata,
      subscriptions,
      onDidChange: () => ({ dispose: () => undefined }),
    }
  }
}

export function createOpenForgeRegistryFake(options: TestingOpenForgeApiOptions = {}): TestingOpenForgeRegistryFake {
  return new TestingOpenForgeRegistryFake(options)
}

export function createMockOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockFrontendOpenForgeAPI {
  return createMockFrontendOpenForgeApi(options)
}

export function createMockFrontendOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockFrontendOpenForgeAPI {
  return createOpenForgeRegistryFake(options).frontendApi
}

export function createMockBackendOpenForgeApi(options: TestingOpenForgeApiOptions = {}): MockBackendOpenForgeAPI {
  return createOpenForgeRegistryFake(options).backendApi
}

export function createMockPluginContext(options: TestingOpenForgeApiOptions = {}): FrontendPluginContext {
  return createOpenForgeRegistryFake(options).createFrontendContext()
}
