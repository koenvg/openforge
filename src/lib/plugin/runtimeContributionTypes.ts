import type {
  GetOrCreateBrowserSurfaceRequest,
  PluginInjectionPointRegistration,
  PluginReviewRowActionRegistration,
  PluginSettingsSectionRegistration,
  PluginTaskPaneTabRegistration,
  PluginTaskUISectionRegistration,
  PluginViewRegistration,
  TaskBrowserSurfaceController,
} from '@openforge-app/plugin-sdk/frontend'
import type {
  BackendMethodRegistration,
  BackgroundServiceRegistration,
} from '@openforge-app/plugin-sdk/backend'
import type {
  AgentCommandMetadata,
  AgentSession,
  BackendReadyState,
  CommandInfo,
  CommandShortcutMetadata,
  ComposeTaskRequest,
  ComposeTaskResult,
  ConfigureStartPromptContributionRequest,
  CreateTaskRequest,
  FileContent,
  FileEntry,
  ImplementationRun,
  ListTaskSessionsRequest,
  ListTaskUsageCandidatesRequest,
  TaskUsageCandidatePage,
  InjectionPointLocation,
  JsonSchema,
  OpenForgeNavigationRequest,
  OpenForgeNavigationSnapshot,
  OpenForgePackageMetadata,
  PluginCommandInvocationContext,
  PluginStorage,
  Project,
  ProjectAttention,
  PtyBufferState,
  ShellSpawnRequest,
  StartPromptContribution,
  SendTaskFollowUpRequest,
  StartTaskImplementationRequest,
  TaskFollowUpReceipt,
  Task,
  TaskStartPrefixContext,
  TaskWorkspaceInfo,
  WritableBoardStatus,
  Disposable,
} from '@openforge-app/plugin-sdk'

export type MaybePromise<T> = T | Promise<T>
export type RuntimeKind = 'commands' | 'events' | 'views' | 'taskPane' | 'taskUI' | 'reviewUI' | 'settings' | 'background' | 'backend' | 'injectionPoints' | 'taskStart'
export type RuntimeScope = 'global' | 'project' | 'task'
export type RuntimeHandler = (
  payload?: unknown,
  context?: PluginCommandInvocationContext,
) => MaybePromise<unknown>
export type RuntimeEventHandler = (payload: unknown) => void

export type RuntimeHostBridge = {
  listProjects?(): Promise<Project[]>
  getProject?(projectId: string): Promise<Project | null>
  listTasks?(request?: { projectId?: string | null; includeDone?: boolean }): Promise<Task[]>
  listTaskUsageCandidates?(request: ListTaskUsageCandidatesRequest): Promise<TaskUsageCandidatePage>
  getTask?(taskId: string): Promise<Task>
  createTask?(request: CreateTaskRequest): Promise<Task>
  composeTask?(request: ComposeTaskRequest): Promise<ComposeTaskResult | null>
  updateTaskStatus?(taskId: string, status: WritableBoardStatus): Promise<void>
  listStartPromptContributions?(projectId: string): Promise<StartPromptContribution[]>
  configureStartPromptContribution?(request: ConfigureStartPromptContributionRequest): Promise<StartPromptContribution[]>
  startTaskImplementation?(request: StartTaskImplementationRequest): Promise<ImplementationRun>
  sendTaskFollowUp?(request: SendTaskFollowUpRequest): Promise<TaskFollowUpReceipt>
  getTaskWorkspace?(taskId: string): Promise<TaskWorkspaceInfo | null>
  getLatestSession?(taskId: string): Promise<AgentSession | null>
  listTaskSessions?(request: ListTaskSessionsRequest): Promise<AgentSession[]>
  listCommandCatalog?(request?: { projectId?: string | null }): Promise<CommandInfo[]>
  readDir?(request: { projectId: string; path?: string | null }): Promise<FileEntry[]>
  readFile?(request: { projectId: string; path: string }): Promise<FileContent>
  writeFile?(request: { projectId: string; path: string; content: string }): Promise<void>
  searchFiles?(request: { projectId: string; query: string; limit?: number }): Promise<string[]>
  spawnShell?(request: ShellSpawnRequest): Promise<number>
  writeShell?(request: { taskId: string; terminalIndex: number; data: string }): Promise<void>
  resizeShell?(request: { taskId: string; terminalIndex: number; cols: number; rows: number }): Promise<void>
  killShell?(request: { taskId: string; terminalIndex: number }): Promise<void>
  getShellBuffer?(request: { taskId: string; terminalIndex: number }): Promise<PtyBufferState>
  notify?(request: { title: string; body?: string; [key: string]: unknown }): Promise<void>
  getAttention?(): Promise<ProjectAttention[]>
  openUrl?(url: string): Promise<void>
  writeClipboardText?(text: string): Promise<void>
  getNavigation?(): OpenForgeNavigationSnapshot
  navigate?(request: OpenForgeNavigationRequest): Promise<OpenForgeNavigationSnapshot>
  getConfig?(key: string): Promise<unknown>
  setConfig?(key: string, value: unknown): Promise<void>
  getProjectConfig?(projectId: string, key: string): Promise<unknown>
  setProjectConfig?(projectId: string, key: string, value: unknown): Promise<void>
  getBackendState?(): BackendReadyState
  whenBackendReady?(): Promise<void>
  onBackendReady?(handler: () => void): Disposable | (() => void)
  invokeBackendMethod?(method: string, payload?: unknown): Promise<unknown>
  invokeHostCommand?(command: string, payload?: unknown): Promise<unknown>
  onHostEvent?(event: string, handler: (payload: unknown) => void): () => void
  getOrCreateBrowserSurface?(pluginId: string, request: GetOrCreateBrowserSurfaceRequest): Promise<TaskBrowserSurfaceController>
  resetBrowserSession?(pluginId: string): Promise<void>
  destroyPluginBrowserSurfaces?(pluginId: string): Promise<void>
}

