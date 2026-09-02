import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import type {
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginReviewRowActionRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
  PluginViewReplacementRegistration,
  TaskStartPrefixProviderRegistration,
} from '@openforge-app/plugin-sdk/frontend'
import type { Disposable, InjectionPointLocation } from '@openforge-app/plugin-sdk'
import {
  RuntimeValidationError,
  assertComponent,
  assertTitle,
  createDisposable,
  sanitizeViewIcon,
  type RuntimeRegistryServices,
} from './runtimeContributionSupport'
import type {
  RuntimeInjectionPointContribution,
  RuntimeReviewRowActionContribution,
  RuntimeSettingsSectionContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeTaskStartPrefixProviderContribution,
  RuntimeTaskUISectionContribution,
  RuntimeViewContribution,
  RuntimeViewReplacementContribution,
} from './runtimeContributionTypes'

type FrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'views' | 'viewReplacements' | 'taskUI' | 'reviewUI' | 'taskPane' | 'settings' | 'injectionPoints' | 'taskStart' | 'backend'
>

export class RuntimeFrontendContributionRegistry {
  private readonly views = new Map<string, RuntimeViewContribution>()
  private readonly viewReplacements = new Map<string, RuntimeViewReplacementContribution>()
  private readonly taskPaneTabs = new Map<string, RuntimeTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, RuntimeTaskUISectionContribution>()
  private readonly reviewRowActions = new Map<string, RuntimeReviewRowActionContribution>()
  private readonly settingsSections = new Map<string, RuntimeSettingsSectionContribution>()
  private readonly injectionPoints = new Map<string, RuntimeInjectionPointContribution>()
  private readonly taskStartPrefixProviders = new Map<string, RuntimeTaskStartPrefixProviderContribution>()
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
        resetSession: async () => this.services.host.resetBrowserSession
          ? this.services.host.resetBrowserSession(this.services.pluginId)
          : Promise.reject(new BrowserSurfaceError('CAPABILITY_UNAVAILABLE', 'OpenForge host capability is unavailable: browserSurfaces.resetSession')),
      },
      views: {
        register: (registration) => this.registerView(registration),
      },
      viewReplacements: {
        register: (registration) => this.registerViewReplacement(registration),
      },
      taskUI: {
        registerTab: (registration) => this.registerTaskPaneTab(registration),
        registerSection: (registration) => this.registerTaskUISection(registration),
      },
      reviewUI: {
        registerRowAction: (registration) => this.registerReviewRowAction(registration),
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
      taskStart: {
        registerPrefixProvider: (registration) => this.registerTaskStartPrefixProvider(registration),
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
    viewReplacements: RuntimeViewReplacementContribution[]
    taskPaneTabs: RuntimeTaskPaneTabContribution[]
    taskUISections: RuntimeTaskUISectionContribution[]
    reviewRowActions: RuntimeReviewRowActionContribution[]
    settingsSections: RuntimeSettingsSectionContribution[]
    injectionPoints: RuntimeInjectionPointContribution[]
    taskStartPrefixProviders: RuntimeTaskStartPrefixProviderContribution[]
  } {
    return {
      views: Array.from(this.views.values()),
      viewReplacements: Array.from(this.viewReplacements.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      taskUISections: Array.from(this.taskUISections.values()),
      reviewRowActions: Array.from(this.reviewRowActions.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      injectionPoints: Array.from(this.injectionPoints.values()),
      taskStartPrefixProviders: this.listTaskStartPrefixProviders(),
    }
  }

  listInjectionPoints(location: InjectionPointLocation): RuntimeInjectionPointContribution[] {
    return Array.from(this.injectionPoints.values()).filter((contribution) => contribution.location === location)
  }

  listTaskStartPrefixProviders(): RuntimeTaskStartPrefixProviderContribution[] {
    return Array.from(this.taskStartPrefixProviders.values()).sort(
      (left, right) => left.order - right.order || left.qualifiedId.localeCompare(right.qualifiedId),
    )
  }

  private registerView(registration: PluginViewRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('views', registration?.id)
    assertTitle('views', registration?.title)
    assertComponent('views', registration?.component)
    if (registration?.navigationComponent !== undefined) {
      assertComponent('views', registration.navigationComponent)
      if (registration.placement !== 'sidebar') {
        throw new RuntimeValidationError('views', 'custom navigation requires sidebar placement')
      }
      if (!this.services.packageMetadata?.requires?.includes('customSidebarNavigation')) {
        throw new RuntimeValidationError('views', 'custom navigation requires the customSidebarNavigation capability')
      }
    }
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


  private registerViewReplacement(registration: PluginViewReplacementRegistration): Disposable {
    if (!this.services.packageMetadata?.requires?.includes('viewReplacements')) {
      throw new RuntimeValidationError('viewReplacements', 'requires the viewReplacements capability')
    }
    const target = (registration as { target?: unknown } | null)?.target
    if (target !== 'project.dashboard' && target !== 'task.detail') {
      throw new RuntimeValidationError(
        'viewReplacements',
        `has unsupported target "${String(target)}"`,
      )
    }
    const qualifiedId = this.services.qualifiedId('viewReplacements', registration?.id)
    assertTitle('viewReplacements', registration?.title)
    assertComponent('viewReplacements', registration?.component)
    this.services.claims.claim('viewReplacements', qualifiedId)

    const identity = {
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    const contribution: RuntimeViewReplacementContribution = registration.target === 'project.dashboard'
      ? { ...registration, ...identity, icon: sanitizeViewIcon(registration.icon, 'viewReplacements') }
      : { ...registration, ...identity }
    this.viewReplacements.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.viewReplacements.delete(qualifiedId)
      this.services.claims.release('viewReplacements', qualifiedId)
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

  // Review-row actions carry no title: they render inside a pull-request row that already
  // names the pull request, so there is nothing for a title to label.
  private registerReviewRowAction(registration: PluginReviewRowActionRegistration): Disposable {
    const qualifiedId = this.services.qualifiedId('reviewUI', registration?.id)
    assertComponent('reviewUI', registration?.component)
    this.services.claims.claim('reviewUI', qualifiedId)

    const contribution: RuntimeReviewRowActionContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.reviewRowActions.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.reviewRowActions.delete(qualifiedId)
      this.services.claims.release('reviewUI', qualifiedId)
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

  private registerTaskStartPrefixProvider(
    registration: TaskStartPrefixProviderRegistration,
  ): Disposable {
    const qualifiedId = this.services.qualifiedId('taskStart', registration?.id)
    assertTitle('taskStart', registration?.title)
    if (typeof registration?.provide !== 'function') {
      throw new Error('taskStart prefix provider requires a provide function')
    }
    this.services.claims.claim('taskStart', qualifiedId)

    const contribution: RuntimeTaskStartPrefixProviderContribution = {
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
      title: registration.title.trim(),
      order: typeof registration.order === 'number' && Number.isFinite(registration.order) ? registration.order : 0,
      provide: (context) => registration.provide(context),
    }
    this.taskStartPrefixProviders.set(qualifiedId, contribution)

    return this.services.trackDisposable(createDisposable(() => {
      this.taskStartPrefixProviders.delete(qualifiedId)
      this.services.claims.release('taskStart', qualifiedId)
    }))
  }
}
