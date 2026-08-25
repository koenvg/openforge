import { fromStore } from 'svelte/store'
import { DEFAULT_GITHUB_POLL_INTERVAL_SECONDS, loadGlobalSettings, parseGitHubPollIntervalSeconds } from '../../lib/settingsConfig'
import { DEFAULT_PR_WALKTHROUGH_PROMPT } from '../../lib/prWalkthroughPrompt'
import type { GlobalSettingsSavePayload } from '../../lib/settingsSaver'
import { codeCleanupTasksEnabled, error } from '../../lib/stores'

// `pr_walkthrough_prompt` lives in the Agents section only, mirroring project settings.
// Every other global section excludes it so the long prompt is not rendered three times.
export const GLOBAL_GENERAL_EXCLUDE_KEYS = ['ai_provider', 'github_poll_interval', 'plugins', 'pr_walkthrough_prompt']
export const PROVIDER_ONLY_EXCLUDE_KEYS = [
  'code_cleanup_tasks_enabled',
  'task_display_title_metadata_updates_enabled',
  'use_worktrees',
  'task_id_prefix',
  'github_poll_interval',
  'plugins',
]
export const GITHUB_ONLY_EXCLUDE_KEYS = [
  'code_cleanup_tasks_enabled',
  'task_display_title_metadata_updates_enabled',
  'ai_provider',
  'use_worktrees',
  'task_id_prefix',
  'plugins',
  'pr_walkthrough_prompt',
]

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsGlobalController() {
  const codeCleanupTasksEnabledState = fromStore(codeCleanupTasksEnabled)

  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)
  let useWorktrees = $state(true)
  let aiProvider = $state('claude-code')
  let walkthroughPrompt = $state(DEFAULT_PR_WALKTHROUGH_PROMPT)
  let loaded = $state(false)
  let loadError = $state<string | null>(null)
  let isCodeCleanupTasksEnabled = $state(codeCleanupTasksEnabledState.current)
  let isTaskDisplayTitleMetadataUpdatesEnabled = $state(false)
  let isGhosttyTerminalStateEnabled = $state(false)

  const hierarchyValues = $derived<Record<string, string>>({
    code_cleanup_tasks_enabled: isCodeCleanupTasksEnabled ? 'true' : 'false',
    task_display_title_metadata_updates_enabled: isTaskDisplayTitleMetadataUpdatesEnabled ? 'true' : 'false',
    ai_provider: aiProvider,
    use_worktrees: useWorktrees ? 'true' : 'false',
    task_id_prefix: taskIdPrefix,
    github_poll_interval: String(githubPollInterval),
    pr_walkthrough_prompt: walkthroughPrompt,
  })

  async function load(): Promise<void> {
    try {
      const settings = await loadGlobalSettings()
      taskIdPrefix = settings.taskIdPrefix
      githubToken = settings.githubToken
      isCodeCleanupTasksEnabled = settings.codeCleanupTasksEnabled
      codeCleanupTasksEnabled.set(isCodeCleanupTasksEnabled)
      isTaskDisplayTitleMetadataUpdatesEnabled = settings.taskDisplayTitleMetadataUpdatesEnabled
      isGhosttyTerminalStateEnabled = settings.ghosttyTerminalStateEnabled
      githubPollInterval = settings.githubPollInterval
      useWorktrees = settings.useWorktrees
      aiProvider = settings.aiProvider
      walkthroughPrompt = settings.walkthroughPrompt
      loaded = true
    } catch (value) {
      loadError = getErrorMessage(value)
      error.set(loadError)
    }
  }

  function setGithubToken(value: string): GlobalSettingsSavePayload {
    githubToken = value
    return { githubToken: value }
  }

  function setGhosttyTerminalState(enabled: boolean): GlobalSettingsSavePayload {
    isGhosttyTerminalStateEnabled = enabled
    return { ghosttyTerminalStateEnabled: enabled }
  }

  function applySettingChange(key: string, value: string): GlobalSettingsSavePayload | undefined {
    switch (key) {
      case 'code_cleanup_tasks_enabled':
        isCodeCleanupTasksEnabled = value === 'true'
        codeCleanupTasksEnabled.set(isCodeCleanupTasksEnabled)
        return { codeCleanupTasksEnabled: isCodeCleanupTasksEnabled }
      case 'task_display_title_metadata_updates_enabled':
        isTaskDisplayTitleMetadataUpdatesEnabled = value === 'true'
        return { taskDisplayTitleMetadataUpdatesEnabled: isTaskDisplayTitleMetadataUpdatesEnabled }
      case 'ai_provider':
        aiProvider = value
        return { aiProvider }
      case 'use_worktrees':
        useWorktrees = value === 'true'
        return { useWorktrees }
      case 'task_id_prefix':
        taskIdPrefix = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
        return { taskIdPrefix }
      case 'github_poll_interval':
        githubPollInterval = parseGitHubPollIntervalSeconds(value)
        return { githubPollInterval }
      case 'pr_walkthrough_prompt':
        walkthroughPrompt = value
        return { walkthroughPrompt }
    }
  }

  return {
    get hierarchyValues() { return hierarchyValues },
    get loaded() { return loaded },
    get loadError() { return loadError },
    get githubToken() { return githubToken },
    get isGhosttyTerminalStateEnabled() { return isGhosttyTerminalStateEnabled },
    load,
    setGithubToken,
    setGhosttyTerminalState,
    applySettingChange,
  }
}

export type SettingsGlobalController = ReturnType<typeof createSettingsGlobalController>
