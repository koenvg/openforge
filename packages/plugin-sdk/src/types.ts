import packageMetadataSchemaData from './openforgePackageMetadataSchema.json' with { type: 'json' }

import type { Component } from 'svelte'
import type { BrowserSurfacesAPI } from './browserSurfaces'
import type {
  AgentSession,
  CommandInfo,
  FileContent,
  FileEntry,
  Project,
  ProjectAttention,
  ReviewPullRequest,
  Task,
  TaskWorkspaceInfo,
  WritableBoardStatus,
} from './domain'

export type SupportedOpenForgeApiVersion = 1

function readSupportedOpenForgeApiVersions(): [SupportedOpenForgeApiVersion, ...SupportedOpenForgeApiVersion[]] {
  const versions = packageMetadataSchemaData.properties.apiVersion.enum

  if (!Array.isArray(versions) || versions.length === 0 || !versions.every((version) => typeof version === 'number' && Number.isInteger(version))) {
    throw new Error('openforgePackageMetadataSchema.json properties.apiVersion.enum must contain at least one integer')
  }

  return [...versions] as [SupportedOpenForgeApiVersion, ...SupportedOpenForgeApiVersion[]]
}

export const SUPPORTED_OPENFORGE_API_VERSIONS = Object.freeze(readSupportedOpenForgeApiVersions())
export const OPENFORGE_PLUGIN_API_VERSION: SupportedOpenForgeApiVersion = SUPPORTED_OPENFORGE_API_VERSIONS[0]
export const MIN_SUPPORTED_API_VERSION = Math.min(...SUPPORTED_OPENFORGE_API_VERSIONS) as SupportedOpenForgeApiVersion
export const MAX_SUPPORTED_API_VERSION = Math.max(...SUPPORTED_OPENFORGE_API_VERSIONS) as SupportedOpenForgeApiVersion

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[]
export interface JsonObject {
  [key: string]: JsonValue
}

export type JsonSchema = Record<string, unknown>
export type MaybePromise<T> = T | Promise<T>

export interface ValidationError {
  path: string
  message: string
}

const OPENFORGE_PLUGIN_CAPABILITY_TYPE_MEMBERS = [
  'commands',
  'events',
  'views',
  'injectionPoints',
  'taskPane',
  'taskStart',
  'settings',
  'background',
  'backend',
  'storage',
  'context',
  'navigation',
  'tasks',
  'projects',
  'fs',
  'shell',
  'notifications',
  'attention',
  'system.openUrl',
  'system.writeClipboardText',
  'config',
  'projectConfig',
  'browserSurfaces',
  'appEnablement',
  'customSidebarNavigation',
  'reviewUI',
] as const

export type OpenForgePluginCapability = (typeof OPENFORGE_PLUGIN_CAPABILITY_TYPE_MEMBERS)[number]

function assertOpenForgePluginCapabilitiesMatchSchema(): void {
  const schemaCapabilities: unknown = packageMetadataSchemaData.properties.requires.items.enum

  if (!Array.isArray(schemaCapabilities) || !schemaCapabilities.every((capability) => typeof capability === 'string')) {
    throw new Error('openforgePackageMetadataSchema.json properties.requires.items.enum must contain only strings')
  }

  if (
    schemaCapabilities.length !== OPENFORGE_PLUGIN_CAPABILITY_TYPE_MEMBERS.length
    || schemaCapabilities.some((capability, index) => capability !== OPENFORGE_PLUGIN_CAPABILITY_TYPE_MEMBERS[index])
  ) {
    throw new Error('OpenForgePluginCapability must match openforgePackageMetadataSchema.json properties.requires.items.enum')
  }
}

assertOpenForgePluginCapabilitiesMatchSchema()

export interface OpenForgePackageMetadata {
  id: string
  apiVersion: SupportedOpenForgeApiVersion
  displayName: string
  description: string
  /** Defaults to project-owned lifecycle when omitted. */
  enablement?: 'app' | 'project'
  icon?: PluginIcon
  frontend?: string
  frontendStyles?: string[]
  backend?: string
  requires?: OpenForgePluginCapability[]
}

