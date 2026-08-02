import { FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND } from './frontendHostRequestProtocol.js'
import { developerLogStore } from './developerLogs.js'
import { openExternalUrl, openPathInEditor } from './shellCommands.js'
import type { DeveloperLogEntry, DeveloperLogSnapshot } from './developerLogs.js'
import type { SidecarLaunchConfig } from './sidecar.js'

export interface ElectronInvokeRequest {
  command?: unknown
  payload?: unknown
}

export interface BridgeResponseLike {
  ok: boolean
  status?: number
  json(): Promise<unknown>
  text?(): Promise<string>
}

export type BridgeFetch = (url: string, init: {
  method: 'POST'
  headers: Record<string, string>
  body: string
}) => Promise<BridgeResponseLike>

export type OpenExternal = (url: string) => Promise<void>
export type QuitApp = () => void | Promise<void>
export type WriteClipboardText = (text: string) => void | Promise<void>
export type SelectDirectory = (options: {
  defaultPath?: string
  buttonLabel?: string
  message?: string
}) => Promise<string | null>
export type GetDeveloperLogs = (limit?: number) => DeveloperLogEntry[]
export type GetDeveloperLogSnapshot = (limit?: number) => DeveloperLogSnapshot

export interface ElectronInvokeDeps {
  sidecarConfig: SidecarLaunchConfig | null
  fetch: BridgeFetch
  openExternal: OpenExternal
  quitApp?: QuitApp
  writeClipboardText?: WriteClipboardText
  selectDirectory?: SelectDirectory
  getDeveloperLogs?: GetDeveloperLogs
  getDeveloperLogSnapshot?: GetDeveloperLogSnapshot
}

const SIDECAR_BACKED_COMMANDS = new Set([
  'create_task',
  'update_task',
  'update_task_title',
  'update_task_source_ticket_url',
  'update_task_status',
  'delete_task',
  'list_browser_session_purge_intents',
  'acknowledge_browser_session_purge_intent',
  'get_tasks',
  'get_task_detail',
  'get_tasks_for_project',
  'get_project_task_labels',
  'create_task_label',
  'add_task_label',
  'remove_task_label',
  'delete_task_label',
  'get_task_workspace',
  'get_worktree_for_task',
  'list_git_branches',
  'repo_has_commits',
  'inspect_existing_branch',
  'create_project',
  'create_project_from_git',
  'create_project_from_new_repo',
  'get_projects',
  'get_project_attention',
  'get_task_attention',
  'update_project',
  'delete_project',
  'get_project_config',
  'resolve_ai_provider',
  'set_project_config',
  'clear_project_config',
  'reset_project_settings_to_global',
  'get_config',
  'set_config',
  'get_companion_gateway_status',
  'set_companion_gateway_enabled',
  'set_companion_tailscale_hostname',
  'start_companion_pairing',
  'get_companion_pairing_status',
  'cancel_companion_pairing',
  'approve_companion_pairing',
  'reject_companion_pairing',
  'list_companion_devices',
  'revoke_companion_device',
  'remove_companion_device',
  'reset_companion_host_identity',
  'get_task_config',
  'set_task_config',
  'get_app_mode',
  'get_git_branch',
  'check_opencode_installed',
  'check_pi_installed',
  'check_codex_installed',
  'check_grok_installed',
  'check_claude_installed',
  'get_latest_session',
  'get_latest_sessions',
  'get_session_status',
  'abort_session',
  'resume_startup_sessions',
  'start_implementation',
  'finalize_agent_session',
  'send_agent_follow_up',
  'pty_spawn_shell',
  'pty_write',
  'pty_resize',
  'pty_kill',
  'pty_kill_shells_for_task',
  'get_pty_buffer',
  'force_github_sync',
  'refresh_task_github_status',
  'set_poll_context',
  'get_project_repo',
  'check_github_issues_ready',
  'get_pull_requests',
  'link_pull_request',
  'get_pr_comments',
  'mark_comment_addressed',
  'merge_task_pull_request',
  'enqueue_task_pull_request',
  'get_github_username',
  'fetch_review_prs',
  'get_review_prs',
  'mark_review_pr_viewed',
  'mark_review_pr_unviewed',
  'get_pr_file_diffs',
  'get_file_content',
  'get_file_content_base64',
  'get_file_at_ref',
  'get_file_at_ref_base64',
  'get_review_comments',
  'get_pr_overview_comments',
  'submit_pr_review',
  'fetch_authored_prs',
  'get_authored_prs',
  'fs_read_dir',
  'fs_read_file',
  'fs_write_file',
  'fs_search_files',
  'get_task_diff',
  'get_task_git_status',
  'get_task_file_contents',
  'get_task_batch_file_contents',
  'add_self_review_comment',
  'get_active_self_review_comments',
  'get_archived_self_review_comments',
  'delete_self_review_comment',
  'archive_self_review_comments',
  'get_task_commits',
  'get_commit_diff',
  'get_commit_file_contents',
  'get_commit_batch_file_contents',
  'get_agent_review_comments',
  'update_agent_review_comment_status',
  'get_pr_walkthrough',
  'start_agent_walkthrough',
  'abort_agent_walkthrough',
  'delete_pr_walkthrough',
  'list_opencode_commands',
  'search_opencode_files',
  'list_opencode_agents',
  'list_opencode_models',
  'register_builtin_plugin',
  'scan_plugin_folder',
  'install_plugin_from_local',
  'install_plugin_from_npm',
  'install_plugin_from_git',
  'install_plugin_from_source',
  'uninstall_plugin',
  'get_plugin',
  'list_plugins',
  'set_plugin_enabled',
  'get_enabled_plugins',
  'set_app_plugin_enabled',
  'get_enabled_app_plugins',
  'set_global_plugin_default',
  'get_global_plugin_defaults',
  'get_plugin_storage',
  'set_plugin_storage',
  'delete_plugin_storage',
  FRONTEND_HOST_REQUEST_ACKNOWLEDGE_COMMAND,
  'plugin_invoke',
  'plugin_backend_deactivate',
  'plugin_backend_when_ready',
  'stop_plugin_sidecar',
  'transcribe_audio',
  'get_whisper_model_status',
  'download_whisper_model',
  'get_all_whisper_model_statuses',
  'set_whisper_model',
])

