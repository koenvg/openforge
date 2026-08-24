import { onDestroy, onMount } from 'svelte'
import { fromStore } from 'svelte/store'
import {
  deleteProject,
  getGlobalPluginDefaults,
  setGlobalPluginDefault,
  setProjectConfig,
  setWhisperModel,
} from '../../lib/ipc'
import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
import { createTrackedDebouncedSave } from '../../lib/createTrackedDebouncedSave'
import { computeEffectiveProjectSettings } from '../../lib/hierarchicalSettings'
import { resolveContributions } from '../../lib/plugin/contributionResolver'
import { loadEnabledForProject } from '../../lib/plugin/pluginRegistry'
import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
import {
  DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
  loadGlobalSettings,
  loadInstallationStatus,
  loadProjectHierarchyOverrides,
  loadProjectSettings,
  loadWhisperModelStatuses,
  parseGitHubPollIntervalSeconds,
} from '../../lib/settingsConfig'
import type { ProjectSettingsConfig } from '../../lib/settingsConfig'
import { DEFAULT_PR_WALKTHROUGH_PROMPT } from '../../lib/prWalkthroughPrompt'
import { getProjectIdentity, mergeUpdatedProject, resetProjectAndReload, resetProjectSettingAndReload } from '../../lib/settingsProjectSync'
import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
import type { GlobalSettingsSavePayload, ProjectSettingsSavePayload } from '../../lib/settingsSaver'
import {
  activeProjectId,
  codeCleanupTasksEnabled,
  error,
  projects,
} from '../../lib/stores'
import { applyTheme, themeMode } from '../../lib/theme'
import type { ThemeMode } from '../../lib/theme'
import type { TaskState } from '../../lib/taskState'
import type { WhisperModelSizeId, WhisperModelStatus } from '../../lib/types'

export type SettingsViewMode = 'project' | 'global'
type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

interface SettingsViewControllerOptions {
  getMode(): SettingsViewMode
  onProjectDeleted(): void
  onProjectSettingsSaved?(): void | Promise<void>
}

