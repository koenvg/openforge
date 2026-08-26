<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import { createDesktopWindow } from './lib/desktopWindow'
  import type { DesktopWindowTarget } from './lib/desktopWindow'
  import { tasks, dependencyReferenceTasks, pendingTask, selectedTaskId, activeSessions, ticketPrs, taskAttentionRows, taskAttentionLoaded, isLoading, projects, activeProjectId, currentView, reviewRequestCount, activeRepoReviewRequestCount, activeProjectAttentionCount, projectAttention, codeCleanupTasksEnabled, focusBoardFilters, outOfFocusTaskIdsByProject, sidebarPluginViewKeys } from './lib/stores'
  import { getAppMode, getConfig, resumeStartupSessions, setPollContext, getProjectRepo } from './lib/ipc'
  import { computePollContext, pollContextEquals, type PollContextPayload } from './lib/pollContext'
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY } from './lib/githubSyncPlugin'
  import { TASK_SCHEDULES_VIEW_KEY } from './lib/taskSchedulesPlugin'
  import type { Project } from './lib/types'
  import FocusBoard from './components/focus-board/FocusBoard.svelte'
  import TaskDetailView from './components/task-detail/TaskDetailView.svelte'
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
  import { enabledPluginIds, runtimeContributionSources } from './lib/plugin/pluginStore'
  import { isPluginViewKey, makePluginViewKey } from './lib/plugin/types'
  import { activatePlugin, deactivateAllPlugins, executePluginCommand, getPluginRenderProps, initializePluginRuntime, loadEnabledForApp, loadEnabledForProject } from './lib/plugin/pluginRegistry'
  import { useAppRouter } from './lib/router.svelte'
  import { useCommandHeld } from './lib/useCommandHeld.svelte'
  import { useShortcutRegistry } from './lib/shortcuts.svelte'
  import { getViews, isCrossProjectView } from './lib/views'
  import { registerAppShortcuts } from './lib/appShortcuts'
  import { toggleVoiceInputShortcut } from './lib/voiceInputShortcut'
  import { useAppShortcutHelpController } from './lib/appShortcutHelpController.svelte'
  import { registerAppDesktopEventListeners } from './lib/appDesktopEventListeners'
  import { loadAppStartupData } from './lib/appStartup'
  import { useAppDataOrchestrator } from './lib/appDataOrchestrator.svelte'
  import { createTaskActionRunner } from './lib/taskActionRunner'
  import { useAppTaskCreationController } from './lib/appTaskCreationController.svelte'
  import { createAppNavigationController } from './lib/appNavigationController'
  import { createReviewNavigationController } from './lib/reviewNavigationController'
  import { createAppLifecycleController } from './lib/appLifecycleController'
  import { useActionPaletteController } from './lib/actionPaletteController.svelte'
  import type { TaskRunAppRegistration } from './components/task-detail/taskRunAppController'
  import { useAppCloseController } from './lib/appCloseController.svelte'
  
  let shortcuts: ReturnType<typeof useShortcutRegistry> | null = $state(null)

  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let showProjectSwitcher = $state(false)
  let showAttentionOverview = $state(false)
  let appSidebarCollapsed = $state(localStorage.getItem('appSidebarCollapsed') === 'true')
  let showCommandPalette = $state(false)
  let showFileQuickOpen = $state(false)
  let taskRunAppRegistration = $state<TaskRunAppRegistration | null>(null)
  let router = useAppRouter()
  let registeredPluginShortcuts = new Set<string>()
  let previousPluginProjectId = $state<string | null>(null)
  let appWindow: DesktopWindowTarget | null = null

  useCommandHeld()

  let selectedTask = $derived(
    $tasks.find(t => t.id === $selectedTaskId) ||
      ($pendingTask?.id === $selectedTaskId ? $pendingTask : null)
  )
  let previousActiveProjectId: string | null = $state(null)
  let enabledPluginContributionSources = $derived(
    Array.from($enabledPluginIds)
      .map((id) => $runtimeContributionSources.get(id))
      .filter((source) => source !== undefined)
  )
  let activeProject = $derived($projects.find(p => p.id === $activeProjectId) || null)
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
    getAppWindow: () => appWindow,
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
  const handleRunAction = taskActions.handleRunAction
  let resolvedPluginContributions = $derived(resolveContributions(enabledPluginContributionSources))
  let resolvedViews = $derived(getViews(enabledPluginContributionSources))
  let pluginNavItems = $derived(
    [...resolvedPluginContributions.views]
      .filter((view) => view.showInRail)
      .sort((a, b) => a.railOrder - b.railOrder || a.title.localeCompare(b.title))
      .map((view) => ({
        viewKey: makePluginViewKey(view.pluginId, view.contributionId),
        icon: view.icon,
        title: view.title,
        shortcut: view.shortcut,
      }))
  )
  let sidebarPluginNavItems = $derived(
    [...resolvedPluginContributions.views]
      .filter((view) => view.showInSidebar)
      .sort((a, b) => a.railOrder - b.railOrder || a.title.localeCompare(b.title))
      .map((view) => {
        const item = {
          viewKey: makePluginViewKey(view.pluginId, view.contributionId),
          icon: view.icon,
          title: view.title,
          shortcut: view.shortcut,
        }
        if (!view.navigationComponent) return item

        return {
          ...item,
          navigation: {
            component: view.navigationComponent,
            props: {
              ...getPluginRenderProps(view.pluginId, { projectId: $activeProjectId }),
              view: {
                pluginId: view.pluginId,
                id: view.contributionId,
                qualifiedId: view.namespacedId,
                title: view.title,
                icon: view.icon,
              },
            },
          },
        }
      })
  )
  let sidebarPluginViewKeySet = $derived(new Set(sidebarPluginNavItems.map((item) => item.viewKey)))
  // Mirror the sidebar (cross-project) plugin view keys into the store so the router's
  // restoreProjectView can reject them as project snapshots without importing plugin state.
  $effect(() => {
    sidebarPluginViewKeys.set(sidebarPluginViewKeySet)
  })
  let activeViewEntry = $derived($currentView === 'board' ? null : resolvedViews[$currentView] ?? null)
  let renderedActiveView = $derived.by(() => {
    if (activeViewEntry === null) {
      return null
    }

    return {
      component: activeViewEntry.component,
      props: activeViewEntry.getProps({
        projectId: $activeProjectId,
        projectName: activeProject?.name ?? '',
        projectPath: activeProject?.path ?? '',
        onCloseSettings: () => { router.navigate('board') },
        onProjectDeleted: appData.loadProjects,
        onProjectSettingsSaved: appData.refreshAttentionCounts,
      }),
    }
  })
  let pluginViewActive = $derived(isPluginViewKey($currentView) && activeViewEntry === null)

  $effect(() => {
    const pending = $pendingTask
    if (pending && $tasks.some(t => t.id === pending.id)) {
      pendingTask.set(null)
    }
  })

  $effect(() => {
    const taskId = $selectedTaskId
    if (taskId && !selectedTask) {
      $selectedTaskId = null
    }
  })

  $effect(() => {
    const projectId = $activeProjectId
    if (projectId && projectId !== previousActiveProjectId) {
      const nextFilters = new Map($focusBoardFilters)
      nextFilters.delete(projectId)
      focusBoardFilters.set(nextFilters)
    }
    previousActiveProjectId = projectId
  })

  $effect(() => {
    const projectId = $activeProjectId
    if (projectId !== previousPluginProjectId) {
      void loadEnabledForProject(projectId).catch((error) => {
        console.error(`[plugins] Failed to load enabled plugins for visible project ${projectId ?? 'none'}:`, error)
      })
    }

    previousPluginProjectId = projectId
  })

  // Report the renderer's poll context to the sidecar so the GitHub poller can
  // focus-gate (pause when unfocused) and scope its calls (active repo unless the
  // global PR view is open). Deduped so redundant store updates don't spam IPC.
  let windowFocused = $state(true)
  let lastPollContext: PollContextPayload | null = null


  $effect(() => {
    const payload = computePollContext({
      focused: windowFocused,
      activeProjectId: $activeProjectId,
      currentView: $currentView,
      globalPrViewKey: GITHUB_SYNC_GLOBAL_VIEW_KEY,
    })
    if (lastPollContext && pollContextEquals(lastPollContext, payload)) return
    lastPollContext = payload
    void setPollContext(payload)
  })

  // Resolve + cache the active project's GitHub repo (written to project config
  // 'resolved_repo' by the sidecar) so the per-repo PR view can scope to it.
  $effect(() => {
    const projectId = $activeProjectId
    if (projectId) {
      void getProjectRepo(projectId).catch(() => {})
    }
  })

  $effect(() => {
    if (!shortcuts) return

    const nextShortcutKeys = new Set<string>()

    for (const view of resolvedPluginContributions.views) {
      if (!view.shortcut) continue

      nextShortcutKeys.add(view.shortcut)
      shortcuts.register(view.shortcut, () => {
        navigation.navigate(makePluginViewKey(view.pluginId, view.contributionId))
      })
    }

    for (const command of resolvedPluginContributions.commands) {
      if (!command.shortcut) continue

      nextShortcutKeys.add(command.shortcut)
      shortcuts.register(command.shortcut, () => {
        void executePluginCommand(command.pluginId, command.contributionId)
      })
    }

    for (const key of registeredPluginShortcuts) {
      if (!nextShortcutKeys.has(key)) {
        shortcuts.unregister(key)
      }
    }

    registeredPluginShortcuts = nextShortcutKeys
  })

  $effect(() => {
    for (const service of resolvedPluginContributions.backgroundServices) {
      void activatePlugin(service.pluginId)
    }
  })

  // Reload tasks when active project changes
  $effect(() => {
    if ($activeProjectId) {
      appData.loadTasks()
      appData.loadPullRequests()
      appData.refreshPrCounts()
    }
  })

  // Moving a Task to/from Out of Focus only mutates outOfFocusTaskIdsByProject (+ its config)
  // and emits no desktop event, so the sidebar green dot would otherwise lag the board's Focus
  // count until an unrelated event fires. Recompute the per-project attention counts whenever
  // Out of Focus membership changes; the throttle also lets the config write settle first.
  $effect(() => {
    void $outOfFocusTaskIdsByProject
    appData.scheduleAttentionCountRefresh()
  })

  async function handleProjectCreated(project: Project) {
    showProjectSetup = false
    $activeProjectId = project.id
    await appData.loadProjects()
    // Land the user on the new project's settings page to finish configuring it.
    router.navigate('settings')
  }
  const lifecycle = createAppLifecycleController({
    createWindow: () => {
      const target = createDesktopWindow()
      appWindow = target
      return target
    },
    createShortcuts: () => {
      const registry = useShortcutRegistry()
      shortcuts = registry
      return registry
    },
    registerShortcuts: (registry) => {
      registerAppShortcuts(registry, {
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
      })
    },
    registerDesktopEvents: (target) => registerAppDesktopEventListeners({
      appWindow: target,
      onCloseRequested: closeController.handleCloseRequested,
      loadTasks: appData.loadTasks,
      loadSessions: appData.loadSessions,
      loadPullRequests: appData.loadPullRequests,
      loadProjectAttention: appData.loadProjectAttention,
      refreshPrCounts: appData.refreshPrCounts,
      getActiveProjectId: () => get(activeProjectId),
      loadEnabledPluginsForProject: loadEnabledForProject,
    }),
    resumeStartupSessions,
    loadStartupData: () => loadAppStartupData({
      initializePluginRuntime: async () => {
        await initializePluginRuntime()
        await loadEnabledForApp()
      },
      loadProjects: appData.loadProjects,
      getAppMode,
      getConfig,
      setAppMode: (mode) => { appMode = mode },
      setCodeCleanupTasksEnabled: (enabled) => { $codeCleanupTasksEnabled = enabled },
      loadProjectAttention: appData.loadProjectAttention,
      loadTasks: appData.loadTasks,
    }),
    onWindowFocusChange: (focused) => { windowFocused = focused },
  })

  onMount(() => {
    void lifecycle.start()
  })

  onDestroy(() => {
    if (shortcuts) {
      for (const key of registeredPluginShortcuts) {
        shortcuts.unregister(key)
      }
    }

    void deactivateAllPlugins().catch((error) => {
      console.error('[plugins] Failed to deactivate all plugins during app teardown:', error)
    })
    lifecycle.dispose()
  })
