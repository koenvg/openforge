import { BrowserSurfaceError } from '@openforge-app/plugin-sdk/frontend'
import { freezeThemeDefinition, validateThemeDefinition } from '@openforge-app/plugin-sdk'
import type { ThemeBatchRegistration, ThemeRegistration, ThemeRegistry } from '../themeRegistry'
import type {
  FrontendOpenForgeAPI,
  PluginInjectionPointRegistration,
  PluginReviewRowActionRegistration,
  PluginSettingsSectionRegistration,
  PluginThemeDefinition,
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
  RuntimeThemeContribution,
  RuntimeTaskPaneTabContribution,
  RuntimeTaskStartPrefixProviderContribution,
  RuntimeTaskUISectionContribution,
  RuntimeViewContribution,
  RuntimeViewReplacementContribution,
} from './runtimeContributionTypes'

export type LiveFrontendContributions = Pick<ReturnType<RuntimeFrontendContributionRegistry['getSnapshot']>,
  'views' | 'taskPaneTabs' | 'taskUISections' | 'reviewRowActions' | 'settingsSections'>

type ThemeRegistryResolver = () => Promise<ThemeRegistry | null>

async function resolveBrowserThemeRegistry(): Promise<ThemeRegistry | null> {
  if (typeof document === 'undefined') return null
  return (await import('../theme')).themeRegistry
}

type FrontendContributionApi = Pick<
  FrontendOpenForgeAPI,
  'browserSurfaces' | 'views' | 'viewReplacements' | 'taskUI' | 'reviewUI' | 'taskPane' | 'settings' | 'themes' | 'injectionPoints' | 'taskStart' | 'backend'
>

export class RuntimeFrontendContributionRegistry {
  private readonly contributionObservers = new Set<(snapshot: LiveFrontendContributions) => void>()
  private readonly views = new Map<string, RuntimeViewContribution>()
  private readonly viewReplacements = new Map<string, RuntimeViewReplacementContribution>()
  private readonly viewReplacementObservers = new Set<(replacements: RuntimeViewReplacementContribution[]) => void>()
  private readonly taskPaneTabs = new Map<string, RuntimeTaskPaneTabContribution>()
  private readonly taskUISections = new Map<string, RuntimeTaskUISectionContribution>()
  private readonly reviewRowActions = new Map<string, RuntimeReviewRowActionContribution>()
  private readonly settingsSections = new Map<string, RuntimeSettingsSectionContribution>()
  private readonly themes = new Map<string, RuntimeThemeContribution>()
  private committedThemes: ThemeBatchRegistration | null = null
  private readonly lateThemeRegistrations = new Map<string, ThemeRegistration>()
  private committedThemeGeneration: number | null = null
  private themeRegistry: ThemeRegistry | null = null
  private readonly injectionPoints = new Map<string, RuntimeInjectionPointContribution>()
  private readonly taskStartPrefixProviders = new Map<string, RuntimeTaskStartPrefixProviderContribution>()
  private api: FrontendContributionApi | null = null

