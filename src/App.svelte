<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { get } from 'svelte/store'
  import type { DesktopUnlistenFn } from './lib/desktopIpc'
  import { createDesktopWindow } from './lib/desktopWindow'
  import type { DesktopWindowTarget } from './lib/desktopWindow'
  import { tasks, dependencyReferenceTasks, pendingTask, selectedTaskId, activeSessions, ticketPrs, isLoading, projects, activeProjectId, activeProjectColorId, currentView, reviewRequestCount, activeRepoReviewRequestCount, activeProjectAttentionCount, projectAttention, reviewPrs, codeCleanupTasksEnabled, focusBoardFilters, outOfFocusTaskIdsByProject, sidebarPluginViewKeys } from './lib/stores'
  import { getAppMode, getConfig, getProjectConfig, resumeStartupSessions, setPollContext, getProjectRepo, openUrl, markReviewPrViewed } from './lib/ipc'
  import { computePollContext, pollContextEquals, type PollContextPayload } from './lib/pollContext'
  import { GITHUB_SYNC_GLOBAL_VIEW_KEY, GITHUB_SYNC_PLUGIN_ID } from './lib/githubSyncPlugin'
  import type { Task, AppView, Project, ReviewPullRequest } from './lib/types'
  import FocusBoard from './components/focus-board/FocusBoard.svelte'
  import TaskDetailView from './components/task-detail/TaskDetailView.svelte'
  import AddTaskDialog from './components/AddTaskDialog.svelte'
  import BranchDivergenceModal from './components/BranchDivergenceModal.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
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
  import { activatePlugin, executePluginCommand, initializePluginRuntime, loadEnabledForProject } from './lib/plugin/pluginRegistry'
  import { useAppRouter, restoreProjectView } from './lib/router.svelte'
  import { getProjectColor } from './lib/projectColors'
  import { themeMode } from './lib/theme'
  import { useCommandHeld } from './lib/useCommandHeld.svelte'
  import { useShortcutRegistry } from './lib/shortcuts.svelte'
  import { getViews, isCrossProjectView } from './lib/views'
  import { registerAppShortcuts } from './lib/appShortcuts'
  import { getGlobalShortcutHelpEntries } from './lib/appShortcutDefinitions'
  import { registerAppDesktopEventListeners } from './lib/appDesktopEventListeners'
  import { loadAppStartupData } from './lib/appStartup'
  import { useAppDataOrchestrator } from './lib/appDataOrchestrator.svelte'
  import { createTaskActionRunner } from './lib/taskActionRunner'
  import { useActionPaletteController } from './lib/actionPaletteController.svelte'
  import type { TaskRunAppRegistration } from './lib/runAppCommand'
  import { hasActiveAgentSessions } from './lib/quitGuard'
  
  let unlisteners: DesktopUnlistenFn[] = []
  let showAddDialog = $state(false)
  let editingTask = $state<Task | null>(null)
  let shortcuts: ReturnType<typeof useShortcutRegistry> | null = $state(null)

  let showProjectSetup = $state(false)
  let appMode = $state<string | null>(null)
  let showShortcutsDialog = $state(false)
  let showCloseConfirm = $state(false)
  let showProjectSwitcher = $state(false)
  let showAttentionOverview = $state(false)
  let appSidebarCollapsed = $state(localStorage.getItem('appSidebarCollapsed') === 'true')
  let showCommandPalette = $state(false)
  let showFileQuickOpen = $state(false)
  let taskRunAppRegistration = $state<TaskRunAppRegistration | null>(null)
  let router = useAppRouter()
  let registeredPluginShortcuts = new Set<string>()
  const globalShortcutHelpEntries = getGlobalShortcutHelpEntries()
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
  function handleRunAppRegistrationChange(registration: TaskRunAppRegistration | null): void {
    taskRunAppRegistration = registration
  }

  const appData = useAppDataOrchestrator({
    setShowProjectSetup: (show) => { showProjectSetup = show },
  })
  const taskActions = createTaskActionRunner({
    getActiveProject: () => activeProject,
    loadTasks: appData.loadTasks,
    loadProjectAttention: appData.loadProjectAttention,
    triggerGithubSync: appData.triggerGithubSync,
  })
  const actionPalette = useActionPaletteController({
    getSelectedTask: () => selectedTask,
    taskActions,
    goBack: () => { router.back() },
    showSearchTasks: () => { showCommandPalette = true },
    showNewTask: () => {
      editingTask = null
      showAddDialog = true
    },
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
      .map((view) => ({
        viewKey: makePluginViewKey(view.pluginId, view.contributionId),
        icon: view.icon,
        title: view.title,
        shortcut: view.shortcut,
      }))
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
    if (projectId && projectId !== previousPluginProjectId) {
      void loadEnabledForProject(projectId)
    } else if (!projectId && previousPluginProjectId !== null) {
      enabledPluginIds.set(new Set())
    }

    previousPluginProjectId = projectId
  })

  // Report the renderer's poll context to the sidecar so the GitHub poller can
  // focus-gate (pause when unfocused) and scope its calls (active repo unless the
  // global PR view is open). Deduped so redundant store updates don't spam IPC.
  let windowFocused = $state(true)
  let lastPollContext: PollContextPayload | null = null

  function refreshWindowFocus() {
    windowFocused =
      typeof document === 'undefined'
        ? true
        : document.visibilityState === 'visible' && document.hasFocus()
  }

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
        handleNavigate(makePluginViewKey(view.pluginId, view.contributionId))
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

  $effect(() => {
    const pid = $activeProjectId
    $activeProjectColorId = null
    if (pid) {
      getProjectConfig(pid, 'project_color').then((val) => {
        if (get(activeProjectId) === pid && get(activeProjectColorId) === null) {
          $activeProjectColorId = val
        }
      })
    }
  })

  let contentBg = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    return $themeMode === 'dark' ? color.dark : color.light
  })
  let contentBgAlt = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    return $themeMode === 'dark' ? color.darkAlt : color.lightAlt
  })
  let iconRailBg = $derived.by(() => {
    const color = getProjectColor($activeProjectColorId)
    if ($themeMode === 'dark') {
      return color.darkAlt
    }
    return color.lightAlt
  })

  async function handleProjectCreated(project: Project) {
    showProjectSetup = false
    $activeProjectId = project.id
    await appData.loadProjects()
    // Land the user on the new project's settings page to finish configuring it.
    router.navigate('settings')
  }

  function handleNavigate(view: AppView) {
    router.navigate(view)
  }

  function handleOpenTask(taskId: string) {
    router.navigateToTask(taskId)
  }

  // Open a task from the cross-project attention overview: switch to its project
  // and wait for that project's tasks to load before selecting it, so the
  // "clear unknown selected task" effect doesn't drop it mid-switch.
  async function handleOpenTaskFromOverview(task: Task) {
    showAttentionOverview = false
    if (task.project_id && task.project_id !== $activeProjectId) {
      $activeProjectId = task.project_id
      await appData.loadTasks()
    }
    router.navigateToTask(task.id)
  }

  // Open a review PR from the overview inside Open Forge's PR review, as if opened
  // from that project's Pull Requests. `projectId` is the dialog section the PR was
  // nested under: a real project opens its per-repo view; null ("Other repositories")
  // opens the all-repos view. The github-sync command navigates and loads the detail.
  // Marking it viewed here drops it off the overview and the review badge (matches the
  // existing "opening a review = viewed" semantics; the backend re-surfaces it on new
  // commits). Falls back to the browser if the plugin can't handle it.
  async function handleOpenPrFromOverview(pr: ReviewPullRequest, projectId: string | null) {
    showAttentionOverview = false
    const viewedAt = Math.floor(Date.now() / 1000)
    reviewPrs.update((list) =>
      list.map((p) => (p.id === pr.id ? { ...p, viewed_at: viewedAt, viewed_head_sha: pr.head_sha } : p)),
    )
    markReviewPrViewed(pr.id, pr.head_sha).catch((e) => console.error('[App] Failed to mark review PR viewed:', e))
    try {
      const opened = await executePluginCommand(GITHUB_SYNC_PLUGIN_ID, 'open_review_pr', { pr, projectId })
      if (!opened) {
        await openUrl(pr.html_url)
      }
    } catch (e) {
      console.error('[App] Failed to open PR in review view:', e)
      await openUrl(pr.html_url)
    }
  }

  function openEditTask(taskId: string) {
    const task = $tasks.find((t) => t.id === taskId)
    // Only never-started (backlog) tasks may have their prompt edited.
    if (!task || task.status !== 'backlog') return
    editingTask = task
    showAddDialog = true
  }

  function handleKeydown(e: KeyboardEvent) {
    if (shortcuts) {
      shortcuts.handleKeydown(e)
    }
  }

  async function handleCloseRequested(event: { preventDefault: () => void }) {
    // Always cancel this close attempt synchronously; we re-drive the quit below
    // once we know whether a confirmation is warranted.
    event.preventDefault()

    // Only interrupt the quit when there are agents that closing would kill —
    // running, or paused waiting for input — across every project. Refresh the
    // attention snapshot first so the decision reflects current agent state.
    try {
      await appData.loadProjectAttention()
    } catch (e) {
      console.error('[App] Failed to refresh project attention before quit:', e)
    }

    if (hasActiveAgentSessions(get(projectAttention))) {
      showCloseConfirm = true
    } else {
      await handleCloseConfirm()
    }
  }

  async function handleCloseConfirm() {
    if (!appWindow) return

    showCloseConfirm = false

    try {
      await appWindow.destroy()
    } catch (e) {
      showCloseConfirm = true
      console.error('[App] Failed to close window:', e)
    }
  }

  function handleCloseCancel() {
    showCloseConfirm = false
  }

  // Switch to a project, restoring its last-viewed location (tab + open task/PR)
  // instead of always resetting to the board. The outgoing project's location is
  // snapshotted automatically by the activeProjectId subscriber in router.svelte.ts.
  // The remembered task is re-applied only after the target project's tasks have
  // loaded — otherwise the "clear unknown selected task" effect drops it, because the
  // tasks store still holds the previous project's tasks (same pattern as
  // handleOpenTaskFromOverview). This is the single entry point every user-initiated
  // project switch (sidebar, switcher, ⌘-cycle) goes through.
  async function switchToProject(projectId: string) {
    // Already on this project, viewing one of its own tabs (a per-project, non
    // cross-project view). Re-clicking the project name is a shortcut back to the
    // Dashboard: from any other tab (Pull Requests, Project Settings, …) jump to
    // the board. On the board already there is nothing to do — and we must NOT reset
    // there, or an open task detail (which renders on the board view) would be wiped.
    if ($activeProjectId === projectId && !isCrossProjectView($currentView, sidebarPluginViewKeySet)) {
      if ($currentView !== 'board') {
        router.resetToBoard()
      }
      return
    }

    // Falls through here when switching to a different project, or re-entering the active
    // one while a cross-project view — Global Settings or a sidebar plugin view like "All
    // Pull Requests" — is showing. Those views change only currentView and leave
    // activeProjectId pointing at the project, so without the cross-project check above
    // this would strand the user on the global view instead of returning them (#1285).
    $activeProjectId = projectId
    const rememberedTaskId = restoreProjectView(projectId)

    if (rememberedTaskId) {
      await appData.loadTasks()
      if (get(activeProjectId) === projectId && get(tasks).some((t) => t.id === rememberedTaskId)) {
        selectedTaskId.set(rememberedTaskId)
      }
    }
  }

  function cycleActiveProject(direction: 'previous' | 'next', options?: { boardOnly?: boolean }) {
    if (options?.boardOnly && ($currentView !== 'board' || selectedTask !== null)) {
      return
    }

    const projectList = $projects
    if (projectList.length === 0) return

    const currentIndex = projectList.findIndex((p) => p.id === $activeProjectId)
    const nextIndex = direction === 'next'
      ? (currentIndex < 0 ? 0 : (currentIndex + 1) % projectList.length)
      : (currentIndex <= 0 ? projectList.length - 1 : currentIndex - 1)

    void switchToProject(projectList[nextIndex].id)
  }

  onMount(async () => {
    appWindow = createDesktopWindow()
    shortcuts = useShortcutRegistry()

    window.addEventListener('keydown', handleKeydown)
    unlisteners.push(() => window.removeEventListener('keydown', handleKeydown))

    // Track window focus/visibility so the poll-context effect can focus-gate polling.
    refreshWindowFocus()
    window.addEventListener('focus', refreshWindowFocus)
    window.addEventListener('blur', refreshWindowFocus)
    document.addEventListener('visibilitychange', refreshWindowFocus)
    unlisteners.push(() => {
      window.removeEventListener('focus', refreshWindowFocus)
      window.removeEventListener('blur', refreshWindowFocus)
      document.removeEventListener('visibilitychange', refreshWindowFocus)
    })

    registerAppShortcuts(shortcuts, {
      showShortcuts: () => { showShortcutsDialog = true },
      openActionPalette: actionPalette.openActionPalette,
      toggleAttentionOverview: () => { showAttentionOverview = !showAttentionOverview },
      toggleProjectSwitcher: () => { showProjectSwitcher = !showProjectSwitcher },
      toggleSidebar: () => {
        appSidebarCollapsed = !appSidebarCollapsed
        localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed))
      },
      openNewTaskDialog: () => {
        if (!showAddDialog) {
          editingTask = null
          showAddDialog = true
        }
      },
      goBack: () => { router.back() },
      toggleVoiceRecording: () => { window.dispatchEvent(new CustomEvent('toggle-voice-recording')) },
      toggleCommandPalette: () => { showCommandPalette = !showCommandPalette },
      toggleFileQuickOpen: () => { showFileQuickOpen = !showFileQuickOpen },
      canToggleFileQuickOpen: () => selectedTask === null && !showCommandPalette && !showProjectSwitcher && !showAttentionOverview && !actionPalette.showActionPalette && !showShortcutsDialog,
      resetToBoard: () => { router.resetToBoard() },
      navigateToGlobalSettings: () => { handleNavigate('global_settings') },
      cycleActiveProject,
    })

    unlisteners.push(...await registerAppDesktopEventListeners({
      appWindow,
      onCloseRequested: handleCloseRequested,
      loadTasks: appData.loadTasks,
      loadSessions: appData.loadSessions,
      loadPullRequests: appData.loadPullRequests,
      loadProjectAttention: appData.loadProjectAttention,
      refreshPrCounts: appData.refreshPrCounts,
      getActiveProjectId: () => $activeProjectId,
      loadEnabledPluginsForProject: loadEnabledForProject,
    }))

    try {
      await resumeStartupSessions()
    } catch (e) {
      console.error('[App] Failed to resume startup sessions:', e)
    }

    await loadAppStartupData({
      initializePluginRuntime,
      loadProjects: appData.loadProjects,
      getAppMode,
      getConfig,
      setAppMode: (mode) => { appMode = mode },
      setCodeCleanupTasksEnabled: (enabled) => { $codeCleanupTasksEnabled = enabled },
      loadProjectAttention: appData.loadProjectAttention,
      loadTasks: appData.loadTasks,
    })
  })

  onDestroy(() => {
    if (shortcuts) {
      for (const key of registeredPluginShortcuts) {
        shortcuts.unregister(key)
      }
    }

    unlisteners.forEach((fn) => {
      fn()
    })
  })
