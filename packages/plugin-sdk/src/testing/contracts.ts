import type { BrowserSurfaceVisualFeedback } from '../browserSurfaces'
import type { TestingOpenForgeRegistryFake } from './registryFake'
import type {
  BackendMethodRegistration,
  BackendOpenForgeAPI,
  BackgroundServiceRegistration,
  CommandRegistration,
  CommandShortcutMetadata,
  ComposeTaskRequest,
  ConfigureStartPromptContributionRequest,
  CreateTaskRequest,
  FrontendOpenForgeAPI,
  InjectionPointLocation,
  ListTaskSessionsRequest,
  JsonValue,
  NotificationRequest,
  OpenForgeNavigationRequest,
  OpenForgePackageMetadata,
  PluginSettingsSectionRegistration,
  PluginStorage,
  PluginTaskPaneTabRegistration,
  PluginReviewRowActionRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
  ShellSpawnRequest,
  SendTaskFollowUpRequest,
  StartTaskImplementationRequest,
  TaskStartPrefixContext,
  ExternalReadDirectoryRequest,
  ExternalReadFileRequest,
  ExternalReadTextFileChunksRequest,
  UserDataDirectoryRequest,
  UserDataFileRequest,
  UserDataFileWriteRequest,
} from '../types'
import type { AgentSession, Task } from '../domain'

export type TestingRuntimeScope = 'global' | 'project' | 'task'
export type TestingRuntimeKind = 'commands' | 'events' | 'views' | 'taskPane' | 'taskUI' | 'reviewUI' | 'settings' | 'backend' | 'background'
export type TestingMaybePromise<T> = T | Promise<T>
export type TestingCommandHandler = (payload?: unknown) => TestingMaybePromise<unknown>
export type TestingEventHandler = (payload: unknown) => void

export interface TestingExternalTextFile extends ExternalReadFileRequest {
  content: string
  /** Defaults to a deterministic identity derived from root and path. */
  identity?: string
  modifiedAtMs?: number | null
}

export type TestingExternalTextFileChunksCall = Omit<ExternalReadTextFileChunksRequest, 'signal' | 'chunkSizeBytes'> & {
  chunkSizeBytes: number
}

export interface TestingOpenForgeApiOptions {
  pluginId?: string
  projectId?: string | null
  taskId?: string | null
  /** The active view key reported by `navigation.get().currentView`. Defaults to `'board'`. */
  viewId?: string
  packageMetadata?: OpenForgePackageMetadata
  storage?: PluginStorage
  /** Initial files exposed through `fs.userData`. Defaults to none. */
  userDataTextFiles?: UserDataFileWriteRequest[]
  /**
   * Tasks returned by `tasks.list`. The mock filters them by the requested
   * `projectId` (when given) and drops `done` tasks unless `includeDone: true`,
   * mirroring the host capability. Defaults to an empty list.
   */
  tasks?: Task[]
  /** Agent Sessions returned by `tasks.listSessions`. Defaults to an empty list. */
  agentSessions?: AgentSession[]
  /** UTF-8 files returned by `fs.external.readTextFileChunks`. Defaults to none. */
  externalTextFiles?: TestingExternalTextFile[]
}

