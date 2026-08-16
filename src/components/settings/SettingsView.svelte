<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { AudioLines, Blocks, Bot, Code2, Filter, FolderOpen, GitBranch, RotateCcw, Settings2, Smartphone, Sparkles, Tags, TriangleAlert } from '@lucide/svelte'
  import { activeProjectColorId, activeProjectId, projects, codeCleanupTasksEnabled, error } from '../../lib/stores'
  import {
    deleteProject,
    setWhisperModel,
    getGlobalPluginDefaults,
    setGlobalPluginDefault,
    setProjectConfig,
  } from '../../lib/ipc'
  import { computeEffectiveProjectSettings } from '../../lib/hierarchicalSettings'
  import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
  import { createTrackedDebouncedSave } from '../../lib/createTrackedDebouncedSave'
  import {
    DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
    loadGlobalSettings,
    loadInstallationStatus,
    loadProjectSettings,
    loadProjectHierarchyOverrides,
    loadWhisperModelStatuses,
    parseGitHubPollIntervalSeconds,
  } from '../../lib/settingsConfig'
  import type { ProjectSettingsConfig } from '../../lib/settingsConfig'
  import { mergeUpdatedProject, getProjectIdentity, resetProjectAndReload, resetProjectSettingAndReload } from '../../lib/settingsProjectSync'
  import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
  import type { GlobalSettingsSavePayload, ProjectSettingsSavePayload } from '../../lib/settingsSaver'
  import { themeMode, applyTheme } from '../../lib/theme'
  import type { ThemeMode } from '../../lib/theme'
  import type { WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import { loadEnabledForProject } from '../../lib/plugin/pluginRegistry'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import ProviderSelectField from './ProviderSelectField.svelte'
  import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsTaskLabelsCard from './SettingsTaskLabelsCard.svelte'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
  import SettingsCategoryNav from './SettingsCategoryNav.svelte'
  import type { SettingsCategory } from './SettingsCategoryNav.svelte'
  import SettingsDeveloperLogsCard from './SettingsDeveloperLogsCard.svelte'
  import SettingsCompanionCard from './SettingsCompanionCard.svelte'
  import SettingsSectionCard from './SettingsSectionCard.svelte'
  import ProjectPageHeader from '../project/ProjectPageHeader.svelte'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import PluginSettingsPanel from '../plugin/PluginSettingsPanel.svelte'
  import GlobalPluginSettingsPanel from '../plugin/GlobalPluginSettingsPanel.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
    onProjectSettingsSaved?: () => void | Promise<void>
    mode: 'project' | 'global'
  }

  let { onClose, onProjectDeleted, onProjectSettingsSaved, mode }: Props = $props()

  type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

  // Project state
  let projectName = $state('')
  let projectPath = $state('')
  let agentInstructions = $state('')
  let handoffNotesTemplate = $state('')
  let projectColor = $state('')
  let runCommand = $state('')
  // Raw per-project overrides for the unified-settings hierarchy keys (null = inherit global).
  // `ai_provider` and `use_worktrees` live here (via projectHierarchyValues) and are
  // rendered/persisted exclusively through the Configuration card, not local state.
  let projectRawOverrides = $state<Record<string, string | null>>({})
  let resettingProjectSetting = $state<string | null>(null)

  // Global state
  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)
  let globalHandoffNotesEnabled = $state(true)
  let globalUseWorktrees = $state(true)
  let globalAiProvider = $state('claude-code')
  let globalPluginDefaults = $state<Map<string, boolean>>(new Map())
  let globalSettingsLoaded = $state(false)
  let globalSettingsLoadError = $state<string | null>(null)

  // AI state
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

  // Focus filter state
  let focusFilterStates = $state<TaskState[]>([...DEFAULT_FOCUS_STATES])

  // Feature flag state
  let isCodeCleanupTasksEnabled = $state($codeCleanupTasksEnabled)
  let isTaskDisplayTitleMetadataUpdatesEnabled = $state(false)
  // Theme state
  let isDarkMode = $state($themeMode === 'dark')

  $effect(() => {
    isDarkMode = $themeMode === 'dark'
  })

  function handleThemeToggle() {
    const next: ThemeMode = isDarkMode ? 'light' : 'dark'
    applyTheme(next)
  }

  function handleGlobalSettingChange(key: string, value: string) {
    switch (key) {
      case 'code_cleanup_tasks_enabled':
        isCodeCleanupTasksEnabled = value === 'true'
        $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
        break
      case 'task_display_title_metadata_updates_enabled':
        isTaskDisplayTitleMetadataUpdatesEnabled = value === 'true'
        break
      case 'handoff_notes_enabled':
        globalHandoffNotesEnabled = value === 'true'
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
    }
    scheduleSave()
  }

  async function handleGlobalPluginToggle(pluginId: string, enabled: boolean) {
    try {
      await setGlobalPluginDefault(pluginId, enabled)
      const next = new Map(globalPluginDefaults)
      next.set(pluginId, enabled)
      globalPluginDefaults = next
    } catch (e) {
      $error = getErrorMessage(e)
    }
  }

  // A project change writes an explicit override immediately. The grouped
  // Configuration card owns every globally-inherited setting except `plugins`
  // (which keeps its dedicated panel) — including `ai_provider` and `use_worktrees`.
  // This immediate per-key write is the single persistence path for those keys, so
  // there is no debounced-vs-immediate race with the General card's autosave.
  async function handleProjectSettingChange(key: string, value: string) {
    const pid = $activeProjectId
    if (!pid) return
    projectRawOverrides = { ...projectRawOverrides, [key]: value }
    try {
      await setProjectConfig(pid, key, value)
    } catch (e) {
      $error = getErrorMessage(e)
    }
  }

  async function handleResetToGlobal() {
    const pid = $activeProjectId
    if (!pid) return
    try {
      await resetProjectAndReload(pid, async () => {
        await Promise.all([reloadProjectSettings(pid), loadEnabledForProject(pid)])
      })
    } catch (e) {
      $error = getErrorMessage(e)
    }
  }

  async function handleResetProjectSetting(key: string) {
    const pid = $activeProjectId
    if (!pid || resettingProjectSetting) return
    resettingProjectSetting = key
    try {
      await resetProjectSettingAndReload(pid, key, () => reloadProjectSettings(pid))
    } catch (e) {
      $error = getErrorMessage(e)
    } finally {
      resettingProjectSetting = null
    }
  }

  function handleProjectColorChange(value: string) {
    projectColor = value
    $activeProjectColorId = value
    scheduleSave()
  }

  // UI state
  let isSaving = $state(false)
  let saved = $state(false)
  let saveStatus = $state<SaveStatus>('idle')
  let saveError = $state<string | null>(null)
  let projectSettingsLoading = $state(false)
  let projectSettingsLoadError = $state<string | null>(null)
  let projectSettingsRequestId = 0
  let savedStatusTimer: ReturnType<typeof setTimeout> | null = null
  const SAVE_DEBOUNCE_MS = 500
  let pendingProjectSettingsSave = $state<ProjectSettingsSavePayload | null>(null)
  let pendingGlobalSettingsSave = $state<GlobalSettingsSavePayload | null>(null)
  const saveController = createTrackedDebouncedSave({
    delayMs: SAVE_DEBOUNCE_MS,
    save,
  })
  const projectCategories: SettingsCategory[] = [
    { id: 'general', label: 'General', description: 'Project identity and inherited defaults', icon: FolderOpen },
    { id: 'agents', label: 'Agents & tasks', description: 'Provider and task behavior', icon: Bot },
    { id: 'labels', label: 'Labels', description: 'Task label management', icon: Tags },
    { id: 'focus', label: 'Focus filter', description: 'Attention and board filters', icon: Filter },
    { id: 'instructions', label: 'AI instructions', description: 'Agent instructions and Handoff Notes template', icon: Sparkles },
    { id: 'plugins', label: 'Plugins', description: 'Project Plugin Enablement', icon: Blocks },
    { id: 'danger', label: 'Danger Zone', description: 'Destructive project actions', icon: TriangleAlert, danger: true },
  ]

  const globalCategories: SettingsCategory[] = [
    { id: 'general', label: 'General', description: 'App-wide defaults and appearance', icon: Settings2 },
    { id: 'agents', label: 'Agents', description: 'Provider defaults and connection health', icon: Bot },
    { id: 'github', label: 'GitHub & Credentials', description: 'Credentials and GitHub polling', icon: GitBranch },
    { id: 'voice', label: 'Voice & Whisper', description: 'Speech model management', icon: AudioLines },
    { id: 'plugins', label: 'Plugins', description: 'Plugin Installation and global defaults', icon: Blocks },
    { id: 'companion', label: 'Companion', description: 'Companion gateway and paired devices', icon: Smartphone },
    { id: 'developer', label: 'Developer logs', description: 'Diagnostics and application logs', icon: Code2 },
  ]

  let activeSection = $state('general')
  const settingsCategories = $derived(mode === 'global' ? globalCategories : projectCategories)
  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  function getErrorMessage(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  function clearSavedStatusTimer() {
    if (savedStatusTimer) {
      clearTimeout(savedStatusTimer)
      savedStatusTimer = null
    }
  }

  function applyInstallationStatus(status: Awaited<ReturnType<typeof loadInstallationStatus>>) {
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

  async function refreshInstallationStatus() {
    installationStatusLoading = true
    installationStatusError = null
    try {
      applyInstallationStatus(await loadInstallationStatus())
    } catch (e) {
      installationStatusError = getErrorMessage(e)
    } finally {
      installationStatusLoading = false
    }
  }

  // Derived state
  const hasProject = $derived(!!$activeProjectId)
  const activePage = $derived(mode === 'global' ? 'global' : 'project')
  const settingsLoading = $derived(activePage === 'project' ? projectSettingsLoading : !globalSettingsLoaded)
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )
  // Project settings page shows only project-scoped sections; global-scoped ones
  // render in the plugin's card on the global settings page instead.
  let pluginSettingsSections = $derived(
    resolveContributions(enabledPluginContributionSources).settingsSections.filter((section) => section.scope !== 'global'),
  )

  // Grouped hierarchy settings (global mode) — effective string values keyed by setting key.
  const globalHierarchyValues = $derived<Record<string, string>>({
    code_cleanup_tasks_enabled: isCodeCleanupTasksEnabled ? 'true' : 'false',
    task_display_title_metadata_updates_enabled: isTaskDisplayTitleMetadataUpdatesEnabled ? 'true' : 'false',
    handoff_notes_enabled: globalHandoffNotesEnabled ? 'true' : 'false',
    ai_provider: globalAiProvider,
    use_worktrees: globalUseWorktrees ? 'true' : 'false',
    task_id_prefix: taskIdPrefix,
    github_poll_interval: String(githubPollInterval),
  })

  // Per-plugin global default keyed by plugin id: explicit global default if
  // present, else builtin default. Consumed by the dedicated plugin panel's
  // enable-by-default toggles (the grouped Configuration card no longer renders plugins).
  let globalPluginDefaultsById = $derived(
    new Map(
      Array.from($installedPlugins.values()).map((plugin) => [
        plugin.manifest.id,
        globalPluginDefaults.get(plugin.manifest.id) ?? (plugin.isBuiltin ?? false),
      ]),
    )
  )

  // Grouped hierarchy settings (project mode) — effective = project override ?? global ?? default.
  const projectHierarchyValues = $derived<Record<string, string>>(
    computeEffectiveProjectSettings(globalHierarchyValues, projectRawOverrides),
  )
  const projectOverrideCount = $derived(
    Object.values(projectRawOverrides).filter((value) => value != null).length,
  )
  const globalGeneralExcludeKeys = ['ai_provider', 'github_poll_interval', 'plugins']
  const providerOnlyExcludeKeys = [
    'code_cleanup_tasks_enabled',
    'task_display_title_metadata_updates_enabled',
    'handoff_notes_enabled',
    'use_worktrees',
    'task_id_prefix',
    'github_poll_interval',
    'plugins',
  ]
  const githubOnlyExcludeKeys = [
    'code_cleanup_tasks_enabled',
    'task_display_title_metadata_updates_enabled',
    'handoff_notes_enabled',
    'ai_provider',
    'use_worktrees',
    'task_id_prefix',
    'plugins',
  ]

  // Sync project name/path from project list
  $effect(() => {
    const { projectName: nextProjectName, projectPath: nextProjectPath } = getProjectIdentity($activeProjectId, $projects)
    projectName = nextProjectName
    projectPath = nextProjectPath
  })

  function applyProjectSettings(settings: ProjectSettingsConfig) {
    agentInstructions = settings.agentInstructions
    handoffNotesTemplate = settings.handoffNotesTemplate
    projectColor = settings.projectColor
    runCommand = settings.runCommand
    focusFilterStates = settings.focusFilterStates
  }

  // Load the General-card settings plus the raw hierarchy overrides and project
  // plugin enablement, guarding against races when the active project changes.
  async function reloadProjectSettings(pid: string) {
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
    } catch (e) {
      if (requestId !== projectSettingsRequestId) return
      projectSettingsLoadError = getErrorMessage(e)
      $error = projectSettingsLoadError
    } finally {
      if (requestId === projectSettingsRequestId) {
        projectSettingsLoading = false
      }
    }
  }

  // Load project config on activeProjectId change
  $effect(() => {
    const pid = $activeProjectId

    if (mode === 'project' && pid) {
      void reloadProjectSettings(pid)
    } else {
      // Cancel any in-flight load and reset to the empty/default project state.
      projectSettingsRequestId++
      projectSettingsLoadError = null
      projectSettingsLoading = false
      agentInstructions = ''
      handoffNotesTemplate = ''
      projectColor = ''
      runCommand = ''
      focusFilterStates = [...DEFAULT_FOCUS_STATES]
      projectRawOverrides = {}
    }
  })

  $effect(() => {
    if (!settingsCategories.some((category) => category.id === activeSection)) {
      activeSection = 'general'
    }
  })

  // Load global config once on mount
  onMount(async () => {
    const globalSettingsPromise = loadGlobalSettings()
    const installationStatusPromise = refreshInstallationStatus()
    const whisperStatusesPromise = loadWhisperModelStatuses()

    try {
      const globalSettings = await globalSettingsPromise

      taskIdPrefix = globalSettings.taskIdPrefix
      githubToken = globalSettings.githubToken
      isCodeCleanupTasksEnabled = globalSettings.codeCleanupTasksEnabled
      $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
      isTaskDisplayTitleMetadataUpdatesEnabled = globalSettings.taskDisplayTitleMetadataUpdatesEnabled
      githubPollInterval = globalSettings.githubPollInterval
      globalHandoffNotesEnabled = globalSettings.handoffNotesEnabled
      globalUseWorktrees = globalSettings.useWorktrees
      globalAiProvider = globalSettings.aiProvider
      globalSettingsLoaded = true
    } catch (e) {
      globalSettingsLoadError = getErrorMessage(e)
      $error = globalSettingsLoadError
    }

    try {
      const defaults = await getGlobalPluginDefaults()
      globalPluginDefaults = new Map(defaults.map((d) => [d.pluginId, d.enabled]))
    } catch (e) {
      console.error('Failed to load global plugin defaults:', e)
    }

    modelStatuses = await whisperStatusesPromise
    await installationStatusPromise

  })

  function captureCurrentSave(): boolean {
    if (mode === 'project' && hasProject && $activeProjectId) {
      pendingProjectSettingsSave = {
        projectId: $activeProjectId,
        projectName,
        projectPath,
        agentInstructions,
        handoffNotesTemplate,
        projectColor,
        runCommand,
        focusFilterStates,
      }
      return true
    }

    if (mode === 'global' && globalSettingsLoaded) {
      pendingGlobalSettingsSave = {
        taskIdPrefix,
        githubToken,
        codeCleanupTasksEnabled: isCodeCleanupTasksEnabled,
        taskDisplayTitleMetadataUpdatesEnabled: isTaskDisplayTitleMetadataUpdatesEnabled,
        githubPollInterval,
        handoffNotesEnabled: globalHandoffNotesEnabled,
        useWorktrees: globalUseWorktrees,
        aiProvider: globalAiProvider,
      }
      return true
    }

    return false
  }

  function isLatestProjectIdentityPayload(payload: ProjectSettingsSavePayload): boolean {
    const newerPendingProjectSave = pendingProjectSettingsSave
    if (newerPendingProjectSave?.projectId === payload.projectId) {
      return newerPendingProjectSave.projectName === payload.projectName && newerPendingProjectSave.projectPath === payload.projectPath
    }

    if ($activeProjectId === payload.projectId) {
      return projectName === payload.projectName && projectPath === payload.projectPath
    }

    return true
  }

  async function save() {
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
        await onProjectSettingsSaved?.()
        if (isLatestProjectIdentityPayload(projectPayload)) {
          $projects = mergeUpdatedProject($projects, {
            id: projectPayload.projectId,
            name: projectPayload.projectName,
            path: projectPayload.projectPath,
          })
        }
      }
      if (globalPayload) {
        await saveGlobalSettings(globalPayload)
      }
      saved = true
      saveStatus = 'saved'
      savedStatusTimer = setTimeout(() => {
        saved = false
        if (saveStatus === 'saved') {
          saveStatus = 'idle'
        }
        savedStatusTimer = null
      }, 2000)
    } catch (e) {
      console.error('Failed to save settings:', e)
      saveError = getErrorMessage(e)
      saveStatus = 'error'
      $error = saveError
      throw e
    } finally {
      isSaving = false
    }
  }

  function scheduleSave() {
    if (!captureCurrentSave()) return

    clearSavedStatusTimer()
    saved = false
    saveError = null
    saveStatus = 'dirty'
    void saveController.schedule().catch(() => {})
  }

  function flushPendingSave() {
    return saveController.flush()
  }

  onDestroy(() => {
    clearSavedStatusTimer()
    void flushPendingSave().catch(() => {})
  })

  function runImmediateSave() {
    if (!captureCurrentSave()) return Promise.resolve()

    return saveController.runImmediately()
  }

  async function handleDelete() {
    if (!$activeProjectId) return
    isDeleting = true
    deleteError = null
    try {
      await deleteProject($activeProjectId)
      onProjectDeleted()
      onClose()
    } catch (e) {
      console.error('Failed to delete project:', e)
      deleteError = e instanceof Error ? e.message : String(e)
    } finally {
      isDeleting = false
      confirmingDelete = false
    }
  }

  async function handleModelChange(newSize: string) {
    await setWhisperModel(newSize as WhisperModelSizeId)
    modelStatuses = await loadWhisperModelStatuses()
  }

  function handleDownloadModel(modelSize: string) {
    downloadingModel = modelSize as WhisperModelSizeId
  }

  async function refreshModelStatuses() {
    downloadingModel = null
    modelStatuses = await loadWhisperModelStatuses()
  }
