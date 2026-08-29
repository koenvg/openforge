import { DEFAULT_GITHUB_POLL_INTERVAL_SECONDS, loadGlobalSettings, parseGitHubPollIntervalSeconds } from '../../lib/settingsConfig'
import { DEFAULT_PR_REVIEW_GUIDANCE, DEFAULT_PR_WALKTHROUGH_GUIDANCE } from '../../lib/prGuidanceDefaults'
import type { GlobalSettingsSavePayload } from '../../lib/settingsSaver'
import { error } from '../../lib/stores'

// The two PR guidance settings live in the Agents section only, mirroring project
// settings. Every other global section excludes them so they are not rendered three times.
export const GLOBAL_GENERAL_EXCLUDE_KEYS = ['ai_provider', 'github_poll_interval', 'plugins', 'pr_review_guidance', 'pr_walkthrough_guidance']
// The PR guidance settings render in their own card beside this one, so the
// provider card excludes them too.
export const PROVIDER_ONLY_EXCLUDE_KEYS = [
  'task_display_title_metadata_updates_enabled',
  'use_worktrees',
  'task_id_prefix',
  'github_poll_interval',
  'plugins',
  'pr_review_guidance',
  'pr_walkthrough_guidance',
]
export const GITHUB_ONLY_EXCLUDE_KEYS = [
  'task_display_title_metadata_updates_enabled',
  'ai_provider',
  'use_worktrees',
  'task_id_prefix',
  'plugins',
  'pr_review_guidance',
  'pr_walkthrough_guidance',
]

function getErrorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}

export function createSettingsGlobalController() {
  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)
  let useWorktrees = $state(true)
  let aiProvider = $state('claude-code')
  let reviewGuidance = $state(DEFAULT_PR_REVIEW_GUIDANCE)
  let walkthroughGuidance = $state(DEFAULT_PR_WALKTHROUGH_GUIDANCE)
  let loaded = $state(false)
  let loadError = $state<string | null>(null)
  let isTaskDisplayTitleMetadataUpdatesEnabled = $state(false)

  const hierarchyValues = $derived<Record<string, string>>({
    task_display_title_metadata_updates_enabled: isTaskDisplayTitleMetadataUpdatesEnabled ? 'true' : 'false',
    ai_provider: aiProvider,
    use_worktrees: useWorktrees ? 'true' : 'false',
    task_id_prefix: taskIdPrefix,
    github_poll_interval: String(githubPollInterval),
    pr_review_guidance: reviewGuidance,
    pr_walkthrough_guidance: walkthroughGuidance,
  })

  async function load(): Promise<void> {
    try {
      const settings = await loadGlobalSettings()
      taskIdPrefix = settings.taskIdPrefix
      githubToken = settings.githubToken
      isTaskDisplayTitleMetadataUpdatesEnabled = settings.taskDisplayTitleMetadataUpdatesEnabled
      githubPollInterval = settings.githubPollInterval
      useWorktrees = settings.useWorktrees
      aiProvider = settings.aiProvider
      reviewGuidance = settings.reviewGuidance
      walkthroughGuidance = settings.walkthroughGuidance
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


  function applySettingChange(key: string, value: string): GlobalSettingsSavePayload | undefined {
    switch (key) {
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
      case 'pr_review_guidance':
        reviewGuidance = value
        return { reviewGuidance }
      case 'pr_walkthrough_guidance':
        walkthroughGuidance = value
        return { walkthroughGuidance }
    }
  }

  return {
    get hierarchyValues() { return hierarchyValues },
    get loaded() { return loaded },
    get loadError() { return loadError },
    get githubToken() { return githubToken },
    load,
    setGithubToken,
    applySettingChange,
  }
}

export type SettingsGlobalController = ReturnType<typeof createSettingsGlobalController>