export interface OpenForgePluginPackageJson {
  name: string
  version: string
  peerDependencies?: Record<string, string>
  openforge: OpenForgePackageMetadata
}

export type PluginState = 'installed' | 'active' | 'error' | 'disabled'

export interface PluginEntry {
  metadata: OpenForgePackageMetadata
  state: PluginState
  error: string | null
  installPath?: string
  isBuiltin?: boolean
}

export interface Disposable {
  dispose(): void | Promise<void>
}

export interface SubscriptionSink {
  add(subscription: Disposable | (() => void)): void
}

export interface OpenForgeContextSnapshot {
  pluginId: string
  projectId: string | null
  taskId?: string | null
}

export type OpenForgeContextChangeHandler = (snapshot: OpenForgeContextSnapshot) => MaybePromise<void>
export interface OpenForgeNavigationSnapshot {
  activeProjectId: string | null
  currentView: string
  selectedTaskId: string | null
}

export interface OpenForgeNavigationRequest {
  viewId?: string
  projectId?: string | null
  taskId?: string | null
  /** Plugin-local Task UI tab id. Requires a non-null taskId. */
  taskViewId?: string
}

export interface NavigationAPI {
  get(): OpenForgeNavigationSnapshot
  navigate(request: OpenForgeNavigationRequest): Promise<OpenForgeNavigationSnapshot>
}

export interface OpenForgePluginContext {
  pluginId: string
  apiVersion: SupportedOpenForgeApiVersion
  packageMetadata: OpenForgePackageMetadata
  subscriptions: SubscriptionSink
  onDidChange(handler: OpenForgeContextChangeHandler): Disposable
}

export type FrontendPluginContext = OpenForgePluginContext
export type BackendPluginContext = OpenForgePluginContext

export interface PluginStorageScope {
  get<T extends JsonValue = JsonValue>(key: string): Promise<T | null>
  set<T extends JsonValue = JsonValue>(key: string, value: T): Promise<void>
  delete(key: string): Promise<void>
}

export interface PluginStorage {
  readonly global: PluginStorageScope
  project(projectId: string): PluginStorageScope
  task(taskId: string): PluginStorageScope
}

export type CommandShortcutMetadata = string | {
  key: string
  scope?: 'global' | 'project' | 'task'
  when?: string
}

export interface AgentCommandMetadata {
  /** Concise guidance explaining when and why an agent should use this command. */
  description: string
  /** Example plugin-owned JSON inputs. Task and Project context are supplied separately. */
  examples?: JsonValue[]
  /** Whether the command appears in the routine agent catalog. Defaults to true. */
  discoverable?: boolean
}

export type AgentCommandRuntime = 'backend' | 'frontend'

/** Serializable agent-facing projection of a Plugin Command. Never contains its handler. */
export interface AgentCommandDescriptor {
  qualifiedId: string
  pluginId: string
  runtime: AgentCommandRuntime
  description: string
  examples: JsonValue[]
  discoverable: boolean
  input?: JsonSchema
  output?: JsonSchema
}

export type PluginCommandInvocationSource = 'agent-cli' | 'plugin'

/** Host-resolved targeting information supplied separately from plugin-owned command input. */
export interface PluginCommandInvocationContext {
  taskId: string | null
  projectId: string | null
  source: PluginCommandInvocationSource
}

export interface CommandRegistration<TInput = unknown, TOutput = unknown> {
  id: string
  title: string
  icon?: string
  shortcut?: CommandShortcutMetadata
  /** Whether this command should appear in user-facing discovery surfaces such as the Command Palette. Defaults to true. */
  discoverable?: boolean
  /** Explicitly opts this command into agent access. Omitted commands are unavailable to agents. */
  agent?: AgentCommandMetadata
  input?: JsonSchema
  output?: JsonSchema
  handler(input: TInput, context: PluginCommandInvocationContext): MaybePromise<TOutput>
}

