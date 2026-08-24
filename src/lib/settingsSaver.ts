import { saveFocusFilterStates } from './boardFilters'
import { setConfig, setProjectConfig, updateProject } from './ipc'
import { RUN_COMMAND_CONFIG_KEY } from './runAppCommand'
import { normalizeGitHubPollIntervalSeconds } from './settingsConfig'
import type { TaskState } from './taskState'

export interface ProjectSettingsSavePayload {
  projectId: string
  projectName: string
  projectPath: string
  agentInstructions: string
  runCommand: string
  focusFilterStates: TaskState[]
}

export interface GlobalSettingsSavePayload {
  taskIdPrefix?: string
  githubToken?: string
  codeCleanupTasksEnabled?: boolean
  taskDisplayTitleMetadataUpdatesEnabled?: boolean
  ghosttyTerminalStateEnabled?: boolean
  githubPollInterval?: number
  useWorktrees?: boolean
  aiProvider?: string
  walkthroughPrompt?: string
}

export async function saveProjectSettings(payload: ProjectSettingsSavePayload): Promise<void> {
  // `ai_provider` and `use_worktrees` inherit from global defaults and are owned
  // exclusively by the Configuration card's immediate per-key write path
  // (handleProjectSettingChange -> setProjectConfig). They are intentionally not
  // written here so exactly one path persists them, avoiding a debounced-vs-immediate race.
  await updateProject(payload.projectId, payload.projectName, payload.projectPath)
  await setProjectConfig(payload.projectId, 'additional_instructions', payload.agentInstructions)
  await setProjectConfig(payload.projectId, RUN_COMMAND_CONFIG_KEY, payload.runCommand)
  await saveFocusFilterStates(payload.projectId, payload.focusFilterStates)
}

export async function saveGlobalSettings(payload: GlobalSettingsSavePayload): Promise<void> {
  if (payload.taskIdPrefix !== undefined) await setConfig('task_id_prefix', payload.taskIdPrefix)
  if (payload.githubToken !== undefined) await setConfig('github_token', payload.githubToken)
  if (payload.codeCleanupTasksEnabled !== undefined) {
    await setConfig('code_cleanup_tasks_enabled', payload.codeCleanupTasksEnabled ? 'true' : 'false')
  }
  if (payload.taskDisplayTitleMetadataUpdatesEnabled !== undefined) {
    await setConfig('task_display_title_metadata_updates_enabled', payload.taskDisplayTitleMetadataUpdatesEnabled ? 'true' : 'false')
  }
  if (payload.ghosttyTerminalStateEnabled !== undefined) {
    await setConfig('ghostty_terminal_state_enabled', payload.ghosttyTerminalStateEnabled ? 'true' : 'false')
  }
  if (payload.githubPollInterval !== undefined) {
    await setConfig('github_poll_interval', String(normalizeGitHubPollIntervalSeconds(payload.githubPollInterval)))
  }
  if (payload.useWorktrees !== undefined) await setConfig('use_worktrees', payload.useWorktrees ? 'true' : 'false')
  if (payload.aiProvider !== undefined) await setConfig('ai_provider', payload.aiProvider)
  if (payload.walkthroughPrompt !== undefined) await setConfig('pr_walkthrough_prompt', payload.walkthroughPrompt)
}