export type RuntimeOptions = {
  pluginId: string
  projectId: string | null
  packageMetadata?: OpenForgePackageMetadata
  host?: RuntimeHostBridge
  storage?: PluginStorage
}

export type RuntimeContributionBase = {
  id: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

export type RuntimeCommandContribution = RuntimeContributionBase & {
  title: string
  icon?: string
  shortcut?: CommandShortcutMetadata
  discoverable?: boolean
  agent?: AgentCommandMetadata
  input?: JsonSchema
  output?: JsonSchema
  handler: RuntimeHandler
}

export type RuntimeEventListenerContribution = RuntimeContributionBase & {
  handler: RuntimeEventHandler
  global: boolean
}

export type RuntimeViewContribution = RuntimeContributionBase & PluginViewRegistration
export type RuntimeTaskPaneTabContribution = RuntimeContributionBase & PluginTaskPaneTabRegistration
export type RuntimeTaskUISectionContribution = RuntimeContributionBase & PluginTaskUISectionRegistration
export type RuntimeReviewRowActionContribution = RuntimeContributionBase & PluginReviewRowActionRegistration
export type RuntimeSettingsSectionContribution = RuntimeContributionBase & PluginSettingsSectionRegistration
export type RuntimeInjectionPointContribution = RuntimeContributionBase & {
  location: InjectionPointLocation
  component: PluginInjectionPointRegistration['component']
}

export type RuntimeTaskStartPrefixProviderContribution = RuntimeContributionBase & {
  title: string
  order: number
  provide(context: TaskStartPrefixContext): MaybePromise<string | null>
}

export type RuntimeBackgroundServiceContribution = RuntimeContributionBase & BackgroundServiceRegistration & {
  started: boolean
}

export type RuntimeBackendMethodContribution = RuntimeContributionBase & {
  registration: BackendMethodRegistration
}

export type RuntimeContributionSnapshot = {
  pluginId: string
  projectId: string | null
  views: RuntimeViewContribution[]
  taskPaneTabs: RuntimeTaskPaneTabContribution[]
  taskUISections: RuntimeTaskUISectionContribution[]
  reviewRowActions: RuntimeReviewRowActionContribution[]
  settingsSections: RuntimeSettingsSectionContribution[]
  injectionPoints: RuntimeInjectionPointContribution[]
  taskStartPrefixProviders: RuntimeTaskStartPrefixProviderContribution[]
  commands: RuntimeCommandContribution[]
  eventListeners: RuntimeEventListenerContribution[]
  backendMethods: RuntimeBackendMethodContribution[]
  backgroundServices: RuntimeBackgroundServiceContribution[]
}