export interface CommandDescriptor {
  id: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
  title: string
  icon?: string
  shortcut?: CommandShortcutMetadata
  discoverable: boolean
  input?: JsonSchema
  output?: JsonSchema
}

export interface CommandRegistry {
  register<TInput = unknown, TOutput = unknown>(registration: CommandRegistration<TInput, TOutput>): Disposable
  invoke<TOutput = unknown>(id: string, payload?: unknown): Promise<TOutput>
  invokeGlobal<TOutput = unknown>(qualifiedId: string, payload?: unknown): Promise<TOutput>
  /** Plugin-registered commands (this and other enabled plugins). */
  list(): Promise<CommandDescriptor[]>
  /**
   * The host's Claude skills/commands catalog for the given project (skills from
   * `~/.claude`/`.agents`, builtin commands, and plugin-provided commands), as the
   * app's own injectable/autocomplete surfaces see it. Omitting `projectId` (or
   * passing null) yields only project-independent entries. Distinct from `list()`,
   * which returns plugin-registered commands.
   */
  listCatalog(request?: { projectId?: string | null }): Promise<CommandInfo[]>
}

export type EventHandler<TPayload = unknown> = (payload: TPayload) => void

export interface EventRegistry {
  on<TPayload = unknown>(event: string, handler: EventHandler<TPayload>): Disposable
  onGlobal<TPayload = unknown>(qualifiedEvent: string, handler: EventHandler<TPayload>): Disposable
  emit<TPayload = unknown>(event: string, payload: TPayload): Promise<void>
  emitGlobal<TPayload = unknown>(qualifiedEvent: string, payload: TPayload): Promise<void>
}

export type PluginComponent<Props extends Record<string, unknown> = Record<string, unknown>> = Component<Props>
export type PluginComponentModule<Props extends Record<string, unknown> = Record<string, unknown>> = { default: PluginComponent<Props> }
export type PluginComponentLoader<Props extends Record<string, unknown> = Record<string, unknown>> = () => MaybePromise<PluginComponent<Props> | PluginComponentModule<Props>>

export interface PluginViewProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
}

export interface PluginSidebarViewIdentity {
  pluginId: string
  id: string
  qualifiedId: string
  title: string
  icon: PluginIcon
}

export interface PluginSidebarNavigationProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  active: boolean
  collapsed: boolean
  view: PluginSidebarViewIdentity
  onActivate: () => void
}

export interface PluginTaskPaneProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  taskId: string
  projectId: string | null
}

export interface PluginTaskUISectionProps extends PluginTaskPaneProps {
  /** True while the host is running a task-scoped action represented by the section. */
  taskActionPending: boolean
}

export interface PluginSettingsSectionProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
}

/**
 * Inline SVG geometry for a plugin view icon.
 *
 * The host sanitizes the markup, strips root sizing and accessibility metadata,
 * renders it decoratively at the navigation surface's size, and uses the view
 * title as the accessible navigation label. Plugins own the `viewBox`, paths,
 * and paint. Use `currentColor` when the icon should follow host navigation
 * states; literal safe colors remain plugin-owned and do not change with state.
 */
export interface PluginSvgIcon {
  type: 'svg'
  svg: string
}

/** A host-registered icon name or inline SVG geometry. */
export type PluginIcon = string | PluginSvgIcon

export interface PluginViewRegistration {
  id: string
  title: string
  icon: PluginIcon
  /**
   * Where the host surfaces the view's nav entry. `'rail'` (default) places it on
   * the icon rail; `'sidebar'` places it in the left projects sidebar. Either way
   * the view itself is registered and routable by its key.
   */
  placement: 'rail' | 'sidebar'
  order?: number
  shortcut?: string
  component: PluginComponentLoader<PluginViewProps> | PluginComponent<PluginViewProps>
  /** Custom content for a sidebar-placed View's host-owned navigation slot. */
  navigationComponent?:
    | PluginComponentLoader<PluginSidebarNavigationProps>
    | PluginComponent<PluginSidebarNavigationProps>
}

