<script lang="ts">
  import { getTaskActionPresentation } from '../../../lib/actionPalettePresentation'
  import type { BoardStatus } from '../../../lib/types'
  import { activeProjectId, completingTasks } from '../../../lib/stores'
  import { activeTasks } from '../../../lib/tasksState'
  import { confirmTerminalTaskAction, runCompleteTask } from '../../../lib/completeTask'
  import { enabledPluginIds } from '../../../lib/plugin/pluginStore'
  import {
    listTaskStartPrefixProvidersAcrossPlugins,
    requestTaskStartPrefix,
  } from '../../../lib/plugin/pluginRegistry'
  import ContextMenu from '../ui/ContextMenu.svelte'
  import ContextMenuItem from '../ui/ContextMenuItem.svelte'

  const startPresentation = getTaskActionPresentation('start-task')
  const returnPresentation = getTaskActionPresentation('return-to-board')
  const deletePresentation = getTaskActionPresentation('delete-task')
  const completePresentation = getTaskActionPresentation('complete-task')
  const setAsidePresentation = getTaskActionPresentation('set-aside-task')

  interface Props {
    visible: boolean
    x: number
    y: number
    taskId: string
    onClose: () => void
    onStart?: (taskId: string, promptPrefix?: string | null) => void
    onEdit?: (taskId: string) => void
    onDelete?: (taskId: string) => void
    outOfFocusTaskIds?: ReadonlySet<string>
    onMoveToOutOfFocus?: (taskId: string) => void
    onReturnToBoard?: (taskId: string) => void
  }

  let { visible, x, y, taskId, onClose, onStart, onEdit, onDelete, outOfFocusTaskIds = new Set(), onMoveToOutOfFocus, onReturnToBoard }: Props = $props()

  let taskStatus = $derived<BoardStatus | ''>($activeTasks.find(t => t.id === taskId)?.status ?? '')
  let isOutOfFocusTask = $derived(outOfFocusTaskIds.has(taskId))
  let isCompleting = $derived($completingTasks.has(taskId))
  let hasStartAction = $derived(taskStatus === 'backlog' && Boolean(onStart))
  let hasEditAction = $derived(taskStatus === 'backlog' && Boolean(onEdit))
  let hasReturnToBoardAction = $derived(taskStatus === 'doing' && isOutOfFocusTask && Boolean(onReturnToBoard))
  let prefixProviders = $derived(
    hasStartAction ? listTaskStartPrefixProvidersAcrossPlugins($enabledPluginIds) : [],
  )
  let hasActionsBeforeComplete = $derived(
    hasStartAction || hasEditAction || hasReturnToBoardAction || prefixProviders.length > 0,
  )

  function handleStart() {
    onClose()
    onStart?.(taskId)
  }

  async function handleStartWithPrefix(pluginId: string, providerId: string) {
    const id = taskId
    const projectId = $activeProjectId
    onClose()
    const prefix = await requestTaskStartPrefix(pluginId, providerId, { taskId: id, projectId })
    // A null prefix means the user backed out of the picker: start nothing.
    if (prefix === null) return
    onStart?.(id, prefix)
  }

  function handleEdit() {
    const id = taskId
    onClose()
    onEdit?.(id)
  }

  function handleSetAside() {
    const id = taskId
    onClose()
    onMoveToOutOfFocus?.(id)
  }

  function handleReturnToBoard() {
    const id = taskId
    onClose()
    onReturnToBoard?.(id)
  }

  async function handleComplete() {
    const id = taskId
    if (isCompleting || !confirmTerminalTaskAction(taskStatus === 'backlog' ? 'Delete' : 'Complete')) {
      return
    }
    onClose()
    if (await runCompleteTask(id)) {
      onDelete?.(id)
    }
  }
</script>

<ContextMenu {visible} {x} {y} {onClose}>
  {#if hasStartAction}
    <ContextMenuItem label={startPresentation.label} variant="primary" onclick={handleStart} />
  {/if}
  {#each prefixProviders as provider (provider.qualifiedId)}
    <ContextMenuItem
      label={provider.title}
      onclick={() => handleStartWithPrefix(provider.pluginId, provider.id)}
    />
  {/each}
  {#if hasEditAction}
    <ContextMenuItem label="Edit Task" onclick={handleEdit} />
  {/if}
  {#if hasReturnToBoardAction}
    <ContextMenuItem label={returnPresentation.label} onclick={handleReturnToBoard} />
  {/if}
  {#if hasActionsBeforeComplete}
    <div class="border-t border-base-content/10 my-1"></div>
  {/if}
  <ContextMenuItem label={isCompleting ? 'Completing…' : taskStatus === 'backlog' ? deletePresentation.label : completePresentation.label} disabled={isCompleting} onclick={handleComplete} />
  {#if taskStatus === 'doing' && !isOutOfFocusTask && onMoveToOutOfFocus}
    <ContextMenuItem label={setAsidePresentation.label} onclick={handleSetAside} />
  {/if}
</ContextMenu>