  constructor(
    private readonly services: RuntimeRegistryServices,
    private readonly invokeBackendMethod: (method: string, payload?: unknown) => Promise<unknown>,
    private readonly resolveThemeRegistry: ThemeRegistryResolver = resolveBrowserThemeRegistry,
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
      themes: {
        register: (definition) => this.registerTheme(definition),
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
    themes: RuntimeThemeContribution[]
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
      themes: Array.from(this.themes.values()),
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

  async prepareThemes(): Promise<void> {
    if (this.themeRegistry) return
    this.themeRegistry = await this.resolveThemeRegistry()
    if (!this.themeRegistry && this.themes.size > 0) {
      throw new RuntimeValidationError('themes', 'requires a browser theme host')
    }
  }

  commitThemes(generation: number, isGenerationCurrent: () => boolean = () => true): boolean {
    if (this.committedThemeGeneration !== null) {
      throw new Error(`Theme contributions for ${this.services.pluginId} are already committed`)
    }
    if (!isGenerationCurrent()) return false

    const definitions = Array.from(this.themes.values(), contribution => freezeThemeDefinition({
      id: contribution.qualifiedId,
      label: contribution.label,
      appearance: contribution.appearance,
      tokens: contribution.tokens,
      ...(contribution.stylesheets ? { stylesheets: contribution.stylesheets } : {}),
    }))
    if (!this.themeRegistry && definitions.length > 0) {
      throw new RuntimeValidationError('themes', 'requires a browser theme host')
    }

    if (this.themeRegistry) {
      this.committedThemes = this.themeRegistry.registerContributedThemes(definitions, {
        pluginId: this.services.pluginId,
        generation,
      })
    }
    this.committedThemeGeneration = generation
    return true
  }

  private registerTheme(definition: PluginThemeDefinition): Disposable {
    if (!this.services.packageMetadata?.requires?.includes('themes')) {
      throw new RuntimeValidationError('themes', 'requires the themes capability')
    }
    if (this.services.packageMetadata.enablement !== 'app') {
      throw new RuntimeValidationError('themes', 'requires app enablement')
    }

    const localId = definition?.id
    if (typeof localId === 'string' && (
      localId === 'openforge-light'
      || localId === 'openforge-dark'
      || localId.startsWith('openforge.')
    )) {
      throw new RuntimeValidationError('themes', `cannot use reserved id "${localId}"`)
    }
    if (typeof localId !== 'string' || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(localId)) {
      throw new RuntimeValidationError('themes', 'requires a stable local id')
    }

    const validation = validateThemeDefinition(definition)
    if (!validation.valid) {
      throw new RuntimeValidationError('themes', validation.errors.join('; '))
    }
    if (this.committedThemeGeneration !== null && !this.themeRegistry) {
      throw new RuntimeValidationError('themes', 'requires a browser theme host')
    }

    const qualifiedId = `${this.services.pluginId}:${localId}`
    this.services.claims.claim('themes', qualifiedId)
    const frozen = freezeThemeDefinition(definition)
    const contribution: RuntimeThemeContribution = {
      ...frozen,
      id: frozen.id,
      qualifiedId,
      pluginId: this.services.pluginId,
      projectId: null,
    }
    this.themes.set(qualifiedId, contribution)

    if (this.committedThemeGeneration !== null) {
      const themeRegistry = this.themeRegistry
      if (!themeRegistry) {
        throw new RuntimeValidationError('themes', 'requires a browser theme host')
      }
      const registration = themeRegistry.registerContributedTheme({
        ...frozen,
        id: qualifiedId,
      }, {
        pluginId: this.services.pluginId,
        generation: this.committedThemeGeneration,
      })
      this.lateThemeRegistrations.set(qualifiedId, registration)
    }

    return this.services.trackDisposable(createDisposable(async () => {
      this.themes.delete(qualifiedId)
      this.services.claims.release('themes', qualifiedId)
      const lateRegistration = this.lateThemeRegistrations.get(qualifiedId)
      if (lateRegistration) {
        this.lateThemeRegistrations.delete(qualifiedId)
        await lateRegistration.dispose()
        return
      }
      await this.committedThemes?.disposeTheme(qualifiedId)
    }))
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
    this.publishContributions()

    return this.services.trackDisposable(createDisposable(() => {
      this.views.delete(qualifiedId)
      this.services.claims.release('views', qualifiedId)
      this.publishContributions()
    }))
  }


  observeContributions(observer: (snapshot: LiveFrontendContributions) => void): Disposable {
    this.contributionObservers.add(observer)
    observer(this.getSnapshot())
    return createDisposable(() => { this.contributionObservers.delete(observer) })
  }

  private publishContributions(): void {
    for (const observer of this.contributionObservers) observer(this.getSnapshot())
  }

  observeViewReplacements(observer: (replacements: RuntimeViewReplacementContribution[]) => void): Disposable {
    this.viewReplacementObservers.add(observer)
    observer([...this.viewReplacements.values()])
    return createDisposable(() => { this.viewReplacementObservers.delete(observer) })
  }

  private publishViewReplacements(): void {
    for (const observer of this.viewReplacementObservers) observer([...this.viewReplacements.values()])
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
    this.publishViewReplacements()

    return this.services.trackDisposable(createDisposable(() => {
      this.viewReplacements.delete(qualifiedId)
      this.services.claims.release('viewReplacements', qualifiedId)
      this.publishViewReplacements()
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
    this.publishContributions()

    return this.services.trackDisposable(createDisposable(() => {
      this.taskPaneTabs.delete(qualifiedId)
      this.services.claims.release('taskPane', qualifiedId)
      this.publishContributions()
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
    this.publishContributions()

    return this.services.trackDisposable(createDisposable(() => {
      this.taskUISections.delete(qualifiedId)
      this.services.claims.release('taskUI', qualifiedId)
      this.publishContributions()
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
    this.publishContributions()

    return this.services.trackDisposable(createDisposable(() => {
      this.reviewRowActions.delete(qualifiedId)
      this.services.claims.release('reviewUI', qualifiedId)
      this.publishContributions()
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
    this.publishContributions()

    return this.services.trackDisposable(createDisposable(() => {
      this.settingsSections.delete(qualifiedId)
      this.services.claims.release('settings', qualifiedId)
      this.publishContributions()
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