export interface PluginTaskPaneTabRegistration {
  id: string
  title: string
  icon?: string
  order?: number
  component: PluginComponentLoader<PluginTaskPaneProps> | PluginComponent<PluginTaskPaneProps>
}

export interface PluginTaskUISectionRegistration {
  id: string
  order?: number
  component: PluginComponentLoader<PluginTaskUISectionProps> | PluginComponent<PluginTaskUISectionProps>
}

/**
 * Where a settings section is surfaced. `'project'` (the default) renders it on the
 * per-project settings page, scoped to the active project. `'global'` renders it
 * inside the plugin's own card on the global settings page — for configuration that
 * is one value for the whole app (an API key, a credential) rather than per-project.
 */
export type PluginSettingsSectionScope = 'project' | 'global'

export interface PluginSettingsSectionRegistration {
  id: string
  title: string
  order?: number
  /** Defaults to `'project'` when omitted. */
  scope?: PluginSettingsSectionScope
  component: PluginComponentLoader<PluginSettingsSectionProps> | PluginComponent<PluginSettingsSectionProps>
}

/**
 * Props a review-row action receives. `pr` is the review-requested pull request whose row
 * is being rendered, and `projectId` is the local project that owns its repo (null when the
 * host surface has none for it). The same contribution renders once per row, so the host
 * remounts it with a different `pr` rather than handing over the whole list.
 */
export interface PluginReviewRowActionProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  pr: ReviewPullRequest
  projectId: string | null
}

export interface PluginReviewRowActionRegistration {
  id: string
  order?: number
  component: PluginComponentLoader<PluginReviewRowActionProps> | PluginComponent<PluginReviewRowActionProps>
}

export interface FrontendViewRegistry {
  register(registration: PluginViewRegistration): Disposable
}

export interface FrontendReviewUIRegistry {
  /**
   * Contribute a control onto every review-requested pull-request row a host surface shows
   * (today the attention overview). Rows are narrow and there is one per pull request, so
   * keep the component to a chip or a single button and let it fetch its own state.
   */
  registerRowAction(registration: PluginReviewRowActionRegistration): Disposable
}

export type InjectionPointLocation = 'createTaskPrompt' | 'agentSession' | 'backlogPrompt'

export interface PluginInjectionPointProps extends Record<string, unknown> {
  api: FrontendOpenForgeAPI
  context: OpenForgeContextSnapshot
  location: InjectionPointLocation
  projectId: string | null
  taskId: string | null
  onInsert: (text: string) => void
}

export interface PluginInjectionPointRegistration {
  id: string
  location: InjectionPointLocation
  component:
    | PluginComponentLoader<PluginInjectionPointProps>
    | PluginComponent<PluginInjectionPointProps>
}

export interface TaskStartPrefixContext {
  /** The task being started, or null when the caller is authoring a new one. */
  taskId: string | null
  projectId: string | null
}

export interface TaskStartPrefixProviderRegistration {
  id: string
  /** Menu label shown on the surface offering this provider. */
  title: string
  /** Lower sorts first. Defaults to 0. */
  order?: number
  /**
   * Asks the user for a prefix. Returning null means they cancelled, and the
   * task is not started. The host — not the provider — starts the task, so the
   * diverged-branch gate, starting spinner and terminal handling all still run.
   */
  provide(context: TaskStartPrefixContext): MaybePromise<string | null>
}

export interface FrontendTaskStartRegistry {
  registerPrefixProvider(registration: TaskStartPrefixProviderRegistration): Disposable
}

export interface FrontendInjectionPointRegistry {
  register(registration: PluginInjectionPointRegistration): Disposable
}

