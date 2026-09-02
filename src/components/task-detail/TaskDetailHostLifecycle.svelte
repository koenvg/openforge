<script lang="ts">
  import type { Snippet } from 'svelte'
  import { get } from 'svelte/store'
  import { currentView, selectedTaskId, taskActiveView, taskRuntimeInfo } from '../../lib/stores'
  import type { ResolvedTab } from '../../lib/plugin/contributionResolver'
  import { TERMINAL_PLUGIN_ID } from '../../lib/terminalPlugin'
  import { useAppRouter } from '../../lib/router.svelte'
  import TaskDetailLifecycle from './TaskDetailLifecycle.svelte'
  import {
    INITIAL_TASK_RUN_APP_STATE,
    type TaskRunAppRegistration,
  } from './taskRunAppController'
  import type { TaskDetailHostLifecycleState } from './taskDetailHostLifecycle'

  interface Props {
    taskId: string
    projectId: string | null
    taskPaneTabs: readonly ResolvedTab[]
    onRunAppRegistrationChange?: (registration: TaskRunAppRegistration | null) => void
    children: Snippet<[TaskDetailHostLifecycleState]>
  }

  let {
    taskId,
    projectId,
    taskPaneTabs,
    onRunAppRegistrationChange,
    children,
  }: Props = $props()

  const router = useAppRouter()
  let workspacePath = $state<string | null>(null)
  let runAppState = $state({ ...INITIAL_TASK_RUN_APP_STATE })
  let runAppRegistration = $state<TaskRunAppRegistration | null>(null)
  let runtimeWorkspacePath = $derived($taskRuntimeInfo.get(taskId)?.workspacePath ?? null)
  let terminalViewId = $derived(
    taskPaneTabs.find(
      tab => tab.pluginId === TERMINAL_PLUGIN_ID && tab.contributionId === 'terminal',
    )?.namespacedId ?? null,
  )

  function handleWorkspaceResolved(resolvedTaskId: string, path: string | null): void {
    if (resolvedTaskId !== taskId || path !== null) return
    const activeView = get(taskActiveView).get(taskId) ?? 'agent'
    const activePluginTab = taskPaneTabs.find(tab => tab.namespacedId === activeView)
    if (
      activeView !== 'agent'
      && activeView !== 'review'
      && activePluginTab?.requiresWorkspace !== false
    ) {
      const next = new Map(get(taskActiveView))
      next.set(taskId, 'agent')
      taskActiveView.set(next)
    }
  }

  function handleRunAppRegistrationChange(registration: TaskRunAppRegistration | null): void {
    runAppRegistration = registration
    onRunAppRegistrationChange?.(registration)
  }

  function openTerminalViewForTask(requestedTaskId: string, viewId: string): void {
    const next = new Map(get(taskActiveView))
    next.set(requestedTaskId, viewId)
    taskActiveView.set(next)
    if (get(currentView) !== 'board' || get(selectedTaskId) !== requestedTaskId) {
      router.navigateToTask(requestedTaskId)
    }
  }

  async function runApp(): Promise<void> {
    await runAppRegistration?.run()
  }
</script>

<TaskDetailLifecycle
  {taskId}
  {projectId}
  {runtimeWorkspacePath}
  {terminalViewId}
  onWorkspacePathChange={(path) => { workspacePath = path }}
  onWorkspaceResolved={handleWorkspaceResolved}
  onRunAppStateChange={(state) => { runAppState = state }}
  onRunAppRegistrationChange={handleRunAppRegistrationChange}
  onOpenTerminalView={openTerminalViewForTask}
/>

{@render children({ workspacePath, runAppState, runApp })}
