import { onDestroy, onMount } from 'svelte'
import { computeEffectiveProjectSettings } from '../../lib/hierarchicalSettings'
import { error } from '../../lib/stores'
import type { TaskState } from '../../lib/taskState'
import {
  createSettingsGlobalController,
  GITHUB_ONLY_EXCLUDE_KEYS,
  GLOBAL_GENERAL_EXCLUDE_KEYS,
  PROVIDER_ONLY_EXCLUDE_KEYS,
} from './settingsGlobalController.svelte'
import { createSettingsInstallationController } from './settingsInstallationController.svelte'
import { createSettingsPersistenceController } from './settingsPersistenceController.svelte'
import { createSettingsPluginController } from './settingsPluginController.svelte'
import { createSettingsProjectController } from './settingsProjectController.svelte'
import { createSettingsThemeController } from './settingsThemeController.svelte'
import { createSettingsWhisperController } from './settingsWhisperController.svelte'

export type SettingsViewMode = 'project' | 'global'

interface SettingsViewControllerOptions {
  getMode(): SettingsViewMode
  onProjectDeleted(): void
  onProjectSettingsSaved?(): void | Promise<void>
}

const SAVE_DEBOUNCE_MS = 500

export function useSettingsViewController(options: SettingsViewControllerOptions) {
  const mode = $derived(options.getMode())
  const activePage = $derived(mode === 'global' ? 'global' : 'project')

  const globalController = createSettingsGlobalController()
  const projectController = createSettingsProjectController(options)
  const pluginController = createSettingsPluginController()
  const installationController = createSettingsInstallationController()
  const whisperController = createSettingsWhisperController()
  const themeController = createSettingsThemeController()
  const persistenceController = createSettingsPersistenceController({
    delayMs: SAVE_DEBOUNCE_MS,
    onProjectSaved: projectController.handleSaved,
    onError: (message) => error.set(message),
  })

  const projectHierarchyValues = $derived<Record<string, string>>(
    computeEffectiveProjectSettings(globalController.hierarchyValues, projectController.rawOverrides),
  )
  const settingsLoading = $derived(
    activePage === 'project' ? projectController.settingsLoading : !globalController.loaded,
  )

  onMount(async () => {
    const globalSettingsPromise = globalController.load()
    const installationStatusPromise = installationController.refresh()
    const whisperStatusesPromise = whisperController.refreshModelStatuses()

    await globalSettingsPromise
    await pluginController.loadGlobalDefaults()
    await whisperStatusesPromise
    await installationStatusPromise
  })

  onDestroy(() => {
    persistenceController.destroy()
  })

  function scheduleProjectSave(): void {
    const payload = projectController.captureSavePayload()
    if (payload) persistenceController.scheduleProject(payload)
  }

  function scheduleSave(globalChanges?: Parameters<typeof persistenceController.scheduleGlobal>[0]): void {
    if (mode === 'project') {
      scheduleProjectSave()
      return
    }
    if (globalController.loaded && globalChanges) {
      persistenceController.scheduleGlobal(globalChanges)
    }
  }

  function handleThemeToggle(): void {
    themeController.toggle()
    scheduleSave()
  }

  function handleGhosttyTerminalDiagnosticsChange(enabled: boolean): void {
    scheduleSave(globalController.setGhosttyTerminalDiagnostics(enabled))
  }

  function handleGlobalSettingChange(key: string, value: string): void {
    scheduleSave(globalController.applySettingChange(key, value))
  }

  function runImmediateSave(): Promise<void> {
    return persistenceController.runImmediately(
      mode === 'project' ? projectController.captureSavePayload() : null,
    )
  }

  return {
    get mode() { return mode },
    get activePage() { return activePage },
    get projectId() { return projectController.projectId },
    get hasProject() { return projectController.hasProject },
    get projectName() { return projectController.projectName },
    get projectPath() { return projectController.projectPath },
    get runCommand() { return projectController.runCommand },
    get agentInstructions() { return projectController.agentInstructions },
    get focusFilterStates() { return projectController.focusFilterStates },
    get projectRawOverrides() { return projectController.rawOverrides },
    get projectHierarchyValues() { return projectHierarchyValues },
    get projectOverrideCount() { return projectController.overrideCount },
    get resettingProjectSetting() { return projectController.resettingSetting },
    get globalHierarchyValues() { return globalController.hierarchyValues },
    get globalSettingsLoaded() { return globalController.loaded },
    get githubToken() { return globalController.githubToken },
    get globalPluginDefaultsById() { return pluginController.globalDefaultsById },
    get pluginSettingsSections() { return pluginController.settingsSections },
    get modelStatuses() { return whisperController.modelStatuses },
    get downloadingModel() { return whisperController.downloadingModel },
    get isDarkMode() { return themeController.isDarkMode },
    get isGhosttyTerminalDiagnosticsEnabled() { return globalController.isGhosttyTerminalDiagnosticsEnabled },
    get settingsLoading() { return settingsLoading },
    get projectSettingsLoadError() { return projectController.settingsLoadError },
    get globalSettingsLoadError() { return globalController.loadError },
    get isSaving() { return persistenceController.isSaving },
    get saved() { return persistenceController.saved },
    get saveStatus() { return persistenceController.saveStatus },
    get saveError() { return persistenceController.saveError },
    get isDeleting() { return projectController.isDeleting },
    get confirmingDelete() { return projectController.confirmingDelete },
    get deleteError() { return projectController.deleteError },
    get opencodeInstalled() { return installationController.opencodeInstalled },
    get opencodeVersion() { return installationController.opencodeVersion },
    get claudeInstalled() { return installationController.claudeInstalled },
    get claudeVersion() { return installationController.claudeVersion },
    get claudeAuthenticated() { return installationController.claudeAuthenticated },
    get piInstalled() { return installationController.piInstalled },
    get piVersion() { return installationController.piVersion },
    get codexInstalled() { return installationController.codexInstalled },
    get codexVersion() { return installationController.codexVersion },
    get grokInstalled() { return installationController.grokInstalled },
    get grokVersion() { return installationController.grokVersion },
    get grokAuthenticated() { return installationController.grokAuthenticated },
    get installationStatusLoading() { return installationController.loading },
    get installationStatusError() { return installationController.loadError },
    globalGeneralExcludeKeys: GLOBAL_GENERAL_EXCLUDE_KEYS,
    providerOnlyExcludeKeys: PROVIDER_ONLY_EXCLUDE_KEYS,
    githubOnlyExcludeKeys: GITHUB_ONLY_EXCLUDE_KEYS,
    setProjectName(value: string) { projectController.setProjectName(value); scheduleSave() },
    setProjectPath(value: string) { projectController.setProjectPath(value); scheduleSave() },
    setRunCommand(value: string) { projectController.setRunCommand(value); scheduleSave() },
    setAgentInstructions(value: string) { projectController.setAgentInstructions(value); scheduleSave() },
    setFocusFilterStates(value: TaskState[]) { projectController.setFocusFilterStates(value); scheduleSave() },
    setGithubToken(value: string) { scheduleSave(globalController.setGithubToken(value)) },
    clearDownloadError: whisperController.clearDownloadError,
    beginDeleteConfirmation: projectController.beginDeleteConfirmation,
    cancelDeleteConfirmation: projectController.cancelDeleteConfirmation,
    handleThemeToggle,
    handleGhosttyTerminalDiagnosticsChange,
    handleGlobalSettingChange,
    handleGlobalPluginToggle: pluginController.toggleGlobalDefault,
    handleProjectSettingChange: projectController.changeSetting,
    handleResetToGlobal: projectController.resetToGlobal,
    handleResetProjectSetting: projectController.resetSetting,
    refreshInstallationStatus: installationController.refresh,
    handleDelete: projectController.deleteCurrentProject,
    handleModelChange: whisperController.changeModel,
    handleDownloadModel: whisperController.beginModelDownload,
    refreshModelStatuses: whisperController.refreshModelStatuses,
    runImmediateSave,
  }
}

export type SettingsViewController = ReturnType<typeof useSettingsViewController>