export interface FrontendTaskUIRegistry {
  registerTab(registration: PluginTaskPaneTabRegistration): Disposable
  registerSection(registration: PluginTaskUISectionRegistration): Disposable
}

/** @deprecated Use `FrontendTaskUIRegistry.registerTab` through `openforge.taskUI`. */
export interface FrontendTaskPaneRegistry {
  registerTab(registration: PluginTaskPaneTabRegistration): Disposable
}

export interface FrontendSettingsRegistry {
  registerSection(registration: PluginSettingsSectionRegistration): Disposable
}

export type BackendReadyState = 'missing' | 'starting' | 'ready' | 'error'

export interface FrontendBackendBridge {
  readonly state: BackendReadyState
  whenReady(): Promise<void>
  onReady(handler: () => void): Disposable
  invoke<TOutput = unknown>(method: string, payload?: unknown): Promise<TOutput>
}

export interface BackendMethodRegistration<TInput = unknown, TOutput = unknown> {
  input?: JsonSchema
  output?: JsonSchema
  handler(input: TInput): MaybePromise<TOutput>
}

export interface BackendMethodRegistry {
  registerMethod<TInput = unknown, TOutput = unknown>(method: string, registration: BackendMethodRegistration<TInput, TOutput>): Disposable
}

export interface BackgroundServiceRegistration {
  id: string
  scope: 'global' | 'project' | 'task'
  start(): MaybePromise<void>
  stop?(): MaybePromise<void>
}

export interface BackgroundServiceRegistry {
  register(registration: BackgroundServiceRegistration): Disposable
}

export interface ProjectScopedFileRequest {
  projectId: string
  path: string
}

export interface FileSystemAPI {
  readDir(request: { projectId: string; path?: string | null }): Promise<FileEntry[]>
  readFile(request: ProjectScopedFileRequest): Promise<FileContent>
  writeFile(request: ProjectScopedFileRequest & { content: string }): Promise<void>
  searchFiles(request: { projectId: string; query: string; limit?: number }): Promise<string[]>
}

export interface UserDataDirectoryRequest {
  path?: string | null
}

export interface UserDataFileRequest {
  path: string
}

export interface UserDataFileWriteRequest extends UserDataFileRequest {
  content: string
}

export interface ExternalReadDirectoryRequest {
  root: string
  path?: string | null
}

export interface ExternalReadFileRequest {
  root: string
  path: string
}

export const DEFAULT_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES = 64 * 1024
export const MIN_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES = 4
export const MAX_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES = 1024 * 1024

/** Applies the default external text chunk size and rejects values outside host limits. */
export function resolveExternalTextFileChunkSize(chunkSizeBytes?: number): number {
  const size = chunkSizeBytes ?? DEFAULT_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES
  if (
    !Number.isInteger(size)
    || size < MIN_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES
    || size > MAX_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES
  ) {
    throw new RangeError(
      `chunkSizeBytes must be an integer between ${MIN_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES} and ${MAX_EXTERNAL_TEXT_FILE_CHUNK_SIZE_BYTES}`,
    )
  }
  return size
}

export interface ExternalReadTextFileChunksRequest extends ExternalReadFileRequest {
  /** UTF-8 chunks contain at most this many bytes. Defaults to 64 KiB. */
  chunkSizeBytes?: number
  /** Stops future reads. An in-flight host read may finish, but its result is discarded. */
  signal?: AbortSignal
}

export interface UserDataFileSystemAPI {
  readDir(request?: UserDataDirectoryRequest): Promise<FileEntry[]>
  readTextFile(request: UserDataFileRequest): Promise<string>
  writeTextFile(request: UserDataFileWriteRequest): Promise<void>
}

export interface ExternalReadFileSystemAPI {
  readDir(request: ExternalReadDirectoryRequest): Promise<FileEntry[]>
  readTextFile(request: ExternalReadFileRequest): Promise<string>
  /** Lazily reads a UTF-8 file without retaining a host file handle between chunks. */
  readTextFileChunks(request: ExternalReadTextFileChunksRequest): AsyncIterable<string>
}

