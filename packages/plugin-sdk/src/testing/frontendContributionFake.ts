import { createTestingBrowserSurfaces } from '../browserSurfacesTesting.js'
import type { TestingBrowserSurfaces } from '../browserSurfacesTesting.js'
import { sanitizePluginIcon } from '../pluginIcons.js'
import type { TaskBrowserSurfaceState } from '../browserSurfaces.js'
import { freezeThemeDefinition, validateThemeDefinition } from '../themes.js'
import type { PluginThemeDefinition } from '../themes.js'
import type {
  Disposable,
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginReviewRowActionRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
  PluginViewReplacementRegistration,
  TaskStartPrefixProviderRegistration,
} from '../types.js'
import {
  assertFunction,
  assertLocalId,
  assertTitle,
  createDisposable,
  type TestingRegistryServices,
} from './support.js'
import type {
  TestingInjectionPointContribution,
  TestingTaskStartPrefixProviderContribution,
  TestingSettingsSectionContribution,
  TestingThemeContribution,
  TestingTaskPaneTabContribution,
  TestingReviewRowActionContribution,
  TestingTaskUISectionContribution,
  TestingViewContribution,
  TestingViewReplacementContribution,
} from './contracts.js'

type TestingFrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'views' | 'viewReplacements' | 'taskUI' | 'reviewUI' | 'taskPane' | 'settings' | 'themes' | 'backend' | 'injectionPoints' | 'taskStart'
>

export class TestingFrontendContributionFake {
  private readonly views = new Map<string, TestingViewContribution>()
  private readonly viewReplacements = new Map<string, TestingViewReplacementContribution>()
  private readonly taskPaneTabs = new Map<string, TestingTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, TestingTaskUISectionContribution>()
  private readonly reviewRowActions = new Map<string, TestingReviewRowActionContribution>()
  private readonly settingsSections = new Map<string, TestingSettingsSectionContribution>()
  private readonly themes = new Map<string, TestingThemeContribution>()
  private readonly injectionPoints = new Map<string, TestingInjectionPointContribution>()
  private readonly taskStartPrefixProviders = new Map<string, TestingTaskStartPrefixProviderContribution>()
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
      themes: {
        register: (definition) => this.registerTheme(definition),
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
    viewReplacements: TestingViewReplacementContribution[]
    taskPaneTabs: TestingTaskPaneTabContribution[]
    taskUISections: TestingTaskUISectionContribution[]
    reviewRowActions: TestingReviewRowActionContribution[]
    settingsSections: TestingSettingsSectionContribution[]
    themes: TestingThemeContribution[]
    injectionPoints: TestingInjectionPointContribution[]
    taskStartPrefixProviders: TestingTaskStartPrefixProviderContribution[]
  } {
    return {
      views: Array.from(this.views.values()),
      viewReplacements: Array.from(this.viewReplacements.values()),
      taskPaneTabs: Array.from(this.taskPaneTabs.values()),
      taskUISections: Array.from(this.taskUISections.values()),
      reviewRowActions: Array.from(this.reviewRowActions.values()),
      settingsSections: Array.from(this.settingsSections.values()),
      themes: Array.from(this.themes.values()),
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

  private registerViewReplacement(registration: PluginViewReplacementRegistration): Disposable {
    if (!this.services.packageMetadata.requires?.includes('viewReplacements')) {
      throw new Error('viewReplacements registration requires the viewReplacements capability')
    }
    const target = (registration as { target?: unknown } | null)?.target
    if (target !== 'project.dashboard' && target !== 'task.detail') {
      throw new Error(`viewReplacements registration has unsupported target "${String(target)}"`)
    }
    const qualifiedId = this.services.localQualifiedId('viewReplacements', registration.id)
    assertTitle('viewReplacements', registration.title)
    assertFunction('viewReplacements', 'component', registration.component)
    this.services.claims.claim('viewReplacements', qualifiedId)

    const identity = {
      id: registration.id.trim(),
      title: registration.title.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    const contribution: TestingViewReplacementContribution = registration.target === 'project.dashboard'
      ? { ...registration, ...identity, icon: sanitizePluginIcon(registration.icon) }
      : { ...registration, ...identity }
    this.viewReplacements.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.viewReplacements.delete(qualifiedId)
      this.services.claims.release('viewReplacements', qualifiedId)
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

  private registerReviewRowAction(registration: PluginReviewRowActionRegistration): Disposable {
    const qualifiedId = this.services.localQualifiedId('reviewUI', registration.id)
    assertFunction('reviewUI', 'component', registration.component)
    this.services.claims.claim('reviewUI', qualifiedId)

    const contribution: TestingReviewRowActionContribution = {
      ...registration,
      id: registration.id.trim(),
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: this.services.projectId,
    }
    this.reviewRowActions.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.reviewRowActions.delete(qualifiedId)
      this.services.claims.release('reviewUI', qualifiedId)
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

  private registerTheme(definition: PluginThemeDefinition): Disposable {
    if (!this.services.packageMetadata.requires?.includes('themes')) {
      throw new Error('themes registration requires the themes capability')
    }
    if (this.services.packageMetadata.enablement !== 'app') {
      throw new Error('themes registration requires app enablement')
    }
    const localId = definition?.id
    if (typeof localId === 'string' && (
      localId === 'openforge-light'
      || localId === 'openforge-dark'
      || localId.startsWith('openforge.')
    )) {
      throw new Error(`themes registration cannot use reserved id "${localId}"`)
    }
    assertLocalId('themes', localId)
    const validation = validateThemeDefinition(definition)
    if (!validation.valid) {
      throw new Error(`themes registration ${validation.errors.join('; ')}`)
    }

    const qualifiedId = `${this.services.pluginId}:${localId.trim()}`
    this.services.claims.claim('themes', qualifiedId)
    const frozen = freezeThemeDefinition({
      ...definition,
      id: localId.trim(),
      label: definition.label.trim(),
    })
    const contribution: TestingThemeContribution = {
      ...frozen,
      id: frozen.id,
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: null,
    }
    this.services.calls.themeRegistrations.push(definition)
    this.themes.set(qualifiedId, contribution)

    return createDisposable(() => {
      this.themes.delete(qualifiedId)
      this.services.claims.release('themes', qualifiedId)
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