export interface TestingOpenForgeApiCalls {
  commandInvocations: Array<{ id: string; qualifiedId: string; payload: unknown }>
  globalCommandInvocations: Array<{ qualifiedId: string; payload: unknown }>
  backendInvocations: Array<{ method: string; qualifiedId: string; payload: unknown }>
  emittedEvents: Array<{ event: string; qualifiedEvent: string; payload: unknown }>
  emittedGlobalEvents: Array<{ qualifiedEvent: string; payload: unknown }>
  openUrl: string[]
  clipboardWrites: string[]
  navigationRequests: OpenForgeNavigationRequest[]
  notify: NotificationRequest[]
  taskCreations: CreateTaskRequest[]
  taskComposes: ComposeTaskRequest[]
  startPromptContributionConfigurations: ConfigureStartPromptContributionRequest[]
  taskImplementationStarts: StartTaskImplementationRequest[]
  taskFollowUps: SendTaskFollowUpRequest[]
  taskListRequests: Array<{ projectId: string | null; includeDone: boolean }>
  taskSessionListRequests: ListTaskSessionsRequest[]
  taskStatusUpdates: Array<{ taskId: string; status: string }>
  configWrites: Array<{ key: string; value: JsonValue; projectId: string | null }>
  fsWrites: Array<{ projectId: string; path: string; content: string }>
  fsUserDataReadDirs: UserDataDirectoryRequest[]
  fsUserDataReads: UserDataFileRequest[]
  fsUserDataWrites: UserDataFileWriteRequest[]
  fsUserDataAppends: UserDataFileWriteRequest[]
  fsExternalReadDirs: ExternalReadDirectoryRequest[]
  fsExternalReads: ExternalReadFileRequest[]
  fsExternalStats: ExternalReadFileRequest[]
  fsExternalReadTextFileChunks: TestingExternalTextFileChunksCall[]
  shellSpawns: ShellSpawnRequest[]
  shellWrites: Array<{ taskId: string; terminalIndex: number; data: string }>
  shellResizes: Array<{ taskId: string; terminalIndex: number; cols: number; rows: number }>
  shellKills: Array<{ taskId: string; terminalIndex: number }>
  shellBuffers: Array<{ taskId: string; terminalIndex: number }>
  browserSurfaceGetOrCreate: Array<{ taskId: string; id: string; initialUrl?: string }>
  browserSurfaceAttachments: Array<{ taskId: string; id: string; element: HTMLElement }>
  browserSurfaceDetaches: Array<{ taskId: string; id: string }>
  browserSurfaceDestroys: Array<{ taskId: string; id: string }>
  browserSurfaceNavigations: Array<{ taskId: string; id: string; url: string }>
  browserSurfaceControls: Array<{ taskId: string; id: string; action: 'goBack' | 'goForward' | 'reload' | 'stop' }>
  browserSurfaceSelections: Array<{ taskId: string; id: string }>
  browserSurfaceFeedbackClears: Array<{ taskId: string; id: string }>
  browserSurfaceFeedbackReplacements: Array<{ taskId: string; id: string; feedback: BrowserSurfaceVisualFeedback[] }>
  browserSurfaceCaptureChecks: Array<{ taskId: string; id: string; artifactId: string }>
  browserSurfaceCaptures: Array<{ taskId: string; id: string }>
  browserSurfaceCaptureDiscards: Array<{ taskId: string; id: string; artifactId: string }>
  browserSurfaceSessionResets: Array<Record<string, never>>
  storageGets: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string }>
  storageSets: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string; value: JsonValue }>
  storageDeletes: Array<{ scope: TestingRuntimeScope; scopeId: string | null; key: string }>
}

export interface TestingContributionBase {
  id: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

export type TestingCommandContribution = TestingContributionBase & CommandRegistration & {
  title: string
  icon?: string
  shortcut?: CommandShortcutMetadata
  handler: TestingCommandHandler
}

export type TestingEventListenerContribution = TestingContributionBase & {
  handler: TestingEventHandler
  global: boolean
}

export type TestingViewContribution = TestingContributionBase & PluginViewRegistration
export type TestingTaskPaneTabContribution = TestingContributionBase & PluginTaskPaneTabRegistration
export type TestingTaskUISectionContribution = TestingContributionBase & PluginTaskUISectionRegistration
export type TestingReviewRowActionContribution = TestingContributionBase & PluginReviewRowActionRegistration
export type TestingSettingsSectionContribution = TestingContributionBase & PluginSettingsSectionRegistration
export type TestingBackendMethodContribution = TestingContributionBase & {
  registration: BackendMethodRegistration
}
export type TestingBackgroundServiceContribution = TestingContributionBase & BackgroundServiceRegistration & {
  started: boolean
}

export interface TestingInjectionPointContribution {
  id: string
  location: InjectionPointLocation
}

export interface TestingTaskStartPrefixProviderContribution {
  id: string
  title: string
  order: number
  provide(context: TaskStartPrefixContext): TestingMaybePromise<string | null>
}

export interface TestingOpenForgeRegistrySnapshot {
  pluginId: string
  projectId: string | null
  views: TestingViewContribution[]
  taskPaneTabs: TestingTaskPaneTabContribution[]
  taskUISections: TestingTaskUISectionContribution[]
  reviewRowActions: TestingReviewRowActionContribution[]
  settingsSections: TestingSettingsSectionContribution[]
  commands: TestingCommandContribution[]
  eventListeners: TestingEventListenerContribution[]
  backendMethods: TestingBackendMethodContribution[]
  backgroundServices: TestingBackgroundServiceContribution[]
  injectionPoints: TestingInjectionPointContribution[]
  taskStartPrefixProviders: TestingTaskStartPrefixProviderContribution[]
}

export type MockFrontendOpenForgeAPI = FrontendOpenForgeAPI & {
  readonly __testing: {
    readonly calls: TestingOpenForgeApiCalls
    readonly registry: TestingOpenForgeRegistryFake
  }
}

export type MockBackendOpenForgeAPI = BackendOpenForgeAPI & {
  readonly __testing: {
    readonly calls: TestingOpenForgeApiCalls
    readonly registry: TestingOpenForgeRegistryFake
  }
}