export interface BackendFileSystemAPI extends FileSystemAPI {
  userData: UserDataFileSystemAPI
  external: ExternalReadFileSystemAPI
}

export type TerminalImageProtocol = 'iterm2'

export interface ShellSessionRequest {
  taskId: string
  terminalIndex: number
}

export interface ShellSpawnRequest extends ShellSessionRequest {
  cwd: string
  cols: number
  rows: number
  terminalImageProtocol?: TerminalImageProtocol | null
}

export interface ShellWriteRequest extends ShellSessionRequest {
  data: string
}

export interface ShellTerminalQueryResponseRequest extends ShellSessionRequest {
  ptyInstanceId: number
  data: string
}

export interface ShellResizeRequest extends ShellSessionRequest {
  cols: number
  rows: number
}

export interface TerminalViewSnapshot {
  instanceId: number
  watermark: number
  data: string
}

export interface PtyBufferState {
  authority?: 'xterm-authoritative' | 'ghostty-authoritative'
  buffer: string | null
  snapshot?: TerminalViewSnapshot | null
  isLive: boolean
  instanceId: number | null
}

export interface ShellAPI {
  spawn(request: ShellSpawnRequest): Promise<number>
  write(request: ShellWriteRequest): Promise<void>
  writeTerminalQueryResponse(request: ShellTerminalQueryResponseRequest): Promise<void>
  resize(request: ShellResizeRequest): Promise<void>
  kill(request: ShellSessionRequest): Promise<void>
  getBuffer(request: ShellSessionRequest): Promise<PtyBufferState>
}

export interface CreateTaskRequest {
  initialPrompt: string
  projectId: string
  dependsOn?: string[]
  labelNames?: string[]
}

export interface ComposeTaskRequest {
  projectId: string
  /** Seeds the dialog's prompt field; the user edits it before saving. */
  initialPrompt: string
  sourceTicketUrl?: string | null
  title?: string | null
}

export interface ComposeTaskResult {
  task: Task
  /** True when the user chose Start Task rather than plain Create. */
  started: boolean
}

export interface StartPromptContribution {
  /** Host-assigned identity of the plugin that owns this persisted contribution. */
  readonly ownerPluginId?: string
  id: string
  enabled: boolean
  /**
   * Prompt text injected before OpenForge's task prompt.
   * The host substitutes {{taskId}} and {{task_id}}.
   */
  content: string
  /** Lower values are injected first. Defaults to 0. */
  order?: number
}

export interface ConfigureStartPromptContributionRequest extends StartPromptContribution {
  projectId: string
}

export interface StartTaskImplementationRequest {
  taskId: string
}

export interface ImplementationRun {
  taskId: string
  sessionId: string
  workspacePath: string
}
export type TaskFollowUpDisposition = 'delivered' | 'queued'

export interface SendTaskFollowUpRequest {
  taskId: string
  message: string
}

export interface TaskFollowUpReceipt {
  taskId: string
  sessionId: string
  disposition: TaskFollowUpDisposition
}

export type TaskFollowUpErrorCode = 'NO_SESSION' | 'DELIVERY_FAILED'

export class TaskFollowUpError extends Error {
  readonly code: TaskFollowUpErrorCode

  constructor(code: TaskFollowUpErrorCode, message: string) {
    super(message)
    this.name = 'TaskFollowUpError'
    this.code = code
  }
}