</script>

<div class="flex h-screen overflow-hidden bg-base-100">
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
  {#if !isCrossProjectView($currentView, sidebarPluginViewKeySet)}
    <IconRail currentView={$currentView} onNavigate={navigation.navigate} pluginNavItems={pluginNavItems} modalsOpen={showCommandPalette || showProjectSwitcher || showAttentionOverview || actionPalette.showActionPalette || taskCreation.dialog !== null || showFileQuickOpen} activeRepoReviewRequestCount={$activeRepoReviewRequestCount} activeProjectAttentionCount={$activeProjectAttentionCount} />
  {/if}

  <div class="flex flex-col flex-1 min-w-0 relative">
    <main class="flex-1 overflow-hidden flex">
      <div class="flex-1 overflow-hidden flex flex-col">
        {#if renderedActiveView !== null}
          <renderedActiveView.component {...(renderedActiveView?.props ?? {})} />
        {:else if pluginViewActive}
          <PluginSlot slotType="views" slotId={$currentView} />
        {:else if selectedTask}
          <TaskDetailView
            task={selectedTask}
            onRunAction={handleRunAction}
            onEdit={taskCreation.openEditTask}
            onOpenTask={navigation.openTaskInProject}
            onTaskUpdated={async () => { await appData.loadTasks() }}
            onProjectAttentionChanged={appData.loadProjectAttention}
            onRunAppRegistrationChange={handleRunAppRegistrationChange}
          />
        {:else}
          <div class="flex-1 overflow-hidden">
            {#if $isLoading && $tasks.length === 0}
              <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
                <span class="loading loading-spinner loading-md text-primary"></span>
                <span>Loading tasks...</span>
              </div>
            {:else}
              <FocusBoard
                projectId={$activeProjectId}
                projectName={activeProject?.name ?? ''}
                tasks={$tasks}
                dependencyReferenceTasks={$dependencyReferenceTasks}
                activeSessions={$activeSessions}
                ticketPrs={$ticketPrs}
                attentionRows={$taskAttentionRows}
                attentionRowsLoaded={$taskAttentionLoaded}
                onOpenTask={navigation.openTaskInProject}
                onEditTask={taskCreation.openEditTask}
                onTaskUpdated={async () => { await appData.loadTasks() }}
                onProjectAttentionChanged={appData.loadProjectAttention}
                onOpenCommandSearch={() => { showCommandPalette = true }}
                onNewTask={taskCreation.openNewTask}
                onRunAction={handleRunAction}
              />
            {/if}
          </div>
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

    {#if $activeProjectId && $currentView !== 'board' && $currentView !== 'global_settings' && $currentView !== TASK_SCHEDULES_VIEW_KEY && !selectedTask}
      <button
        type="button"
        class="absolute bottom-6 right-6 btn btn-primary btn-circle btn-lg shadow-lg font-mono text-lg z-10"
        aria-label="Create new task"
        onclick={taskCreation.openNewTask}
      >
        +
      </button>
    {/if}
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