</script>

<div class="flex h-full w-full flex-col overflow-hidden bg-base-200 lg:flex-row">
  <SettingsCategoryNav
    categories={settingsCategories}
    activeId={activeSection}
    onSelect={(id) => { activeSection = id }}
  />

  <main class="min-w-0 flex-1 overflow-y-auto bg-base-200" aria-label={activePage === 'project' ? 'Project settings' : 'Global settings'}>
    <ProjectPageHeader
      title={activePage === 'project'
        ? `${projectName || 'Project'} / Project Settings`
        : 'Global Settings'}
      subtitle={activePage === 'project'
        ? 'Configure settings for this project only. Inherited defaults remain visible.'
        : 'Configure app-wide defaults, integrations, and credentials.'}
    >
      {#snippet actions()}
        <div class="flex flex-wrap items-center justify-end gap-2">
          <div class="min-w-32 text-right text-xs" aria-live="polite">
            {#if projectSettingsLoadError || globalSettingsLoadError}
              <span class="font-medium text-error">Failed to load settings: {projectSettingsLoadError ?? globalSettingsLoadError}</span>
            {:else if settingsLoading}
              <span class="inline-flex items-center gap-2 text-base-content/60"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Loading settings…</span>
            {:else if saveStatus === 'dirty'}
              <span class="font-medium text-warning">Unsaved changes — autosaving soon…</span>
            {:else if isSaving || saveStatus === 'saving'}
              <span class="inline-flex items-center gap-2 text-base-content/60"><span class="loading loading-spinner loading-xs" aria-hidden="true"></span>Saving changes…</span>
            {:else if saved || saveStatus === 'saved'}
              <span class="font-medium text-success">All changes saved</span>
            {:else if saveStatus === 'error'}
              <span class="inline-flex items-center gap-2 text-error">
                Autosave failed: {saveError}
                <button type="button" class="btn btn-xs btn-error" onclick={runImmediateSave}>Retry autosave</button>
              </span>
            {:else}
              <span class="text-base-content/55">Autosaves changes</span>
            {/if}
          </div>

          {#if activePage === 'project'}
            <span class="badge min-h-8 border-warning/35 bg-warning/10 px-3 text-warning">
              {projectOverrideCount} {projectOverrideCount === 1 ? 'override' : 'overrides'}
            </span>
            <button
              type="button"
              class="btn btn-outline btn-sm min-h-10"
              onclick={handleResetToGlobal}
              disabled={!hasProject || projectOverrideCount === 0}
            >
              <RotateCcw size={15} aria-hidden="true" />
              Reset all
            </button>
          {/if}

          <button type="button" class="btn btn-ghost btn-sm min-h-10" onclick={onClose}>Back to Board</button>
        </div>
      {/snippet}
    </ProjectPageHeader>

    {#snippet providerHealthField(providerValue: string, scope: 'global' | 'project')}
      <ProviderSelectField
        aiProvider={providerValue}
        {opencodeInstalled}
        {opencodeVersion}
        {claudeInstalled}
        {claudeVersion}
        {claudeAuthenticated}
        {piInstalled}
        {piVersion}
        {codexInstalled}
        {codexVersion}
        {grokInstalled}
        {grokVersion}
        {grokAuthenticated}
        {installationStatusLoading}
        {installationStatusError}
        disabled={scope === 'project' ? !hasProject : !globalSettingsLoaded}
        onChange={(value) => scope === 'project'
          ? handleProjectSettingChange('ai_provider', value)
          : handleGlobalSettingChange('ai_provider', value)}
        onRefreshInstallationStatus={refreshInstallationStatus}
      />
    {/snippet}

    <div class="mx-auto flex w-full max-w-[76rem] flex-col gap-5 p-4 sm:p-6 xl:p-8">
      {#if activePage === 'project'}
        {#if activeSection === 'general'}
          <SettingsGeneralCard
            {projectName}
            {projectPath}
            {projectColor}
            {runCommand}
            disabled={!hasProject}
            onProjectNameChange={(value) => { projectName = value; scheduleSave() }}
            onProjectPathChange={(value) => { projectPath = value; scheduleSave() }}
            onProjectColorChange={handleProjectColorChange}
            onRunCommandChange={(value) => { runCommand = value; scheduleSave() }}
          />
        {:else if activeSection === 'agents'}
          <HierarchicalSettingsCard
            mode="project"
            values={projectHierarchyValues}
            overrides={projectRawOverrides}
            excludeKeys={['plugins']}
            onChange={handleProjectSettingChange}
            onResetSetting={handleResetProjectSetting}
            resettingKey={resettingProjectSetting}
            disabled={!hasProject}
          >
            {#snippet providerField()}{@render providerHealthField(projectHierarchyValues.ai_provider, 'project')}{/snippet}
          </HierarchicalSettingsCard>
        {:else if activeSection === 'labels'}
          <SettingsTaskLabelsCard projectId={$activeProjectId} disabled={!hasProject} />
        {:else if activeSection === 'focus'}
          <SettingsFocusFilterCard
            focusStates={focusFilterStates}
            onFocusStatesChange={(states) => { focusFilterStates = states; scheduleSave() }}
            disabled={!hasProject}
          />
        {:else if activeSection === 'instructions'}
          <SettingsInstructionsCard
            {agentInstructions}
            {handoffNotesTemplate}
            disabled={!hasProject}
            onInstructionsChange={(value) => { agentInstructions = value; scheduleSave() }}
            onHandoffNotesTemplateChange={(value) => { handoffNotesTemplate = value; scheduleSave() }}
          />
        {:else if activeSection === 'plugins'}
          <PluginSettingsPanel projectId={$activeProjectId || ''} disabled={!hasProject} />
          {#each pluginSettingsSections as section (section.namespacedId)}
            <SettingsSectionCard title={section.title}>
              <PluginSlot
                slotType="settingsSections"
                slotId={section.namespacedId}
                projectId={$activeProjectId}
                projectName={projectName}
              />
            </SettingsSectionCard>
          {/each}
        {:else if activeSection === 'danger' && hasProject}
          <SettingsSectionCard title="Danger Zone" description="Actions here permanently affect this project." tone="danger">
            <div class="flex flex-col gap-3">
              <div class="flex min-h-10 flex-wrap items-center gap-3">
                {#if confirmingDelete}
                  <span class="text-sm font-medium text-error">Delete “{projectName}”? This cannot be undone.</span>
                  <button class="btn btn-error btn-sm min-h-10" onclick={handleDelete} disabled={isDeleting}>
                    {isDeleting ? 'Deleting…' : 'Yes, delete'}
                  </button>
                  <button class="btn btn-ghost btn-sm min-h-10" onclick={() => { confirmingDelete = false; deleteError = null }} disabled={isDeleting}>Cancel</button>
                {:else}
                  <button class="btn btn-error btn-sm min-h-10" onclick={() => { confirmingDelete = true; deleteError = null }}>Delete Project</button>
                {/if}
              </div>
              {#if deleteError}<p class="m-0 break-all font-mono text-sm text-error" role="alert">{deleteError}</p>{/if}
            </div>
          </SettingsSectionCard>
        {/if}
      {:else}
        {#if activeSection === 'general'}
          <HierarchicalSettingsCard
            mode="global"
            values={globalHierarchyValues}
            excludeKeys={globalGeneralExcludeKeys}
            onChange={handleGlobalSettingChange}
            disabled={!globalSettingsLoaded}
          />
          <SettingsPreferencesCard
            {isDarkMode}
            onThemeToggle={() => { handleThemeToggle(); scheduleSave() }}
          />
        {:else if activeSection === 'agents'}
          <HierarchicalSettingsCard
            mode="global"
            values={globalHierarchyValues}
            excludeKeys={providerOnlyExcludeKeys}
            onChange={handleGlobalSettingChange}
            disabled={!globalSettingsLoaded}
          >
            {#snippet providerField()}{@render providerHealthField(globalHierarchyValues.ai_provider, 'global')}{/snippet}
          </HierarchicalSettingsCard>
        {:else if activeSection === 'github'}
          <SettingsCredentialsCard
            {githubToken}
            onGithubTokenChange={(value: string) => { githubToken = value; scheduleSave() }}
            disabled={!globalSettingsLoaded}
          />
          <HierarchicalSettingsCard
            mode="global"
            values={globalHierarchyValues}
            excludeKeys={githubOnlyExcludeKeys}
            onChange={handleGlobalSettingChange}
            disabled={!globalSettingsLoaded}
          />
        {:else if activeSection === 'voice'}
          <SettingsAICard
            {modelStatuses}
            activeModelSize={modelStatuses.find((model) => model.is_active)?.size ?? null}
            {downloadingModel}
            onWhisperModelSelect={handleModelChange}
            onDownloadModel={handleDownloadModel}
            onDownloadComplete={refreshModelStatuses}
            onDownloadError={() => { downloadingModel = null }}
          />
        {:else if activeSection === 'plugins'}
          <GlobalPluginSettingsPanel
            activeProjectId={$activeProjectId}
            pluginDefaults={globalPluginDefaultsById}
            onToggleDefault={handleGlobalPluginToggle}
            disabled={!globalSettingsLoaded}
          />
        {:else if activeSection === 'companion'}
          <SettingsCompanionCard />
        {:else if activeSection === 'developer'}
          <SettingsDeveloperLogsCard />
        {/if}
      {/if}
    </div>
  </main>
</div>