const SAVE_DEBOUNCE_MS = 500
// `pr_walkthrough_prompt` lives in the Agents section only, mirroring project settings —
// every other global section excludes it so the long prompt is not rendered three times.
const GLOBAL_GENERAL_EXCLUDE_KEYS = ['ai_provider', 'github_poll_interval', 'plugins', 'pr_walkthrough_prompt']
const PROVIDER_ONLY_EXCLUDE_KEYS = [
  'code_cleanup_tasks_enabled',
  'task_display_title_metadata_updates_enabled',
  'use_worktrees',
  'task_id_prefix',
  'github_poll_interval',
  'plugins',
]
const GITHUB_ONLY_EXCLUDE_KEYS = [
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

export function useSettingsViewController(options: SettingsViewControllerOptions) {
  const activeProjectIdState = fromStore(activeProjectId)
  const projectsState = fromStore(projects)
  const themeModeState = fromStore(themeMode)
  const codeCleanupTasksEnabledState = fromStore(codeCleanupTasksEnabled)
  const enabledPluginIdsState = fromStore(enabledPluginIds)
  const installedPluginsState = fromStore(installedPlugins)
  const runtimeContributionSourcesState = fromStore(runtimeContributionSources)

  let projectName = $state('')
  let projectPath = $state('')
  let agentInstructions = $state('')
  let runCommand = $state('')
  let projectRawOverrides = $state<Record<string, string | null>>({})
  let resettingProjectSetting = $state<string | null>(null)

  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)
  let globalUseWorktrees = $state(true)
  let globalAiProvider = $state('claude-code')
  let globalWalkthroughPrompt = $state(DEFAULT_PR_WALKTHROUGH_PROMPT)
  let globalPluginDefaults = $state<Map<string, boolean>>(new Map())
  let globalSettingsLoaded = $state(false)
  let globalSettingsLoadError = $state<string | null>(null)

  let modelStatuses = $state<WhisperModelStatus[]>([])
  let downloadingModel = $state<WhisperModelSizeId | null>(null)
  let opencodeInstalled = $state(false)
  let opencodeVersion = $state<string | null>(null)
  let claudeInstalled = $state(false)
  let claudeVersion = $state<string | null>(null)
  let claudeAuthenticated = $state(false)
  let piInstalled = $state(false)
  let piVersion = $state<string | null>(null)
  let codexInstalled = $state(false)
  let codexVersion = $state<string | null>(null)
  let grokInstalled = $state(false)
  let grokVersion = $state<string | null>(null)
  let grokAuthenticated = $state(false)
  let installationStatusLoading = $state(false)
  let installationStatusError = $state<string | null>(null)

  let focusFilterStates = $state<TaskState[]>([...DEFAULT_FOCUS_STATES])
  let isCodeCleanupTasksEnabled = $state(codeCleanupTasksEnabledState.current)
  let isTaskDisplayTitleMetadataUpdatesEnabled = $state(false)
  let isGhosttyTerminalStateEnabled = $state(false)
  let isDarkMode = $state(themeModeState.current === 'dark')

  let isSaving = $state(false)
  let saved = $state(false)
  let saveStatus = $state<SaveStatus>('idle')
  let saveError = $state<string | null>(null)
  let projectSettingsLoading = $state(false)
  let projectSettingsLoadError = $state<string | null>(null)
  let projectSettingsRequestId = 0
  let savedStatusTimer: ReturnType<typeof setTimeout> | null = null
  let pendingProjectSettingsSave = $state<ProjectSettingsSavePayload | null>(null)
  let pendingGlobalSettingsSave = $state<GlobalSettingsSavePayload | null>(null)

  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  const mode = $derived(options.getMode())
  const activePage = $derived(mode === 'global' ? 'global' : 'project')
  const projectId = $derived(activeProjectIdState.current)
  const hasProject = $derived(!!projectId)
  const settingsLoading = $derived(activePage === 'project' ? projectSettingsLoading : !globalSettingsLoaded)

  const globalHierarchyValues = $derived<Record<string, string>>({
    code_cleanup_tasks_enabled: isCodeCleanupTasksEnabled ? 'true' : 'false',
    task_display_title_metadata_updates_enabled: isTaskDisplayTitleMetadataUpdatesEnabled ? 'true' : 'false',
    ai_provider: globalAiProvider,
    use_worktrees: globalUseWorktrees ? 'true' : 'false',
    task_id_prefix: taskIdPrefix,
    github_poll_interval: String(githubPollInterval),
    pr_walkthrough_prompt: globalWalkthroughPrompt,
  })
  const projectHierarchyValues = $derived<Record<string, string>>(
    computeEffectiveProjectSettings(globalHierarchyValues, projectRawOverrides),
  )
  const projectOverrideCount = $derived(
    Object.values(projectRawOverrides).filter((value) => value != null).length,
  )
  const globalPluginDefaultsById = $derived(
    new Map(
      Array.from(installedPluginsState.current.values()).map((plugin) => [
        plugin.manifest.id,
        globalPluginDefaults.get(plugin.manifest.id) ?? (plugin.isBuiltin ?? false),
      ]),
    ),
  )
  const enabledPluginContributionSources = $derived(
    Array.from(enabledPluginIdsState.current)
      .map((id) => runtimeContributionSourcesState.current.get(id))
      .filter((source) => source !== undefined),
  )
  const pluginSettingsSections = $derived(
    resolveContributions(enabledPluginContributionSources).settingsSections.filter((section) => section.scope !== 'global'),
  )

  const saveController = createTrackedDebouncedSave({
    delayMs: SAVE_DEBOUNCE_MS,
    save,
  })

  $effect(() => {
    isDarkMode = themeModeState.current === 'dark'
  })

  $effect(() => {
    const identity = getProjectIdentity(projectId, projectsState.current)
    projectName = identity.projectName
    projectPath = identity.projectPath
  })

  $effect(() => {
    const pid = projectId
    if (mode === 'project' && pid) {
      void reloadProjectSettings(pid)
      return
    }

    projectSettingsRequestId++
    projectSettingsLoadError = null
    projectSettingsLoading = false
    agentInstructions = ''
    runCommand = ''
    focusFilterStates = [...DEFAULT_FOCUS_STATES]
    projectRawOverrides = {}
  })

  onMount(async () => {
    const globalSettingsPromise = loadGlobalSettings()
    const installationStatusPromise = refreshInstallationStatus()
    const whisperStatusesPromise = loadWhisperModelStatuses()

    try {
      const globalSettings = await globalSettingsPromise
      taskIdPrefix = globalSettings.taskIdPrefix
      githubToken = globalSettings.githubToken
      isCodeCleanupTasksEnabled = globalSettings.codeCleanupTasksEnabled
      codeCleanupTasksEnabled.set(isCodeCleanupTasksEnabled)
      isTaskDisplayTitleMetadataUpdatesEnabled = globalSettings.taskDisplayTitleMetadataUpdatesEnabled
      isGhosttyTerminalStateEnabled = globalSettings.ghosttyTerminalStateEnabled
      githubPollInterval = globalSettings.githubPollInterval
      globalUseWorktrees = globalSettings.useWorktrees
      globalAiProvider = globalSettings.aiProvider
      globalWalkthroughPrompt = globalSettings.walkthroughPrompt
      globalSettingsLoaded = true
    } catch (value) {
      globalSettingsLoadError = getErrorMessage(value)
      error.set(globalSettingsLoadError)
    }

    try {
      const defaults = await getGlobalPluginDefaults()
      globalPluginDefaults = new Map(defaults.map((item) => [item.pluginId, item.enabled]))
    } catch (value) {
      console.error('Failed to load global plugin defaults:', value)
    }

    modelStatuses = await whisperStatusesPromise
    await installationStatusPromise
  })

  onDestroy(() => {
    clearSavedStatusTimer()
    void flushPendingSave().catch(() => {})
  })

  function clearSavedStatusTimer(): void {
    if (!savedStatusTimer) return
    clearTimeout(savedStatusTimer)
    savedStatusTimer = null
  }

  function applyProjectSettings(settings: ProjectSettingsConfig): void {
    agentInstructions = settings.agentInstructions
    runCommand = settings.runCommand
    focusFilterStates = settings.focusFilterStates
  }

  async function reloadProjectSettings(pid: string): Promise<void> {
    const requestId = ++projectSettingsRequestId
    projectSettingsLoadError = null
    projectSettingsLoading = true
    try {
      const [settings, overrides] = await Promise.all([
        loadProjectSettings(pid),
        loadProjectHierarchyOverrides(pid),
      ])
      if (requestId !== projectSettingsRequestId) return
      applyProjectSettings(settings)
      projectRawOverrides = overrides
    } catch (value) {
      if (requestId !== projectSettingsRequestId) return
      projectSettingsLoadError = getErrorMessage(value)
      error.set(projectSettingsLoadError)
    } finally {
      if (requestId === projectSettingsRequestId) {
        projectSettingsLoading = false
      }
    }
  }

  function captureCurrentSave(globalChanges?: GlobalSettingsSavePayload): boolean {
    if (mode === 'project' && hasProject && projectId) {
      pendingProjectSettingsSave = {
        projectId,
        projectName,
        projectPath,
        agentInstructions,
        runCommand,
        focusFilterStates,
      }
      return true
    }

    if (mode === 'global' && globalSettingsLoaded && globalChanges) {
      pendingGlobalSettingsSave = { ...pendingGlobalSettingsSave, ...globalChanges }
      return true
    }

    return false
  }

  function isLatestProjectIdentityPayload(payload: ProjectSettingsSavePayload): boolean {
    const newerPendingProjectSave = pendingProjectSettingsSave
    if (newerPendingProjectSave?.projectId === payload.projectId) {
      return newerPendingProjectSave.projectName === payload.projectName
        && newerPendingProjectSave.projectPath === payload.projectPath
    }
    if (projectId === payload.projectId) {
      return projectName === payload.projectName && projectPath === payload.projectPath
    }
    return true
  }

  async function save(): Promise<void> {
    const projectPayload = pendingProjectSettingsSave
    const globalPayload = pendingGlobalSettingsSave
    pendingProjectSettingsSave = null
    pendingGlobalSettingsSave = null
    if (!projectPayload && !globalPayload) return

    isSaving = true
    saveStatus = 'saving'
    saveError = null
    clearSavedStatusTimer()
    try {
      if (projectPayload) {
        await saveProjectSettings(projectPayload)
        await options.onProjectSettingsSaved?.()
        if (isLatestProjectIdentityPayload(projectPayload)) {
          projects.set(mergeUpdatedProject(projectsState.current, {
            id: projectPayload.projectId,
            name: projectPayload.projectName,
            path: projectPayload.projectPath,
          }))
        }
      }
      if (globalPayload) {
        await saveGlobalSettings(globalPayload)
      }
      saved = true
      saveStatus = 'saved'
      savedStatusTimer = setTimeout(() => {
        saved = false
        if (saveStatus === 'saved') saveStatus = 'idle'
        savedStatusTimer = null
      }, 2000)
    } catch (value) {
      if (globalPayload) {
        pendingGlobalSettingsSave = { ...globalPayload, ...(pendingGlobalSettingsSave ?? {}) }
      }
      console.error('Failed to save settings:', value)
      saveError = getErrorMessage(value)
      saveStatus = 'error'
      error.set(saveError)
      throw value
    } finally {
      isSaving = false
    }
  }

  function scheduleSave(globalChanges?: GlobalSettingsSavePayload): void {
    if (!captureCurrentSave(globalChanges)) return
    clearSavedStatusTimer()
    saved = false
    saveError = null
    saveStatus = 'dirty'
    void saveController.schedule().catch(() => {})
  }

  function flushPendingSave(): Promise<void> {
    return saveController.flush()
  }

  function runImmediateSave(): Promise<void> {
    if (!pendingProjectSettingsSave && !pendingGlobalSettingsSave && !captureCurrentSave()) return Promise.resolve()
    return saveController.runImmediately()
  }

  function handleThemeToggle(): void {
    const next: ThemeMode = isDarkMode ? 'light' : 'dark'
    applyTheme(next)
    scheduleSave()
  }

  function handleGhosttyTerminalStateChange(enabled: boolean): void {
    isGhosttyTerminalStateEnabled = enabled
    scheduleSave({ ghosttyTerminalStateEnabled: enabled })
  }

  function handleGlobalSettingChange(key: string, value: string): void {
    switch (key) {
      case 'code_cleanup_tasks_enabled':
        isCodeCleanupTasksEnabled = value === 'true'
        codeCleanupTasksEnabled.set(isCodeCleanupTasksEnabled)
        break
      case 'task_display_title_metadata_updates_enabled':
        isTaskDisplayTitleMetadataUpdatesEnabled = value === 'true'
        break
      case 'ai_provider':
        globalAiProvider = value
        break
      case 'use_worktrees':
        globalUseWorktrees = value === 'true'
        break
      case 'task_id_prefix':
        taskIdPrefix = value.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 5)
        break
      case 'github_poll_interval':
        githubPollInterval = parseGitHubPollIntervalSeconds(value)
        break
      case 'pr_walkthrough_prompt':
        globalWalkthroughPrompt = value
        break
    }
    const changesByConfigKey: Record<string, GlobalSettingsSavePayload> = {
      code_cleanup_tasks_enabled: { codeCleanupTasksEnabled: isCodeCleanupTasksEnabled },
      task_display_title_metadata_updates_enabled: {
        taskDisplayTitleMetadataUpdatesEnabled: isTaskDisplayTitleMetadataUpdatesEnabled,
      },
      ai_provider: { aiProvider: globalAiProvider },
      use_worktrees: { useWorktrees: globalUseWorktrees },
      task_id_prefix: { taskIdPrefix },
      github_poll_interval: { githubPollInterval },
      pr_walkthrough_prompt: { walkthroughPrompt: globalWalkthroughPrompt },
    }
    scheduleSave(changesByConfigKey[key])
  }

  async function handleGlobalPluginToggle(pluginId: string, enabled: boolean): Promise<void> {
    try {
      await setGlobalPluginDefault(pluginId, enabled)
      const next = new Map(globalPluginDefaults)
      next.set(pluginId, enabled)
      globalPluginDefaults = next
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  async function handleProjectSettingChange(key: string, value: string): Promise<void> {
    if (!projectId) return
    projectRawOverrides = { ...projectRawOverrides, [key]: value }
    try {
      await setProjectConfig(projectId, key, value)
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  async function handleResetToGlobal(): Promise<void> {
    if (!projectId) return
    try {
      await resetProjectAndReload(projectId, async () => {
        await Promise.all([reloadProjectSettings(projectId), loadEnabledForProject(projectId)])
      })
    } catch (value) {
      error.set(getErrorMessage(value))
    }
  }

  async function handleResetProjectSetting(key: string): Promise<void> {
    if (!projectId || resettingProjectSetting) return
    resettingProjectSetting = key
    try {
      await resetProjectSettingAndReload(projectId, key, () => reloadProjectSettings(projectId))
    } catch (value) {
      error.set(getErrorMessage(value))
    } finally {
      resettingProjectSetting = null
    }
  }


  function applyInstallationStatus(status: Awaited<ReturnType<typeof loadInstallationStatus>>): void {
    opencodeInstalled = status.opencodeInstalled
    opencodeVersion = status.opencodeVersion
    claudeInstalled = status.claudeInstalled
    claudeVersion = status.claudeVersion
    claudeAuthenticated = status.claudeAuthenticated
    piInstalled = status.piInstalled
    piVersion = status.piVersion
    codexInstalled = status.codexInstalled
    codexVersion = status.codexVersion
    grokInstalled = status.grokInstalled
    grokVersion = status.grokVersion
    grokAuthenticated = status.grokAuthenticated
  }

  async function refreshInstallationStatus(): Promise<void> {
    installationStatusLoading = true
    installationStatusError = null
    try {
      applyInstallationStatus(await loadInstallationStatus())
    } catch (value) {
      installationStatusError = getErrorMessage(value)
    } finally {
      installationStatusLoading = false
    }
  }

  async function handleDelete(): Promise<void> {
    if (!projectId) return
    isDeleting = true
    deleteError = null
    try {
      await deleteProject(projectId)
      options.onProjectDeleted()
    } catch (value) {
      console.error('Failed to delete project:', value)
      deleteError = getErrorMessage(value)
    } finally {
      isDeleting = false
      confirmingDelete = false
    }
  }

  async function handleModelChange(newSize: string): Promise<void> {
    await setWhisperModel(newSize as WhisperModelSizeId)
    modelStatuses = await loadWhisperModelStatuses()
  }

  function handleDownloadModel(modelSize: string): void {
    downloadingModel = modelSize as WhisperModelSizeId
  }

  async function refreshModelStatuses(): Promise<void> {
    downloadingModel = null
    modelStatuses = await loadWhisperModelStatuses()
  }

  return {
    get mode() { return mode },
    get activePage() { return activePage },
    get projectId() { return projectId },
    get hasProject() { return hasProject },
    get projectName() { return projectName },
    get projectPath() { return projectPath },
    get runCommand() { return runCommand },
    get agentInstructions() { return agentInstructions },
    get focusFilterStates() { return focusFilterStates },
    get projectRawOverrides() { return projectRawOverrides },
    get projectHierarchyValues() { return projectHierarchyValues },
    get projectOverrideCount() { return projectOverrideCount },
    get resettingProjectSetting() { return resettingProjectSetting },
    get globalHierarchyValues() { return globalHierarchyValues },
    get globalSettingsLoaded() { return globalSettingsLoaded },
    get githubToken() { return githubToken },
    get globalPluginDefaultsById() { return globalPluginDefaultsById },
    get pluginSettingsSections() { return pluginSettingsSections },
    get modelStatuses() { return modelStatuses },
    get downloadingModel() { return downloadingModel },
    get isDarkMode() { return isDarkMode },
    get isGhosttyTerminalStateEnabled() { return isGhosttyTerminalStateEnabled },
    get settingsLoading() { return settingsLoading },
    get projectSettingsLoadError() { return projectSettingsLoadError },
    get globalSettingsLoadError() { return globalSettingsLoadError },
    get isSaving() { return isSaving },
    get saved() { return saved },
    get saveStatus() { return saveStatus },
    get saveError() { return saveError },
    get isDeleting() { return isDeleting },
    get confirmingDelete() { return confirmingDelete },
    get deleteError() { return deleteError },
    get opencodeInstalled() { return opencodeInstalled },
    get opencodeVersion() { return opencodeVersion },
    get claudeInstalled() { return claudeInstalled },
    get claudeVersion() { return claudeVersion },
    get claudeAuthenticated() { return claudeAuthenticated },
    get piInstalled() { return piInstalled },
    get piVersion() { return piVersion },
    get codexInstalled() { return codexInstalled },
    get codexVersion() { return codexVersion },
    get grokInstalled() { return grokInstalled },
    get grokVersion() { return grokVersion },
    get grokAuthenticated() { return grokAuthenticated },
    get installationStatusLoading() { return installationStatusLoading },
    get installationStatusError() { return installationStatusError },
    globalGeneralExcludeKeys: GLOBAL_GENERAL_EXCLUDE_KEYS,
    providerOnlyExcludeKeys: PROVIDER_ONLY_EXCLUDE_KEYS,
    githubOnlyExcludeKeys: GITHUB_ONLY_EXCLUDE_KEYS,
    setProjectName(value: string) { projectName = value; scheduleSave() },
    setProjectPath(value: string) { projectPath = value; scheduleSave() },
    setRunCommand(value: string) { runCommand = value; scheduleSave() },
    setAgentInstructions(value: string) { agentInstructions = value; scheduleSave() },
    setFocusFilterStates(value: TaskState[]) { focusFilterStates = value; scheduleSave() },
    setGithubToken(value: string) { githubToken = value; scheduleSave({ githubToken: value }) },
    clearDownloadError() { downloadingModel = null },
    beginDeleteConfirmation() { confirmingDelete = true; deleteError = null },
    cancelDeleteConfirmation() { confirmingDelete = false; deleteError = null },
    handleThemeToggle,
    handleGhosttyTerminalStateChange,
    handleGlobalSettingChange,
    handleGlobalPluginToggle,
    handleProjectSettingChange,
    handleResetToGlobal,
    handleResetProjectSetting,
    refreshInstallationStatus,
    handleDelete,
    handleModelChange,
    handleDownloadModel,
    refreshModelStatuses,
    runImmediateSave,
  }
}

export type SettingsViewController = ReturnType<typeof useSettingsViewController>
