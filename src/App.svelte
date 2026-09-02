<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { tasks, taskDetailsById, dependencyReferenceTasks, pendingTask, selectedTaskId, activeSessions, ticketPrs, taskAttentionRows, taskAttentionLoaded, isLoading, projects, activeProjectId, currentView, reviewRequestCount, activeRepoReviewRequestCount, activeProjectAttentionCount, projectAttention, focusBoardFilters, outOfFocusTaskIdsByProject, sidebarPluginViewKeys, taskActiveView } from './lib/stores'
  import { zenMode, isZenActive, canToggleZenMode } from './lib/zenMode'
  import { setPollContext, getProjectRepo } from './lib/ipc'
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY } from './lib/githubSyncPlugin'
  import ProjectDashboardProviderHost from './components/focus-board/ProjectDashboardProviderHost.svelte'
  import TaskDetailProviderHost from './components/task-detail/TaskDetailProviderHost.svelte'
  import AppTaskCreationDialogs from './components/shell/AppTaskCreationDialogs.svelte'
  import BranchDivergenceModal from './components/BranchDivergenceModal.svelte'
  import AppCloseConfirmationDialog from './components/shell/AppCloseConfirmationDialog.svelte'
  import AppShortcutHelpDialog from './components/shell/AppShortcutHelpDialog.svelte'
  import ToastHost from './components/feedback/toasts/ToastHost.svelte'
  import AppSidebar from './components/shell/AppSidebar.svelte'
  import ProjectSwitcherModal from './components/project/ProjectSwitcherModal.svelte'
  import AttentionOverviewDialog from './components/attention/AttentionOverviewDialog.svelte'
  import ProjectSetupDialog from './components/project/ProjectSetupDialog.svelte'
  import IconRail from './components/shell/IconRail.svelte'
  import CommandPalette from './components/shell/CommandPalette.svelte'
  import ActionPalette from './components/shell/ActionPalette.svelte'
  import FileQuickOpen from './components/shell/FileQuickOpen.svelte'
  import PluginSlot from './components/plugin/PluginSlot.svelte'

  import { resolveContributions } from './lib/plugin/contributionResolver'
  import { enabledPluginIds, installedPlugins, runtimeContributionSources } from './lib/plugin/pluginStore'
  import {
    CORE_PROJECT_DASHBOARD_PROVIDER_ID,
    INHERIT_PROJECT_DASHBOARD_PROVIDER_ID,
    globalProjectDashboardProviderId,
    globalProjectDashboardProviderLoaded,
    loadGlobalProjectDashboardProviderId,
    loadProjectDashboardProviderId,
    projectDashboardProviderIds,
    resolveProjectDashboardProviderAvailability,
  } from './lib/plugin/projectDashboardProviders'
  import { activatePlugin, deactivateAllPlugins, executePluginCommand, loadEnabledForProject } from './lib/plugin/pluginRegistry'
  import { useAppRouter } from './lib/router.svelte'
  import { useCommandHeld } from './lib/useCommandHeld.svelte'
  import { isCrossProjectView } from './lib/views'
  import { toggleVoiceInputShortcut } from './lib/voiceInputShortcut'
  import { useAppShortcutHelpController } from './lib/appShortcutHelpController.svelte'
  import { useAppDataOrchestrator } from './lib/appDataOrchestrator.svelte'
  import { createTaskActionRunner } from './lib/taskActionRunner'
  import { useAppTaskCreationController } from './lib/appTaskCreationController.svelte'
  import { createAppNavigationController } from './lib/appNavigationController'
  import { createReviewNavigationController } from './lib/reviewNavigationController'
  import { createAppPluginController } from './lib/appPluginController'
  import { resolveAppPluginPresentation } from './lib/appPluginPresentation'
  import { createAppProjectController } from './lib/appProjectController'
  import { createAppRendererContextController } from './lib/appRendererContextController'
  import { createAppShellLifecycleController } from './lib/appShellLifecycleController'
  import { useActionPaletteController } from './lib/actionPaletteController.svelte'
  import type { TaskRunAppRegistration } from './components/task-detail/taskRunAppController'
  import { useAppCloseController } from './lib/appCloseController.svelte'

  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let appReady = $state(false)
  let showProjectSwitcher = $state(false)
  let showAttentionOverview = $state(false)
  let appSidebarCollapsed = $state(localStorage.getItem('appSidebarCollapsed') === 'true')
  let showCommandPalette = $state(false)
  let showFileQuickOpen = $state(false)
  let taskRunAppRegistration = $state<TaskRunAppRegistration | null>(null)
  let windowFocused = $state(true)
  let router = useAppRouter()
  let lifecycle!: ReturnType<typeof createAppShellLifecycleController>

  useCommandHeld()

  let selectedTaskRecord = $derived(
    ($selectedTaskId ? $taskDetailsById.get($selectedTaskId) : null)
      ?? $tasks.find(t => t.id === $selectedTaskId)
      ?? ($pendingTask?.id === $selectedTaskId ? $pendingTask : null)
  )
  let selectedTask = $derived(selectedTaskRecord)
  let selectedTaskForView = $derived(
    selectedTaskRecord
  )
  let activeProject = $derived($projects.find(p => p.id === $activeProjectId) || null)
  // Chrome is stripped only while the open task's agent tab is showing; switching
  // tabs (⌘2/⌘3) drops the effect without clearing the flag. See lib/zenMode.ts.
  let zenActive = $derived(isZenActive({
    zenMode: $zenMode,
    currentView: $currentView,
    selectedTaskId: $selectedTaskId,
    activeView: ($selectedTaskId ? ($taskActiveView.get($selectedTaskId) ?? 'agent') : 'agent'),
  }))
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )

  function closeAttentionOverview(): void {
    showAttentionOverview = false
  }

  function handleRunAppRegistrationChange(registration: TaskRunAppRegistration | null): void {
    taskRunAppRegistration = registration
  }

  const appData = useAppDataOrchestrator({
    setShowProjectSetup: (show) => { showProjectSetup = show },
  })
  const shortcutHelp = useAppShortcutHelpController()
  const closeController = useAppCloseController({
    refreshAttention: appData.loadProjectAttention,
    getAttention: () => get(projectAttention),
    getAppWindow: () => lifecycle.appWindow,
  })
  const taskActions = createTaskActionRunner({
    getActiveProject: () => activeProject,
    loadTasks: appData.loadTasks,
    loadProjectAttention: appData.loadProjectAttention,
  })
  const taskCreation = useAppTaskCreationController({
    getTasks: () => $tasks,
    loadTasks: appData.loadTasks,
    resetToBoard: () => { router.resetToBoard() },
    navigateToTask: (taskId) => { router.navigateToTask(taskId) },
    runAction: taskActions.handleRunAction,
  })
  const navigation = createAppNavigationController({
    router,
    loadTasks: appData.loadTasks,
    getSelectedTask: () => selectedTask,
    getSidebarPluginViewKeys: () => get(sidebarPluginViewKeys),
    closeAttentionOverview,
  })
  const reviewNavigation = createReviewNavigationController({
    closeAttentionOverview,
  })
  const actionPalette = useActionPaletteController({
    getSelectedTask: () => selectedTask,
    taskActions,
    goBack: () => { router.back() },
    showSearchTasks: () => { showCommandPalette = true },
    showNewTask: taskCreation.openNewTask,
    showProjectSwitcher: () => { showProjectSwitcher = true },
    triggerGithubSync: appData.triggerGithubSync,
    runApp: {
      capture: (task) => {
        const registration = taskRunAppRegistration
        return registration?.taskId === task.id && registration.available ? registration.run : null
      },
    },
  })
  const pluginController = createAppPluginController({
    navigate: navigation.navigate,
    executePluginCommand,
    activatePlugin,
    deactivateAllPlugins,
    loadEnabledForProject,
  })
  const projectController = createAppProjectController({
    clearPendingTask: () => { pendingTask.set(null) },
    clearSelectedTask: () => { selectedTaskId.set(null) },
    getFocusBoardFilters: () => get(focusBoardFilters),
    setFocusBoardFilters: (filters) => { focusBoardFilters.set(filters) },
    loadTasks: appData.loadTasks,
    loadPullRequests: appData.loadPullRequests,
    refreshPrCounts: appData.refreshPrCounts,
    loadProjects: appData.loadProjects,
    setActiveProject: (projectId) => { activeProjectId.set(projectId) },
    closeProjectSetup: () => { showProjectSetup = false },
    openProjectSettings: () => { router.navigate('settings') },
  })
  const rendererContext = createAppRendererContextController({
    globalPrViewKey: GITHUB_SYNC_GLOBAL_VIEW_KEY,
    reportPollContext: (payload) => { void setPollContext(payload) },
    resolveProjectRepo: (projectId) => { void getProjectRepo(projectId).catch(() => {}) },
  })
  const handleRunAction = taskActions.handleRunAction
  const handleProjectCreated = projectController.projectCreated

  let resolvedPluginContributions = $derived(resolveContributions(
    enabledPluginContributionSources
  ))
  let pluginPresentation = $derived(resolveAppPluginPresentation(
    enabledPluginContributionSources,
    resolvedPluginContributions,
    {
      activeProject,
      activeProjectId: $activeProjectId,
      currentView: $currentView,
      onCloseSettings: () => { router.navigate('board') },
      onProjectDeleted: appData.loadProjects,
      onProjectSettingsSaved: appData.refreshAttentionCounts,
    }
  ))
  let pluginNavItems = $derived(pluginPresentation.pluginNavItems)
  let sidebarPluginNavItems = $derived(pluginPresentation.sidebarPluginNavItems)
  let sidebarPluginViewKeySet = $derived(pluginPresentation.sidebarPluginViewKeySet)
  let renderedActiveView = $derived(pluginPresentation.renderedActiveView)
  let pluginViewActive = $derived(pluginPresentation.pluginViewActive)
  let projectDashboardProviderPreferenceLoaded = $derived(
    !$activeProjectId || $projectDashboardProviderIds.has($activeProjectId),
  )
  let projectDashboardProviderPreferenceId = $derived(
    $activeProjectId && projectDashboardProviderPreferenceLoaded
      ? ($projectDashboardProviderIds.get($activeProjectId) ?? INHERIT_PROJECT_DASHBOARD_PROVIDER_ID)
      : CORE_PROJECT_DASHBOARD_PROVIDER_ID,
  )
  let dashboardProviderResolution = $derived(resolveProjectDashboardProviderAvailability(
    projectDashboardProviderPreferenceId,
    $globalProjectDashboardProviderId,
    resolvedPluginContributions.viewReplacements,
    $installedPlugins,
  ))
  let effectiveDashboardProvider = $derived(dashboardProviderResolution.provider)
  let dashboardNavItem = $derived(effectiveDashboardProvider
    ? { title: effectiveDashboardProvider.title, icon: effectiveDashboardProvider.icon }
    : null)

  $effect(() => {
    sidebarPluginViewKeys.set(sidebarPluginViewKeySet)
  })

  $effect(() => {
    pluginController.syncContributions(resolvedPluginContributions)
  })

  $effect(() => {
    projectController.reconcileTasks({
      tasks: $tasks,
      pendingTask: $pendingTask,
      selectedTaskId: $selectedTaskId,
      selectedTaskDetailExists: $selectedTaskId ? $taskDetailsById.has($selectedTaskId) : false,
    })
  })

  $effect(() => {
    if (!$globalProjectDashboardProviderLoaded) {
      void loadGlobalProjectDashboardProviderId().catch((value) => {
        console.error('[App] Failed to load global dashboard provider default:', value)
      })
    }
    const projectId = $activeProjectId
    projectController.selectProject(projectId)
    pluginController.selectProject(projectId)
    if (projectId && !$projectDashboardProviderIds.has(projectId)) {
      void loadProjectDashboardProviderId(projectId).catch((value) => {
        console.error(`[App] Failed to load dashboard provider preference for ${projectId}:`, value)
      })
    }
  })

  $effect(() => {
    rendererContext.update({
      focused: windowFocused,
      activeProjectId: $activeProjectId,
      currentView: $currentView,
    })
  })

  // Moving a Task to/from Out of Focus only mutates outOfFocusTaskIdsByProject (+ its config)
  // and emits no desktop event, so the sidebar green dot would otherwise lag the board's Focus
  // count until an unrelated event fires. Recompute the per-project attention counts whenever
  // Out of Focus membership changes; the throttle also lets the config write settle first.
  $effect(() => {
    void $outOfFocusTaskIdsByProject
    appData.scheduleAttentionCountRefresh()
  })

  lifecycle = createAppShellLifecycleController({
    appData,
    pluginOwner: pluginController,
    onCloseRequested: closeController.handleCloseRequested,
    setAppMode: (mode) => { appMode = mode },
    onWindowFocusChange: (focused) => { windowFocused = focused },
    shortcutHandlers: {
      showShortcuts: shortcutHelp.open,
      openActionPalette: actionPalette.openActionPalette,
      toggleAttentionOverview: () => { showAttentionOverview = !showAttentionOverview },
      toggleProjectSwitcher: () => { showProjectSwitcher = !showProjectSwitcher },
      toggleSidebar: () => {
        appSidebarCollapsed = !appSidebarCollapsed
        localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed))
      },
      openNewTaskDialog: () => {
        if (!taskCreation.dialog) taskCreation.openNewTask()
      },
      goBack: () => { void navigation.goBack() },
      navigateForward: () => { void navigation.goForward() },
      toggleVoiceRecording: () => { toggleVoiceInputShortcut() },
      toggleCommandPalette: () => { showCommandPalette = !showCommandPalette },
      toggleFileQuickOpen: () => { showFileQuickOpen = !showFileQuickOpen },
      canToggleFileQuickOpen: () => selectedTask === null && !showCommandPalette && !showProjectSwitcher && !showAttentionOverview && !actionPalette.showActionPalette && !shortcutHelp.isOpen,
      resetToBoard: () => { router.resetToBoard() },
      navigateToGlobalSettings: () => { navigation.navigate('global_settings') },
      cycleActiveProject: (direction, options) => { void navigation.cycleActiveProject(direction, options) },
      toggleZenMode: () => {
        if (canToggleZenMode({ currentView: $currentView, selectedTaskId: $selectedTaskId })) {
          zenMode.update((on) => !on)
        }
      },
    },
  })

  onMount(() => {
    let mounted = true
    void lifecycle.start().then(() => {
      if (mounted) appReady = true
    })
    return () => { mounted = false }
  })

  onDestroy(() => {
    lifecycle.dispose()
  })