export interface TasksAPI {
  /**
   * Lists tasks, optionally scoped to a project. By default done tasks are
   * excluded (matching the app board's active-only view); pass
   * `includeDone: true` to include tasks in the terminal `done` state. The
   * unscoped listing (no `projectId`) always returns all states, so
   * `includeDone` only affects the project-scoped path.
   */
  list(request?: { projectId?: string | null; includeDone?: boolean }): Promise<Task[]>
  get(taskId: string): Promise<Task | null>
  create(request: CreateTaskRequest): Promise<Task>
  /**
   * Opens the host's create-task dialog pre-filled, letting the user edit the
   * prompt — including anything contributed at that injection point —
   * before the task exists.
   * Resolves null if they dismiss it.
   */
  compose(request: ComposeTaskRequest): Promise<ComposeTaskResult | null>
  updateStatus(taskId: string, status: WritableBoardStatus): Promise<void>
  listStartPromptContributions(projectId: string): Promise<StartPromptContribution[]>
  configureStartPromptContribution(request: ConfigureStartPromptContributionRequest): Promise<StartPromptContribution[]>
  startImplementation(request: StartTaskImplementationRequest): Promise<ImplementationRun>
  sendFollowUp(request: SendTaskFollowUpRequest): Promise<TaskFollowUpReceipt>
  getWorkspace(taskId: string): Promise<TaskWorkspaceInfo | null>
  getLatestSession(taskId: string): Promise<AgentSession | null>
}

export interface ProjectsAPI {
  list(): Promise<Project[]>
  get(projectId: string): Promise<Project | null>
}

export type NotificationRequest = {
  title: string
  body?: string
  [key: string]: JsonValue | undefined
}

export interface NotificationsAPI {
  notify(request: NotificationRequest): Promise<void>
}

export interface AttentionAPI {
  listProjects(): Promise<ProjectAttention[]>
}

export interface SystemAPI {
  openUrl(url: string): Promise<void>
  writeClipboardText(text: string): Promise<void>
}

export interface KeyValueConfigAPI {
  get<T extends JsonValue = JsonValue>(key: string, projectId?: string): Promise<T | null>
  set<T extends JsonValue = JsonValue>(key: string, value: T, projectId?: string): Promise<void>
}

export interface OpenForgeCommonAPI {
  commands: CommandRegistry
  events: EventRegistry
  storage: PluginStorage
  context: {
    getSnapshot(): OpenForgeContextSnapshot
  }
  tasks: TasksAPI
  projects: ProjectsAPI
  fs: FileSystemAPI
  shell: ShellAPI
  notifications: NotificationsAPI
  attention: AttentionAPI
  system: SystemAPI
  config: KeyValueConfigAPI
  projectConfig: KeyValueConfigAPI
}

export interface FrontendOpenForgeAPI extends OpenForgeCommonAPI {
  browserSurfaces: BrowserSurfacesAPI
  navigation: NavigationAPI
  views: FrontendViewRegistry
  taskUI: FrontendTaskUIRegistry
  reviewUI: FrontendReviewUIRegistry
  /** @deprecated Use `taskUI.registerTab(...)`. */
  taskPane: FrontendTaskPaneRegistry
  settings: FrontendSettingsRegistry
  backend: FrontendBackendBridge
  injectionPoints: FrontendInjectionPointRegistry
  taskStart: FrontendTaskStartRegistry
}

export interface BackendOpenForgeAPI extends OpenForgeCommonAPI {
  fs: BackendFileSystemAPI
  backend: BackendMethodRegistry
  background: BackgroundServiceRegistry
}

export interface FrontendPlugin {
  activate(openforge: FrontendOpenForgeAPI, context: FrontendPluginContext): MaybePromise<void>
}

export interface BackendPlugin {
  activate(openforge: BackendOpenForgeAPI, context: BackendPluginContext): MaybePromise<void>
}

export type PluginViewKey = `plugin:${string}:${string}`

export function makePluginViewKey(pluginId: string, viewId: string): PluginViewKey {
  return `plugin:${pluginId}:${viewId}`
}

export function isPluginViewKey(value: string): value is PluginViewKey {
  return value.startsWith('plugin:') && value.match(/^plugin:[^:]+:[^:]+$/) !== null
}

export function parsePluginViewKey(key: PluginViewKey): { pluginId: string; viewId: string } {
  const parts = key.split(':')
  return { pluginId: parts[1], viewId: parts[2] }
}
