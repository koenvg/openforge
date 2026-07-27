import { createTestingBrowserSurfaces } from '../browserSurfacesTesting'
import type { TestingBrowserSurfaces } from '../browserSurfacesTesting'
import type { TaskBrowserSurfaceState } from '../browserSurfaces'
import type {
  Disposable,
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
} from '../types'
import {
  assertFunction,
  assertTitle,
  createDisposable,
  type TestingRegistryServices,
} from './support'
import type {
  TestingInjectionPointContribution,
  TestingSettingsSectionContribution,
  TestingTaskPaneTabContribution,
  TestingTaskUISectionContribution,
  TestingViewContribution,
} from './contracts'

type TestingFrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'views' | 'taskUI' | 'taskPane' | 'settings' | 'backend' | 'injectionPoints'
>

export class TestingFrontendContributionFake {
  private readonly views = new Map<string, TestingViewContribution>()
  private readonly taskPaneTabs = new Map<string, TestingTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, TestingTaskUISectionContribution>()
  private readonly settingsSections = new Map<string, TestingSettingsSectionContribution>()
  private readonly injectionPoints = new Map<string, TestingInjectionPointContribution>()
  private readonly browserSurfaces: TestingBrowserSurfaces
  private api: TestingFrontendContributionApi | null = null

  constructor(
    private readonly services: TestingRegistryServices,
    private readonly invokeBackendMethod: (method: string, payload?: unknown) => Promise<unknown>,
  ) {
    this.browserSurfaces = createTestingBrowserSurfaces(services.calls)
  }

  createApi(): TestingFrontendContributionApi {
    if (this.api) return this.api

    const api: TestingFrontendContributionApi = {
      browserSurfaces: this.browserSurfaces.api,
      views: {
        register: (registration) => this.registerView(registration),
      },
      taskUI: {
        registerTab: (registration) => this.registerTaskPaneTab(registration),
        registerSection: (registration) => this.registerTaskUISection(registration),
      },
      taskPane: {
        registerTab: (registration) => this.registerTaskPaneTab(registration),
      },
      settings: {
        registerSection: (registration) => this.registerSettingsSection(registration),
      },
      backend: {
        state: 'ready' as const,
        whenReady: async () => undefined,
        onReady: (handler) => {
          handler()
          return createDisposable(() => undefined)
        },
        invoke: async <TOutput = unknown>(method: string, payload?: unknown) => this.invokeBackendMethod(method, payload) as Promise<TOutput>,
      },
      injectionPoints: {
        register: (registration) => this.registerInjectionPoint(registration),
      },
    }

    this.api = api
    return api
  }

  setBrowserSurfaceState(taskId: string, id: string, patch: Partial<TaskBrowserSurfaceState>): void {
    this.browserSurfaces.setState(taskId, id, patch)
  }

  getSnapshot(): {
    views: TestingViewContribution[]
    taskPaneTabs: TestingTaskPaneTabContribution[]
    taskUISections: TestingTaskUISectionContribution[]
    settingsSections: TestingSettingsSectionContribution[]
    injectionPoints: TestingInjectionPointContribution[]
  } {
    return {
      views: Array.from(this.views.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      taskUISections: Array.from(this.taskUISections.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      injectionPoints: Array.from(this.injectionPoints.values()),
    }
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('views', registration.id)
    assertTitle('views', registration.title)
    assertFunction('views', 'component', registration.component)
    this.services.claims.claim('views', qualifiedId)

    const contribution: TestingViewContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.views.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.views.delete(qualifiedId)
      this.services.claims.release('views', qualifiedId)
    })
  }

  private registerTaskPaneTab(registration: PluginTaskPaneTabRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('taskPane', registration.id)
    assertTitle('taskPane', registration.title)
    assertFunction('taskPane', 'component', registration.component)
    this.services.claims.claim('taskPane', qualifiedId)

    const contribution: TestingTaskPaneTabContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.taskPaneTabs.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.taskPaneTabs.delete(qualifiedId)
      this.services.claims.release('taskPane', qualifiedId)
    })
  }

  private registerTaskUISection(registration: PluginTaskUISectionRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('taskUI', registration.id)
    assertFunction('taskUI', 'component', registration.component)
    this.services.claims.claim('taskUI', qualifiedId)

    const contribution: TestingTaskUISectionContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.taskUISections.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.taskUISections.delete(qualifiedId)
      this.services.claims.release('taskUI', qualifiedId)
    })
  }

  private registerSettingsSection(registration: PluginSettingsSectionRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('settings', registration.id)
    assertTitle('settings', registration.title)
    assertFunction('settings', 'component', registration.component)
    this.services.claims.claim('settings', qualifiedId)

    const contribution: TestingSettingsSectionContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.settingsSections.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.settingsSections.delete(qualifiedId)
      this.services.claims.release('settings', qualifiedId)
    })
  }

  private registerInjectionPoint(registration: PluginInjectionPointRegistration): Disposable {
    this.injectionPoints.set(registration.id, {
      id: registration.id,
      location: registration.location,
    })
    return createDisposable(() => {
      this.injectionPoints.delete(registration.id)
    })
  }
}
