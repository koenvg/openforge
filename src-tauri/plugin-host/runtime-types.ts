import type {
  CommandRegistration,
  OpenForgeContextChangeHandler,
  OpenForgePackageMetadata,
  PluginCommandInvocationContext,
  PluginStorage,
  SubscriptionSink,
} from '@openforge-app/plugin-sdk'
import type {
  BackendMethodRegistration,
  BackgroundServiceRegistration,
} from '@openforge-app/plugin-sdk/backend'

export type JsonRpcId = number | null | undefined

export type JsonRpcRequest = {
  jsonrpc?: string
  id?: JsonRpcId
  method?: string
  params?: {
    pluginId?: string
    command?: string
    commandId?: string
    backendPath?: string
    projectId?: string | null
    preserveActivation?: boolean
    packageMetadata?: OpenForgePackageMetadata
    payload?: unknown
    input?: unknown
    context?: unknown
    [key: string]: unknown
  }
}

export type JsonRpcResponse = {
  jsonrpc: '2.0'
  id: JsonRpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export type BackendReadyState = 'missing' | 'starting' | 'ready' | 'error'

export type BackendStateSnapshot = {
  pluginId: string
  state: BackendReadyState
  ready: boolean
  error: string | null
  methods: string[]
  backgroundServices: string[]
  crashLoopGuardTripped: boolean
}


export type PluginLifecycleDiagnostics = {
  pluginId: string
  state: BackendReadyState
  active: boolean
  activationCount: number
  reloadCount: number
}

export type PluginHostProcessDiagnostics = {
  memoryUsage: {
    rssBytes: number
    heapTotalBytes: number
    heapUsedBytes: number
    externalBytes: number
    arrayBuffersBytes: number
  }
  plugins: PluginLifecycleDiagnostics[]
  pluginCount: number
  pluginsTruncated: boolean
}
export type HostCallbackRequest = {
  method: string
  params: Record<string, unknown>
}
export type HostCallbackOptions = {
  signal?: AbortSignal
}

export type HostCallbackHandler = (
  request: HostCallbackRequest,
  options?: HostCallbackOptions,
) => Promise<unknown> | unknown

export type RuntimeOptions = {
  crashLoopLimit?: number
  crashLoopWindowMs?: number
  hostCallbacks?: HostCallbackHandler
  externalTextFileReadTimeoutMs?: number
}

export type ActivateBackendInput = {
  pluginId: string
  backendPath: string
  projectId?: string | null
  packageMetadata?: OpenForgePackageMetadata
}

export type ReadyBackendInput = {
  pluginId: string
  backendPath?: string
  projectId?: string | null
  preserveActivation?: boolean
  packageMetadata?: OpenForgePackageMetadata
}

export type InvokeBackendInput = {
  pluginId: string
  command: string
  backendPath?: string
  projectId?: string | null
  packageMetadata?: OpenForgePackageMetadata
  payload?: unknown
}

export type InvokeAgentCommandInput = ReadyBackendInput & {
  commandId: string
  input?: unknown
  context: PluginCommandInvocationContext
}

export type RuntimeBackendService = BackgroundServiceRegistration & {
  localId: string
  qualifiedId: string
  started: boolean
}

export type RuntimeBackendMethod = BackendMethodRegistration & {
  localId: string
  qualifiedId: string
}

export type RuntimeBackendCommand = CommandRegistration & {
  localId: string
  qualifiedId: string
  pluginId: string
  projectId: string | null
}

export type RuntimeEventHandler = (payload: unknown) => void

export type RuntimePluginState = {
  pluginId: string
  backendPath: string | null
  projectId: string | null
  packageMetadata: OpenForgePackageMetadata
  state: BackendReadyState
  error: Error | null
  activationPromise: Promise<void> | null
  deactivationPromise: Promise<void> | null
  activationGeneration: number
  activationCount: number
  reloadCount: number
  module: Record<string, unknown> | null
  releaseModule: (() => void) | null
  methods: Map<string, RuntimeBackendMethod>
  commands: Map<string, RuntimeBackendCommand>
  eventHandlers: Map<string, Set<RuntimeEventHandler>>
  contextChangeHandlers: Set<OpenForgeContextChangeHandler>
  backgroundServices: Map<string, RuntimeBackendService>
  storage: PluginStorage
  subscriptions: SubscriptionSink & { disposeAll(): Promise<void> }
  crashTimestamps: number[]
  crashLoopGuardTripped: boolean
}
