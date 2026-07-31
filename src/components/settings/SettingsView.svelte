<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
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
  import { mergeUpdatedProject, getProjectIdentity, resetProjectAndReload } from '../../lib/settingsProjectSync'
  import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
  import type { GlobalSettingsSavePayload, ProjectSettingsSavePayload } from '../../lib/settingsSaver'
  import { themeMode, applyTheme } from '../../lib/theme'
  import type { ThemeMode } from '../../lib/theme'
  import type { WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import ProviderSelectField from './ProviderSelectField.svelte'
  import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsTaskLabelsCard from './SettingsTaskLabelsCard.svelte'
  import HierarchicalSettingsCard from './HierarchicalSettingsCard.svelte'
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
      await resetProjectAndReload(pid, () => reloadProjectSettings(pid))
    } catch (e) {
      $error = getErrorMessage(e)
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
  const getInitialActiveSection = () => mode === 'global' ? 'preferences' : 'general'

  let activeSection = $state(getInitialActiveSection())
  let isDeleting = $state(false)
  let confirmingDelete = $state(false)
  let deleteError = $state<string | null>(null)

  // Scroll spy
  let scrollContainer = $state<HTMLDivElement | null>(null)
  let isNavigating = false
  const projectSections = ['general', 'labels', 'instructions', 'plugins']
  const globalSections = ['configuration', 'preferences', 'ai', 'credentials', 'plugins', 'developer']

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
  const activePage = $derived(mode === 'global' ? 'global' : mode === 'project' ? 'project' : (globalSections.includes(activeSection) ? 'global' : 'project'))
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

  // Default to correct page based on mode
  $effect(() => {
    if (mode === 'global' && projectSections.includes(activeSection)) {
      activeSection = 'preferences'
    } else if (mode === 'project' && globalSections.includes(activeSection)) {
      activeSection = 'general'
    } else if (!hasProject && projectSections.includes(activeSection)) {
      activeSection = 'preferences'
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

  // Scroll spy: re-observe whenever conditional sections mount/unmount
  $effect(() => {
    const container = scrollContainer
    void hasProject
    const sections = activePage === 'project' ? projectSections : globalSections

    if (!container || typeof IntersectionObserver === 'undefined') return

    const visible = new Set<string>()

    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id.replace('section-', '')
          if (entry.isIntersecting) {
            visible.add(id)
          } else {
            visible.delete(id)
          }
        }
        if (isNavigating) return
        for (const id of sections) {
          if (visible.has(id)) {
            activeSection = id
            return
          }
        }
      },
      {
        root: container,
        rootMargin: '0px 0px -50% 0px',
        threshold: 0,
      }
    )

    container.querySelectorAll('[id^="section-"]').forEach((s) => {
      obs.observe(s)
    })

    return () => obs.disconnect()
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

<div class="flex h-full w-full">
  <div bind:this={scrollContainer} class="flex-1 overflow-y-auto" style="background: linear-gradient(180deg, var(--project-bg-alt, oklch(var(--b2))) 0%, var(--project-bg, oklch(var(--b1))) 100%)">
    <div class="flex w-full flex-col gap-6 px-6 py-6">
      <ProjectPageHeader
        title={activePage === 'project'
          ? `${projectName || 'Project'} — Project Settings`
          : 'Global Settings'}
        subtitle={activePage === 'project'
          ? 'Configure settings for this project only'
          : 'Configure app-wide preferences and credentials'}
      >
        {#snippet actions()}
          <div class="flex items-center gap-3">
            <div class="flex flex-col items-end gap-1 text-xs" aria-live="polite">
              <span class="text-base-content/60">Autosaves changes</span>
              {#if projectSettingsLoadError || globalSettingsLoadError}
                <span class="text-error">Failed to load settings: {projectSettingsLoadError ?? globalSettingsLoadError}</span>
              {:else if settingsLoading}
                <span class="text-base-content/50">Loading settings…</span>
              {:else if saveStatus === 'dirty'}
                <span class="text-warning">Unsaved changes — autosaving soon…</span>
              {:else if isSaving || saveStatus === 'saving'}
                <span class="text-base-content/50">Saving changes…</span>
              {:else if saved || saveStatus === 'saved'}
                <span class="text-success">All changes saved</span>
              {:else if saveStatus === 'error'}
                <div class="flex items-center gap-2">
                  <span class="text-error">Autosave failed: {saveError}</span>
                  <button type="button" class="btn btn-xs btn-error" onclick={runImmediateSave}>Retry autosave</button>
                </div>
              {/if}
            </div>
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              onclick={onClose}
            >
              Back to Board
            </button>
          </div>
        {/snippet}
      </ProjectPageHeader>

      {#if activePage === 'project'}
        <SettingsGeneralCard
          {projectName}
          {projectPath}
          {projectColor}
          {runCommand}
          disabled={!hasProject}
          onProjectNameChange={(v) => { projectName = v; scheduleSave() }}
          onProjectPathChange={(v) => { projectPath = v; scheduleSave() }}
          onProjectColorChange={handleProjectColorChange}
          onRunCommandChange={(v) => { runCommand = v; scheduleSave() }}
        />

        <HierarchicalSettingsCard
          mode="project"
          values={projectHierarchyValues}
          excludeKeys={['plugins']}
          onChange={handleProjectSettingChange}
          onResetToGlobal={handleResetToGlobal}
          disabled={!hasProject}
        >
          {#snippet providerField()}
            <ProviderSelectField
              aiProvider={projectHierarchyValues.ai_provider}
              {opencodeInstalled}
              {opencodeVersion}
              {claudeInstalled}
              {claudeVersion}
              {claudeAuthenticated}
              {piInstalled}
              {piVersion}
              {codexInstalled}
              {codexVersion}
              {installationStatusLoading}
              {installationStatusError}
              disabled={!hasProject}
              onChange={(v) => handleProjectSettingChange('ai_provider', v)}
              onRefreshInstallationStatus={refreshInstallationStatus}
            />
          {/snippet}
        </HierarchicalSettingsCard>

        <SettingsTaskLabelsCard
          projectId={$activeProjectId}
          disabled={!hasProject}
        />

        <SettingsFocusFilterCard
          focusStates={focusFilterStates}
          onFocusStatesChange={(states) => { focusFilterStates = states; scheduleSave() }}
          disabled={!hasProject}
        />

        <SettingsInstructionsCard
          {agentInstructions}
          {handoffNotesTemplate}
          disabled={!hasProject}
          onInstructionsChange={(v) => { agentInstructions = v; scheduleSave() }}
          onHandoffNotesTemplateChange={(v) => { handoffNotesTemplate = v; scheduleSave() }}
        />

        <PluginSettingsPanel
          projectId={$activeProjectId || ''}
          disabled={!hasProject}
        />

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

        {#if hasProject}
          <SettingsSectionCard title="Danger Zone" tone="danger">
            <div class="flex flex-col gap-3">
              <div class="flex items-center gap-3">
                {#if confirmingDelete}
                  <span class="text-sm text-error">Delete "{projectName}"? This cannot be undone.</span>
                  <button class="btn btn-error btn-sm" onclick={handleDelete} disabled={isDeleting}>
                    {isDeleting ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button class="btn btn-ghost btn-sm" onclick={() => { confirmingDelete = false; deleteError = null }} disabled={isDeleting}>
                    Cancel
                  </button>
                {:else}
                  <button class="btn btn-error btn-sm" onclick={() => { confirmingDelete = true; deleteError = null }}>
                    Delete Project
                  </button>
                {/if}
              </div>
              {#if deleteError}
                <p class="text-sm text-error font-mono break-all">{deleteError}</p>
              {/if}
            </div>
          </SettingsSectionCard>
        {/if}
      {:else}
        <HierarchicalSettingsCard
          mode="global"
          values={globalHierarchyValues}
          excludeKeys={['plugins']}
          onChange={handleGlobalSettingChange}
          disabled={!globalSettingsLoaded}
        />

        <SettingsPreferencesCard
          {isDarkMode}
          onThemeToggle={() => { handleThemeToggle(); scheduleSave() }}
        />

        <SettingsAICard
          {modelStatuses}
          activeModelSize={modelStatuses.find((m) => m.is_active)?.size ?? null}
          {downloadingModel}
          onWhisperModelSelect={handleModelChange}
          onDownloadModel={handleDownloadModel}
          onDownloadComplete={refreshModelStatuses}
          onDownloadError={() => {
            downloadingModel = null
          }}
        />

        <SettingsCredentialsCard
          {githubToken}
          onGithubTokenChange={(v: string) => { githubToken = v; scheduleSave() }}
          disabled={!globalSettingsLoaded}
        />

        <GlobalPluginSettingsPanel
          activeProjectId={$activeProjectId}
          pluginDefaults={globalPluginDefaultsById}
          onToggleDefault={handleGlobalPluginToggle}
          disabled={!globalSettingsLoaded}
        />

        <SettingsCompanionCard />

        <SettingsDeveloperLogsCard />
      {/if}
    </div>
  </div>
</div>