export function isSidecarBackedCommand(command: string): boolean {
  return SIDECAR_BACKED_COMMANDS.has(command)
}

function commandFromRequest(request: ElectronInvokeRequest): string {
  if (typeof request !== 'object' || request === null || typeof request.command !== 'string') {
    throw new Error('invalid Open Forge IPC request')
  }
  return request.command
}

async function responseError(response: BridgeResponseLike): Promise<Error> {
  const detail = response.text ? await response.text() : `HTTP ${response.status ?? 'error'}`
  return new Error(`Rust sidecar command failed: ${detail}`)
}

async function forwardToSidecar(command: string, payload: unknown, deps: ElectronInvokeDeps): Promise<unknown> {
  if (!deps.sidecarConfig) {
    throw new Error('Rust sidecar is not available')
  }

  const response = await deps.fetch(`http://${deps.sidecarConfig.host}:${deps.sidecarConfig.port}/app/invoke`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${deps.sidecarConfig.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ command, payload: payload ?? null }),
  })

  if (!response.ok) {
    throw await responseError(response)
  }

  const body = await response.json()
  return typeof body === 'object' && body !== null && 'value' in body
    ? (body as { value: unknown }).value
    : body
}

function payloadString(payload: unknown, key: string): string | null {
  if (typeof payload !== 'object' || payload === null) return null
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.trim() !== '' ? value : null
}

function payloadNumber(payload: unknown, key: string): number | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function isRepositoryAccessFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('Cannot access repository path')
    || message.includes('Unable to read current working directory: Operation not permitted')
}

function normalizeSelectedPath(path: string): string {
  const trimmed = path.trim()
  const withoutTrailingSeparators = trimmed.replace(/[\\/]+$/u, '')
  return withoutTrailingSeparators || trimmed
}

async function promptForRepositoryAccessAndRetry(
  command: string,
  payload: unknown,
  deps: ElectronInvokeDeps,
  originalError: unknown,
): Promise<unknown> {
  const repoPath = payloadString(payload, 'repoPath')
  if (command !== 'start_implementation' || !repoPath || !deps.selectDirectory || !isRepositoryAccessFailure(originalError)) {
    throw originalError
  }

  const selectedPath = await deps.selectDirectory({
    defaultPath: repoPath,
    buttonLabel: 'Grant Access',
    message: 'OpenForge needs permission to access this repository folder before it can create a worktree.',
  })

  if (!selectedPath) {
    throw originalError
  }

  if (normalizeSelectedPath(selectedPath) !== normalizeSelectedPath(repoPath)) {
    throw new Error('Selected repository folder does not match the active project path. Update the project path first if you want to use a different repository.')
  }

  return forwardToSidecar(command, { ...(payload as Record<string, unknown>), repoPath: selectedPath }, deps)
}

export async function handleElectronInvoke(request: ElectronInvokeRequest, deps: ElectronInvokeDeps): Promise<unknown> {
  const command = commandFromRequest(request)
  const payload = request.payload ?? null

  if (command === 'open_url') {
    const url = typeof (payload as { url?: unknown } | null)?.url === 'string'
      ? (payload as { url: string }).url
      : null
    if (!url) throw new Error('open_url requires a url payload')
    return openExternalUrl(url, deps.openExternal)
  }

  if (command === 'open_in_editor') {
    const path = typeof (payload as { path?: unknown } | null)?.path === 'string'
      ? (payload as { path: string }).path
      : null
    if (!path) throw new Error('open_in_editor requires a path payload')
    return openPathInEditor(path, deps.openExternal)
  }

  if (command === 'quit_app') {
    if (!deps.quitApp) throw new Error('quit_app is not available')
    await deps.quitApp()
    return undefined
  }

  if (command === 'write_clipboard_text') {
    if (!deps.writeClipboardText) throw new Error('write_clipboard_text is not available')
    const text = payloadString(payload, 'text')
    if (!text) throw new Error('write_clipboard_text requires a text payload')
    await deps.writeClipboardText(text)
    return undefined
  }

  if (command === 'select_directory') {
    if (!deps.selectDirectory) throw new Error('select_directory is not available')
    return deps.selectDirectory({
      defaultPath: payloadString(payload, 'defaultPath') ?? undefined,
      buttonLabel: payloadString(payload, 'buttonLabel') ?? undefined,
      message: payloadString(payload, 'message') ?? undefined,
    })
  }

  if (command === 'get_developer_log_snapshot') {
    const getDeveloperLogSnapshot = deps.getDeveloperLogSnapshot ?? ((limit?: number) => developerLogStore.getSnapshot(limit))
    return getDeveloperLogSnapshot(payloadNumber(payload, 'limit'))
  }

  if (command === 'get_developer_logs') {
    const getDeveloperLogs = deps.getDeveloperLogs ?? ((limit?: number) => developerLogStore.getRecentLogs(limit))
    return getDeveloperLogs(payloadNumber(payload, 'limit'))
  }

  if (isSidecarBackedCommand(command)) {
    try {
      return await forwardToSidecar(command, payload, deps)
    } catch (error) {
      return promptForRepositoryAccessAndRetry(command, payload, deps, error)
    }
  }

  throw new Error(`Electron backend bridge is not implemented for command: ${command}`)
}
