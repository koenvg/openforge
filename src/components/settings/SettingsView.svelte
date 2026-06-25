<script lang="ts">
  import { onMount, onDestroy, tick } from 'svelte'
  import { activeProjectColorId, activeProjectId, projects, codeCleanupTasksEnabled, error } from '../../lib/stores'
  import {
    deleteProject,
    setWhisperModel,
  } from '../../lib/ipc'
  import { createAction, DEFAULT_ACTIONS } from '../../lib/actions'
  import { DEFAULT_FOCUS_STATES } from '../../lib/boardFilters'
  import { createTrackedDebouncedSave } from '../../lib/createTrackedDebouncedSave'
  import {
    DEFAULT_GITHUB_POLL_INTERVAL_SECONDS,
    loadGlobalSettings,
    loadInstallationStatus,
    loadProjectSettings,
    loadWhisperModelStatuses,
  } from '../../lib/settingsConfig'
  import { mergeUpdatedProject, getProjectIdentity } from '../../lib/settingsProjectSync'
  import { saveGlobalSettings, saveProjectSettings } from '../../lib/settingsSaver'
  import type { GlobalSettingsSavePayload, ProjectSettingsSavePayload } from '../../lib/settingsSaver'
  import { themeMode, applyTheme } from '../../lib/theme'
  import type { ThemeMode } from '../../lib/theme'
  import type { Action, WhisperModelStatus, WhisperModelSizeId } from '../../lib/types'
  import type { TaskState } from '../../lib/taskState'
  import { resolveContributions } from '../../lib/plugin/contributionResolver'
  import { enabledPluginIds, runtimeContributionSources } from '../../lib/plugin/pluginStore'
  import SettingsGeneralCard from './SettingsGeneralCard.svelte'
  import SettingsFocusFilterCard from './SettingsFocusFilterCard.svelte'
  import SettingsPreferencesCard from './SettingsPreferencesCard.svelte'
  import SettingsAICard from './SettingsAICard.svelte'
  import SettingsInstructionsCard from './SettingsInstructionsCard.svelte'
  import SettingsCredentialsCard from './SettingsCredentialsCard.svelte'
  import SettingsActionsCard from './SettingsActionsCard.svelte'
  import SettingsExperimentalCard from './SettingsExperimentalCard.svelte'
  import ProjectPageHeader from '../project/ProjectPageHeader.svelte'
  import PluginSlot from '../plugin/PluginSlot.svelte'
  import PluginSettingsPanel from '../plugin/PluginSettingsPanel.svelte'

  interface Props {
    onClose: () => void
    onProjectDeleted: () => void
    mode: 'project' | 'global'
  }

  let { onClose, onProjectDeleted, mode }: Props = $props()

  type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

  // Project state
  let projectName = $state('')
  let projectPath = $state('')
  let agentInstructions = $state('')
  let handoffNotesTemplate = $state('')
  let aiProvider = $state('claude-code')
  let projectColor = $state('')

  // Global state
  let taskIdPrefix = $state('')
  let githubToken = $state('')
  let githubPollInterval = $state(DEFAULT_GITHUB_POLL_INTERVAL_SECONDS)
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

  // Actions state
  let actions = $state<Action[]>([])
  // Focus filter state
  let focusFilterStates = $state<TaskState[]>([...DEFAULT_FOCUS_STATES])

  // Feature flag state
  let isCodeCleanupTasksEnabled = $state($codeCleanupTasksEnabled)
  // Theme state
  let isDarkMode = $state($themeMode === 'dark')

  $effect(() => {
    isDarkMode = $themeMode === 'dark'
  })

  function handleThemeToggle() {
    const next: ThemeMode = isDarkMode ? 'light' : 'dark'
    applyTheme(next)
  }

  function handleCodeCleanupTasksToggle() {
    isCodeCleanupTasksEnabled = !isCodeCleanupTasksEnabled
    $codeCleanupTasksEnabled = isCodeCleanupTasksEnabled
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
  const projectSections = ['general', 'instructions', 'plugins', 'actions']
  const globalSections = ['preferences', 'ai', 'credentials', 'experimental']

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
  let pluginSettingsSections = $derived(resolveContributions(enabledPluginContributionSources).settingsSections)

  // Sync project name/path from project list
  $effect(() => {
    const { projectName: nextProjectName, projectPath: nextProjectPath } = getProjectIdentity($activeProjectId, $projects)
    projectName = nextProjectName
    projectPath = nextProjectPath
  })

  // Load project config on activeProjectId change
  $effect(() => {
    const pid = $activeProjectId
    const requestId = ++projectSettingsRequestId
    projectSettingsLoadError = null

    if (mode === 'project' && pid) {
      projectSettingsLoading = true
      loadProjectSettings(pid)
        .then((settings) => {
          if (requestId !== projectSettingsRequestId) return
          agentInstructions = settings.agentInstructions
          handoffNotesTemplate = settings.handoffNotesTemplate
          aiProvider = settings.aiProvider
          projectColor = settings.projectColor
          actions = settings.actions
          focusFilterStates = settings.focusFilterStates
        })
        .catch((e) => {
          if (requestId !== projectSettingsRequestId) return
          projectSettingsLoadError = getErrorMessage(e)
          $error = projectSettingsLoadError
        })
        .finally(() => {
          if (requestId === projectSettingsRequestId) {
            projectSettingsLoading = false
          }
        })
    } else {
      projectSettingsLoading = false
      agentInstructions = ''
      handoffNotesTemplate = ''
      aiProvider = 'claude-code'
      projectColor = ''
      actions = []
      focusFilterStates = [...DEFAULT_FOCUS_STATES]
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
      githubPollInterval = globalSettings.githubPollInterval
      globalSettingsLoaded = true
    } catch (e) {
      globalSettingsLoadError = getErrorMessage(e)
      $error = globalSettingsLoadError
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
        aiProvider,
        projectColor,
        actions,
        focusFilterStates,
      }
      return true
    }

    if (mode === 'global' && globalSettingsLoaded) {
      pendingGlobalSettingsSave = {
        taskIdPrefix,
        githubToken,
        codeCleanupTasksEnabled: isCodeCleanupTasksEnabled,
        githubPollInterval,
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

  function addAction() {
    actions = [...actions, createAction('New Action', '')]
  }

  async function removeAction(actionId: string) {
    actions = actions.filter((a) => a.id !== actionId)
    if ($activeProjectId) {
      await tick()
      await runImmediateSave()
    }
  }

  function toggleAction(actionId: string) {
    actions = actions.map((a) => (a.id === actionId ? { ...a, enabled: !a.enabled } : a))
  }

  function updateAction(actionId: string, field: string, value: string) {
    actions = actions.map((a) =>
      a.id === actionId ? { ...a, [field]: value } : a
    )
  }

  async function resetActions() {
    actions = [...DEFAULT_ACTIONS]
    if ($activeProjectId) {
      await tick()
      await runImmediateSave()
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
    <div class="px-6 py-6 flex flex-col gap-6">
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
          {aiProvider}
          {projectColor}
          disabled={!hasProject}
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
          onProjectNameChange={(v) => { projectName = v; scheduleSave() }}
          onProjectPathChange={(v) => { projectPath = v; scheduleSave() }}
          onAiProviderChange={(v) => { aiProvider = v; scheduleSave() }}
          onProjectColorChange={handleProjectColorChange}
          onRefreshInstallationStatus={refreshInstallationStatus}
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
          <div class="bg-base-100 rounded-lg border border-base-300 overflow-hidden">
            <div class="px-5 py-3 border-b border-base-300">
              <h3 class="text-sm font-semibold text-base-content m-0">{section.title}</h3>
            </div>
            <div class="p-5">
              <PluginSlot
                slotType="settingsSections"
                slotId={section.namespacedId}
                projectId={$activeProjectId}
                projectName={projectName}
              />
            </div>
          </div>
        {/each}

        <SettingsActionsCard
          {actions}
          disabled={!hasProject}
          onAddAction={() => { addAction(); scheduleSave() }}
          onDeleteAction={removeAction}
          onToggleAction={(id: string) => { toggleAction(id); scheduleSave() }}
          onUpdateAction={(id: string, field: string, value: string) => { updateAction(id, field, value); scheduleSave() }}
          onResetActions={resetActions}
        />

        {#if hasProject}
          <div class="bg-base-100 rounded-lg border border-error/30 overflow-hidden">
            <div class="px-5 py-3 border-b border-error/30">
              <h3 class="text-sm font-semibold text-error m-0">Danger Zone</h3>
            </div>
            <div class="p-5 flex flex-col gap-3">
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
          </div>
        {/if}
      {:else}
        <SettingsPreferencesCard
          {taskIdPrefix}
          onTaskIdPrefixChange={(v) => { taskIdPrefix = v; scheduleSave() }}
          {isDarkMode}
          onThemeToggle={() => { handleThemeToggle(); scheduleSave() }}
          {githubPollInterval}
          onGithubPollIntervalChange={(v) => { githubPollInterval = v; scheduleSave() }}
          disabled={!globalSettingsLoaded}
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

        <SettingsExperimentalCard
          codeCleanupTasksEnabled={isCodeCleanupTasksEnabled}
          onCodeCleanupTasksToggle={() => { handleCodeCleanupTasksToggle(); scheduleSave() }}
          disabled={!globalSettingsLoaded}
        />
      {/if}
    </div>
  </div>
</div>