</script>

<div class="flex h-screen overflow-hidden bg-base-100" style="--project-bg: {contentBg}; --project-bg-alt: {contentBgAlt}">
  <AppSidebar
    collapsed={appSidebarCollapsed}
    currentView={$currentView}
    {appMode}
    onToggleCollapse={() => { appSidebarCollapsed = !appSidebarCollapsed; localStorage.setItem('appSidebarCollapsed', String(appSidebarCollapsed)) }}
    onNewProject={() => showProjectSetup = true}
    onNavigate={handleNavigate}
    onSelectProject={switchToProject}
    onOpenAttentionOverview={() => { showAttentionOverview = true }}
    pluginNavItems={sidebarPluginNavItems}
    reviewRequestCount={$reviewRequestCount}
  />
  {#if !isCrossProjectView($currentView, sidebarPluginViewKeySet)}
    <IconRail currentView={$currentView} onNavigate={handleNavigate} pluginNavItems={pluginNavItems} modalsOpen={showCommandPalette || showProjectSwitcher || showAttentionOverview || actionPalette.showActionPalette || showAddDialog || showFileQuickOpen} railBg={iconRailBg} activeRepoReviewRequestCount={$activeRepoReviewRequestCount} activeProjectAttentionCount={$activeProjectAttentionCount} />
  {/if}

  <div class="flex flex-col flex-1 min-w-0 relative" style="background: linear-gradient(180deg, var(--project-bg-alt) 0%, var(--project-bg) 100%)">
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
            onEdit={openEditTask}
            onOpenTask={handleOpenTask}
            onTaskUpdated={async () => { await appData.loadTasks() }}
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
                onOpenTask={handleOpenTask}
                onEditTask={openEditTask}
                onTaskUpdated={async () => { await appData.loadTasks() }}
                onProjectAttentionChanged={appData.loadProjectAttention}
                onRunAction={handleRunAction}
              />
            {/if}
          </div>
        {/if}

        {#if showAddDialog && $activeProjectId}
          <AddTaskDialog
            mode={editingTask ? 'edit' : 'create'}
            task={editingTask}
            projectPath={activeProject?.path ?? null}
            onClose={() => { showAddDialog = false; editingTask = null }}
            onTaskSaved={async () => { await appData.loadTasks() }}
            onRunAction={async (taskId, actionPrompt, agent) => {
              await appData.loadTasks()
              router.resetToBoard()
              router.navigateToTask(taskId)
              await handleRunAction({ taskId, actionPrompt, agent })
            }}
          />
        {/if}

        {#if showProjectSetup}
          <ProjectSetupDialog onClose={() => showProjectSetup = false} onProjectCreated={handleProjectCreated} />
        {/if}
      </div>
    </main>

    {#if $activeProjectId && $currentView !== 'global_settings' && !selectedTask}
      <button
        type="button"
        class="absolute bottom-6 right-6 btn btn-primary btn-circle btn-lg shadow-lg font-mono text-lg z-10"
        aria-label="Create new task"
        onclick={() => {
          editingTask = null
          showAddDialog = true
        }}
      >
        +
      </button>
    {/if}
  </div>
</div>

<ToastHost />

{#if showProjectSwitcher}
  <ProjectSwitcherModal onClose={() => showProjectSwitcher = false} onSelectProject={switchToProject} />
{/if}

{#if showAttentionOverview}
  <AttentionOverviewDialog
    onClose={() => showAttentionOverview = false}
    onOpenTask={handleOpenTaskFromOverview}
    onOpenPr={handleOpenPrFromOverview}
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

{#if showCloseConfirm}
  <Modal onClose={handleCloseCancel} maxWidth="360px" initialFocus="[data-close-confirm-action='quit']" ariaLabel="Agents still running">
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Agents still running</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <p class="text-sm text-base-content/70 m-0">One or more agents are still running or waiting for your input. Quitting now will stop them. Are you sure you want to quit?</p>
      <div class="flex justify-end gap-2">
        <button class="btn btn-ghost btn-sm" type="button" onclick={handleCloseCancel}>Cancel</button>
        <button data-close-confirm-action="quit" class="btn btn-error btn-sm" type="button" onclick={handleCloseConfirm}>Quit</button>
      </div>
    </div>
  </Modal>
{/if}

<!-- Keyboard shortcuts help dialog (global) -->
{#if showShortcutsDialog}
  <Modal onClose={() => showShortcutsDialog = false} maxWidth="420px" ariaLabel="Keyboard Shortcuts">
    {#snippet header()}
      <h2 class="text-[0.95rem] font-semibold text-base-content m-0">Keyboard Shortcuts</h2>
    {/snippet}
    <div class="p-5 flex flex-col gap-4">
      <!-- Global shortcuts -->
      <div>
        <div class="font-mono text-xs text-secondary mb-3">Global</div>
        <div class="flex flex-col gap-2">
          {#each globalShortcutHelpEntries as shortcut}
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">{shortcut.label}</span>
              <!-- Each entry in `keys` is an alternative chord for the same action, so
                   sequences are separated by "or" while keys within a sequence stay
                   grouped. Without the separator two alternatives render as one long
                   nonsensical chord. -->
              <div class="flex items-center gap-1.5">
                {#each shortcut.keys as keySequence, sequenceIndex}
                  {#if sequenceIndex > 0}
                    <span class="text-xs text-base-content/50">or</span>
                  {/if}
                  <span class="flex gap-0.5">
                    {#each keySequence as key}
                      <kbd class="kbd kbd-sm">{key}</kbd>
                    {/each}
                  </span>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </div>

      <!-- Vim navigation -->
      <div>
        <div class="font-mono text-xs text-secondary mb-3">Vim navigation</div>
        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Move down / up</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">j</kbd><kbd class="kbd kbd-sm">k</kbd><kbd class="kbd kbd-sm">↓</kbd><kbd class="kbd kbd-sm">↑</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Select / open</span>
            <kbd class="kbd kbd-sm">Enter</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Action on task</span>
            <kbd class="kbd kbd-sm">x</kbd>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">First / last item</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">gg</kbd><kbd class="kbd kbd-sm">G</kbd></div>
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm text-base-content">Back</span>
            <div class="flex gap-0.5"><kbd class="kbd kbd-sm">Esc</kbd><kbd class="kbd kbd-sm">q</kbd></div>
          </div>
        </div>
      </div>

      <!-- Task view shortcuts -->
      {#if selectedTask}
        <div>
          <div class="font-mono text-xs text-secondary mb-3">Task view</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Info panel</span>
              <kbd class="kbd kbd-sm">⌘/</kbd>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Agent / Review / Terminal (if available)</span>
              <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘1</kbd><kbd class="kbd kbd-sm">⌘2</kbd><kbd class="kbd kbd-sm">⌘3</kbd></div>
            </div>
            </div>
          </div>
       {/if}

      <!-- Board-specific shortcuts -->
      {#if $currentView === 'board' && !selectedTask}
        <div>
          <div class="font-mono text-xs text-secondary mb-3">Board</div>
          <div class="flex flex-col gap-2">
            <div class="flex items-center justify-between">
              <span class="text-sm text-base-content">Board filters</span>
              <div class="flex gap-0.5"><kbd class="kbd kbd-sm">⌘1</kbd><kbd class="kbd kbd-sm">⌘2</kbd><kbd class="kbd kbd-sm">⌘3</kbd></div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </Modal>
{/if}
