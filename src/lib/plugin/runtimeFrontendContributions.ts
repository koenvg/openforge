import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type {
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
} from '@openforge-app/plugin-sdk/frontend'
import type { Disposable, InjectionPointLocation } from '@openforge-app/plugin-sdk'
import {
  assertComponent,
  assertTitle,
  createDisposable,
  sanitizeViewIcon,
  type RuntimeRegistryServices,
} from './runtimeContributionSupport'
import type {
  RuntimeInjectionPointContribution,
  RuntimeSettingsSectionContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeTaskUISectionContribution,
  RuntimeViewContribution,
} from './runtimeContributionTypes'

type FrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'views' | 'taskUI' | 'taskPane' | 'settings' | 'injectionPoints' | 'backend'
>

export class RuntimeFrontendContributionRegistry {
  private readonly views = new Map<string, RuntimeViewContribution>()
  private readonly taskPaneTabs = new Map<string, RuntimeTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, RuntimeTaskUISectionContribution>()
  private readonly settingsSections = new Map<string, RuntimeSettingsSectionContribution>()
  private readonly injectionPoints = new Map<string, RuntimeInjectionPointContribution>()
  private api: FrontendContributionApi | null = null

  constructor(
    private readonly services: RuntimeRegistryServices,
    private readonly invokeBackendMethod: (method: string, payload?: unknown) => Promise<unknown>,
  ) {}

  createApi(): FrontendContributionApi {
    if (this.api) return this.api
    const registry = this
    this.api = {
      browserSurfaces: {
        getOrCreate: async (request) => this.services.host.getOrCreateBrowserSurface
          ? this.services.host.getOrCreateBrowserSurface(this.services.pluginId, request)
          : Promise.reject(new BrowserSurfaceError('CAPABILITY_UNAVAILABLE', 'OpenForge host capability is unavailable: browserSurfaces.getOrCreate')),
        resetSession: async (taskId) => this.services.host.resetBrowserSession
          ? this.services.host.resetBrowserSession(this.services.pluginId, taskId)
          : Promise.reject(new BrowserSurfaceError('CAPABILITY_UNAVAILABLE', 'OpenForge host capability is unavailable: browserSurfaces.resetSession')),
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
      injectionPoints: {
        register: (registration) => this.registerInjectionPoint(registration),
      },
      backend: {
        get state() {
          return registry.services.host.getBackendState ? registry.services.host.getBackendState() : 'ready'
        },
        whenReady: async () => this.services.host.whenBackendReady ? this.services.host.whenBackendReady() : undefined,
        onReady: (handler) => {
          if (this.services.host.onBackendReady) {
            const subscription = this.services.host.onBackendReady(handler)
            return typeof subscription === 'function' ? createDisposable(subscription) : subscription
          }
          handler()
          return createDisposable(() => undefined)
        },
        invoke: async (method, payload) => this.services.host.invokeBackendMethod
          ? this.services.host.invokeBackendMethod(method, payload) as never
          : this.invokeBackendMethod(method, payload) as never,
      },
    }
    return this.api
  }

  getSnapshot(): {
    views: RuntimeViewContribution[]
    taskPaneTabs: RuntimeTaskPaneTabContribution[]
    taskUISections: RuntimeTaskUISectionContribution[]
    settingsSections: RuntimeSettingsSectionContribution[]
    injectionPoints: RuntimeInjectionPointContribution[]
  } {
    return {
      views: Array.from(this.views.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      taskUISections: Array.from(this.taskUISections.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      injectionPoints: Array.from(this.injectionPoints.values()),
    }
  }

  listInjectionPoints(location: InjectionPointLocation): RuntimeInjectionPointContribution[] {
    return Array.from(this.injectionPoints.values()).filter((contribution) => contribution.location === location)
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('views', registration?.id)
    assertTitle('views', registration?.title)
    assertComponent('views', registration?.component)
    const icon = sanitizeViewIcon(registration?.icon)
    this.services.claims.claim('views', qualifiedId)

    const contribution: RuntimeViewContribution = {
      ...registration,
      icon,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.views.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.views.delete(qualifiedId)
      this.services.claims.release('views', qualifiedId)
    }))
  }

  private registerTaskPaneTab(registration: PluginTaskPaneTabRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('taskPane', registration?.id)
    assertTitle('taskPane', registration?.title)
    assertComponent('taskPane', registration?.component)
    this.services.claims.claim('taskPane', qualifiedId)

    const contribution: RuntimeTaskPaneTabContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.taskPaneTabs.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.taskPaneTabs.delete(qualifiedId)
      this.services.claims.release('taskPane', qualifiedId)
    }))
  }

  private registerTaskUISection(registration: PluginTaskUISectionRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('taskUI', registration?.id)
    assertComponent('taskUI', registration?.component)
    this.services.claims.claim('taskUI', qualifiedId)

    const contribution: RuntimeTaskUISectionContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.taskUISections.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.taskUISections.delete(qualifiedId)
      this.services.claims.release('taskUI', qualifiedId)
    }))
  }

  private registerSettingsSection(registration: PluginSettingsSectionRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('settings', registration?.id)
    assertTitle('settings', registration?.title)
    assertComponent('settings', registration?.component)
    this.services.claims.claim('settings', qualifiedId)

    const contribution: RuntimeSettingsSectionContribution = {
      ...registration,
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.settingsSections.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.settingsSections.delete(qualifiedId)
      this.services.claims.release('settings', qualifiedId)
    }))
  }

  private registerInjectionPoint(registration: PluginInjectionPointRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('injectionPoints', registration?.id)
    assertComponent('injectionPoints', registration?.component)
    this.services.claims.claim('injectionPoints', qualifiedId)

    const contribution: RuntimeInjectionPointContribution = {
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      location: registration.location,
      component: registration.component,
    }
    this.injectionPoints.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.injectionPoints.delete(qualifiedId)
      this.services.claims.release('injectionPoints', qualifiedId)
    }))
  }
}
