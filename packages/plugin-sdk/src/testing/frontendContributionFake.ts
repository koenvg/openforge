import { createTestingBrowserSurfaces } from '../browserSurfacesTesting.js'
import type { TestingBrowserSurfaces } from '../browserSurfacesTesting'
import { isAllowedBrowserSurfaceUrl, type TaskBrowserSurfaceState } from '../browserSurfaces.js'
import type {
  Disposable,
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
  TaskLinkHandler,
  TaskStartPrefixProviderRegistration,
} from '../types'
import {
  assertFunction,
  assertTitle,
  createDisposable,
  type TestingRegistryServices,
} from './support.js'
import type {
  TestingInjectionPointContribution,
  TestingTaskStartPrefixProviderContribution,
  TestingSettingsSectionContribution,
  TestingTaskPaneTabContribution,
  TestingTaskUISectionContribution,
  TestingViewContribution,
} from './contracts'

type TestingFrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'taskLinks' | 'views' | 'taskUI' | 'taskPane' | 'settings' | 'backend' | 'injectionPoints' | 'taskStart'
>

export class TestingFrontendContributionFake {
  private readonly views = new Map<string, TestingViewContribution>()
  private readonly taskPaneTabs = new Map<string, TestingTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, TestingTaskUISectionContribution>()
  private readonly settingsSections = new Map<string, TestingSettingsSectionContribution>()
  private readonly injectionPoints = new Map<string, TestingInjectionPointContribution>()
  private readonly taskStartPrefixProviders = new Map<string, TestingTaskStartPrefixProviderContribution>()
  private readonly browserSurfaces: TestingBrowserSurfaces
  private taskLinkHandler: TaskLinkHandler | null = null
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
      taskLinks: {
        open: async (request) => {
          this.services.calls.taskLinkOpenRequests.push(request)
          if (!isAllowedBrowserSurfaceUrl(request.url)) {
            throw new Error('Task links must use a valid HTTP(S) URL')
          }
          if (this.taskLinkHandler === null) {
            this.services.calls.openUrl.push(request.url)
            return
          }
          const result = await this.taskLinkHandler(request)
          if (result === 'declined') {
            this.services.calls.openUrl.push(request.url)
            return
          }
          if (result !== 'handled') {
            throw new Error(`Task link handler returned an invalid result: ${String(result)}`)
          }
        },
        registerHandler: (handler) => {
          if (this.taskLinkHandler !== null) {
            throw new Error('A Task link handler is already registered')
          }
          this.taskLinkHandler = handler
          return createDisposable(() => {
            if (this.taskLinkHandler === handler) this.taskLinkHandler = null
          })
        },
      },
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
      taskStart: {
        registerPrefixProvider: (registration) => this.registerTaskStartPrefixProvider(registration),
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
    taskStartPrefixProviders: TestingTaskStartPrefixProviderContribution[]
  } {
    return {
      views: Array.from(this.views.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      taskUISections: Array.from(this.taskUISections.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      injectionPoints: Array.from(this.injectionPoints.values()),
      taskStartPrefixProviders: Array.from(this.taskStartPrefixProviders.values()).sort(
        (left, right) => left.order - right.order || left.id.localeCompare(right.id),
      ),
    }
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('views', registration.id)
    assertTitle('views', registration.title)
    assertFunction('views', 'component', registration.component)
    if (registration.navigationComponent !== undefined) {
      assertFunction('views', 'navigationComponent', registration.navigationComponent)
      if (registration.placement !== 'sidebar') {
        throw new Error('views registration custom navigation requires sidebar placement')
      }
      if (!this.services.packageMetadata.requires?.includes('customSidebarNavigation')) {
        throw new Error('views registration custom navigation requires the customSidebarNavigation capability')
      }
    }
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

  private registerTaskStartPrefixProvider(
    registration: TaskStartPrefixProviderRegistration,
  ): Disposable {
    this.taskStartPrefixProviders.set(registration.id, {
      id: registration.id,
      title: registration.title,
      order: registration.order ?? 0,
      provide: (context) => registration.provide(context),
    })
    return createDisposable(() => {
      this.taskStartPrefixProviders.delete(registration.id)
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
