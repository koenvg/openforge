import {
  desktopCommandContracts as generatedDesktopCommandContracts,
  desktopCommandOwnershipContracts as generatedDesktopCommandOwnershipContracts,
} from '../electron/generatedDesktopIpcRegistry.js'
import type { AgentEvent, PollResult } from './types'

export type AgentStatusChangedKind = 'started' | 'became_busy' | 'became_idle' | 'requested_permission' | 'failed' | 'ended'

export type DesktopCommandOwner = 'rust-sidecar' | 'electron-main'

export type DesktopIpcDomain =
  | 'agent-session-pty'
  | 'app-shell'
  | 'config'
  | 'files-review'
  | 'github-review'
  | 'misc'
  | 'plugins'
  | 'tasks-projects'
  | 'whisper-audio'

export interface DesktopCommandContract {
  functionName: string
  ipcCommand: string
  payloadKeys: readonly string[]
  owner: DesktopCommandOwner
  domain: DesktopIpcDomain
}

export type DesktopCommandOwnershipContract = Pick<
  DesktopCommandContract,
  'ipcCommand' | 'owner' | 'domain'
>

export interface TaskPullRequestUpdatedPayload {
  task_id: string
  pr_id: number
  action: 'merged' | 'enqueued'
}

export interface AppEventsGapPayload {
  requestedAfter: string
  oldestAvailable: string
  newestAvailable: string
}

export interface ReviewStatusChangedPayload {
  task_id: string
  project_id: string | null
  pr_id: number
  pr_title: string
  review_status: string
  timestamp: number
}

export interface ActionCompletePayload {
  task_id: string
}

export interface ImplementationFailedPayload {
  task_id: string
  error: string
}

export interface SessionResumedPayload {
  task_id: string
  workspace_path: string
  pty_instance_id?: number | null
}

export interface NewPrCommentPayload {
  ticket_id: string
  comment_id: number
}

export interface CiStatusChangedPayload {
  task_id: string
  project_id?: string | null
  pr_id: number
  pr_title: string
  ci_status: string
  timestamp: number
}

export interface SessionAbortedPayload {
  ticket_id: string
  session_id: string
}

export interface AgentStatusChangedPayload {
  task_id: string
  status: string
  provider?: string
  kind?: AgentStatusChangedKind | null
  pty_instance_id?: number | null
  raw_event_type?: string | null
  raw_status_type?: string | null
}

export interface AgentPtyExitedPayload {
  task_id: string
  success: boolean
  instance_id: number
}

export interface GithubRateLimitedPayload {
  reset_at: number | null
}

export interface OpenUrlEventPayload {
  url: string
}

export interface WriteClipboardTextEventPayload {
  text: string
}

export interface PluginInstallationChangedPayload {
  plugin_id: string
}

export interface AppPluginEnablementChangedPayload {
  plugin_id: string
  enabled: boolean
}

export interface ProjectPluginEnablementChangedPayload {
  plugin_id: string
  project_id: string
  enabled: boolean
}

export interface PluginReloadRequestedPayload {
  plugin_id: string
  project_id?: string | null
}

export interface TaskChangedPayload {
  action: 'created' | 'updated' | 'deleted'
  task_id: string
  project_id?: string | null
}

export interface AppDesktopEventPayloads {
  'github-sync-complete': PollResult
  'task-pull-request-updated': TaskPullRequestUpdatedPayload
  'openforge-app-events-gap': AppEventsGapPayload
  'review-status-changed': ReviewStatusChangedPayload
  'action-complete': ActionCompletePayload
  'implementation-failed': ImplementationFailedPayload
  'session-resumed': SessionResumedPayload
  'startup-resume-complete': void
  'new-pr-comment': NewPrCommentPayload
  'comment-addressed': void
  'ci-status-changed': CiStatusChangedPayload
  'agent-event': AgentEvent
  'session-aborted': SessionAbortedPayload
  'agent-status-changed': AgentStatusChangedPayload
  'agent-pty-exited': AgentPtyExitedPayload
  'review-pr-count-changed': number
  'authored-prs-updated': void
  'github-rate-limited': GithubRateLimitedPayload
  'plugin-frontend-command-request': unknown
  'openforge.open-url': OpenUrlEventPayload
  'openforge.write-clipboard-text': WriteClipboardTextEventPayload
  'plugin-installation-changed': PluginInstallationChangedPayload
  'app-plugin-enablement-changed': AppPluginEnablementChangedPayload
  'project-plugin-enablement-changed': ProjectPluginEnablementChangedPayload
  'plugin-reload-requested': PluginReloadRequestedPayload
  'task-changed': TaskChangedPayload
}

export type AppDesktopEventName = keyof AppDesktopEventPayloads

export interface WhisperDownloadProgressPayload {
  model_size: string
  bytes_downloaded: number
  total_bytes: number
  percentage: number
}

export interface AdditionalDesktopEventPayloads {
  'whisper-download-progress': WhisperDownloadProgressPayload
}

export type TerminalDesktopEventName =
  | `pty-output-${string}`
  | `pty-model-output-${string}`
  | `pty-model-disabled-${string}`
  | `pty-exit-${string}`
  | 'openforge-app-events-reconnected'

export interface TerminalDesktopEventPayloads {
  output: { shell_session_key: string; data: string; instance_id: number }
  modelOutput: { data: string; instance_id: number; start_sequence: number; sequence: number }
  modelDisabled: { instance_id: number }
  exit: { instance_id: number }
  connectionRestored: { attempt: number; reconnectedAt: string }
}

export type TerminalDesktopEventPayload<TEventName extends TerminalDesktopEventName> =
  TEventName extends `pty-output-${string}`
    ? TerminalDesktopEventPayloads['output']
    : TEventName extends `pty-model-output-${string}`
      ? TerminalDesktopEventPayloads['modelOutput']
      : TEventName extends `pty-model-disabled-${string}`
        ? TerminalDesktopEventPayloads['modelDisabled']
        : TEventName extends `pty-exit-${string}`
          ? TerminalDesktopEventPayloads['exit']
          : TerminalDesktopEventPayloads['connectionRestored']

export type KnownDesktopEventName =
  | AppDesktopEventName
  | keyof AdditionalDesktopEventPayloads
  | TerminalDesktopEventName

export type KnownDesktopEventPayload<TEventName extends KnownDesktopEventName> =
  TEventName extends AppDesktopEventName
    ? AppDesktopEventPayloads[TEventName]
    : TEventName extends keyof AdditionalDesktopEventPayloads
      ? AdditionalDesktopEventPayloads[TEventName]
      : TEventName extends TerminalDesktopEventName
        ? TerminalDesktopEventPayload<TEventName>
        : never
export const desktopCommandContracts =
  generatedDesktopCommandContracts satisfies readonly DesktopCommandContract[]

export const desktopCommandOwnershipContracts =
  generatedDesktopCommandOwnershipContracts satisfies readonly DesktopCommandOwnershipContract[]