</script>

<div
  class="flex h-screen overflow-hidden bg-base-100"
  style:opacity={appReady ? 1 : 0}
  inert={!appReady}
  data-app-ready={appReady}
>
  {#if !zenActive}
    <AppSidebar
      collapsed={appSidebarCollapsed}
      currentView={$currentView}
      {appMode}
      onToggleCollapse={() => { appSidebarCollapsed = !appSidebarCollapsed; localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed)) }}
      onNewProject={() => showProjectSetup = true}
      onNavigate={navigation.navigate}
      onSelectProject={navigation.switchToProject}
      onOpenAttentionOverview={() => { showAttentionOverview = true }}
      pluginNavItems={sidebarPluginNavItems}
      reviewRequestCount={$reviewRequestCount}
    />
  {/if}
  {#if !isCrossProjectView($currentView, sidebarPluginViewKeySet) && !zenActive}
    <IconRail currentView={$currentView} onNavigate={navigation.navigate} pluginNavItems={pluginNavItems} {dashboardNavItem} modalsOpen={showCommandPalette || showProjectSwitcher || showAttentionOverview || actionPalette.showActionPalette || taskCreation.dialog !== null || showFileQuickOpen} activeRepoReviewRequestCount={$activeRepoReviewRequestCount} activeProjectAttentionCount={$activeProjectAttentionCount} />
  {/if}

  <div class="flex flex-col flex-1 min-w-0 relative">
    <main class="flex-1 overflow-hidden flex">
      <div class="flex-1 overflow-hidden flex flex-col">
        {#if renderedActiveView !== null}
          <renderedActiveView.component {...(renderedActiveView?.props ?? {})} />
        {:else if pluginViewActive}
          <PluginSlot slotType="views" slotId={$currentView} />
        {:else if selectedTaskForView}
          <TaskDetailProviderHost
            task={selectedTaskForView}
            onRunAction={handleRunAction}
            onEdit={taskCreation.openEditTask}
            onOpenTask={navigation.openTaskInProject}
            onTaskUpdated={async () => { await appData.loadTasks() }}
            onProjectAttentionChanged={appData.loadProjectAttention}
            onRunAppRegistrationChange={handleRunAppRegistrationChange}
          />
        {:else}
          <ProjectDashboardProviderHost
            project={activeProject}
            tasks={$tasks}
            taskDetailsById={$taskDetailsById}
            dependencyReferenceTasks={$dependencyReferenceTasks}
            activeSessions={$activeSessions}
            ticketPrs={$ticketPrs}
            attentionRows={$taskAttentionRows}
            attentionRowsLoaded={$taskAttentionLoaded}
            isLoading={$isLoading}
            onOpenTask={navigation.openTaskInProject}
            onEditTask={taskCreation.openEditTask}
            onTaskUpdated={async () => { await appData.loadTasks() }}
            onProjectAttentionChanged={appData.loadProjectAttention}
            onOpenCommandSearch={() => { showCommandPalette = true }}
            onNewTask={taskCreation.openNewTask}
            onRunAction={handleRunAction}
          />
        {/if}

        <AppTaskCreationDialogs
          controller={taskCreation}
          projectPath={activeProject?.path ?? null}
          projectName={activeProject?.name ?? null}
        />

        {#if showProjectSetup}
          <ProjectSetupDialog onClose={() => showProjectSetup = false} onProjectCreated={handleProjectCreated} />
        {/if}
      </div>
    </main>

  </div>
</div>

<ToastHost />

{#if showProjectSwitcher}
  <ProjectSwitcherModal onClose={() => showProjectSwitcher = false} onSelectProject={navigation.switchToProject} />
{/if}

{#if showAttentionOverview}
  <AttentionOverviewDialog
    onClose={closeAttentionOverview}
    onOpenTask={navigation.openTaskFromOverview}
    onOpenPr={reviewNavigation.openReviewFromOverview}
  />
{/if}

{#if showCommandPalette}
  <CommandPalette onClose={() => showCommandPalette = false} />
{/if}

{#if actionPalette.showActionPalette}
  <ActionPalette
    task={actionPalette.actionPaletteTask}
    taskPrs={actionPalette.actionPaletteTask ? ($ticketPrs.get(actionPalette.actionPaletteTask.id) || []) : []}
    canRunApp={actionPalette.actionPaletteCanRunApp}
    onClose={actionPalette.closeActionPalette}
    onExecute={actionPalette.executeAction}
  />
{/if}

{#if showFileQuickOpen}
  <FileQuickOpen onClose={() => { showFileQuickOpen = false }} />
{/if}

<!-- Branch divergence prompt (global, store-driven, awaited as a Promise) -->
<BranchDivergenceModal />

<AppCloseConfirmationDialog controller={closeController} />
<AppShortcutHelpDialog
  controller={shortcutHelp}
  taskSelected={selectedTask !== null}
  boardVisible={$currentView === 'board' && selectedTask === null}
/>
