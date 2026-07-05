<script lang="ts">
  import type { BoardStatus, Action } from '../../../lib/types'
  import { completingTasks, tasks } from '../../../lib/stores'
  import { confirmCompleteTask, runCompleteTask } from '../../../lib/completeTask'
  import ContextMenu from '../ui/ContextMenu.svelte'
  import ContextMenuItem from '../ui/ContextMenuItem.svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    taskId: string
    onClose: () => void
    onStart?: (taskId: string) => void
    onEdit?: (taskId: string) => void
    onDelete?: (taskId: string) => void
    actions?: Action[]
    onRunAction?: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
    outOfFocusTaskIds?: Set<string>
    onMoveToOutOfFocus?: (taskId: string) => void
    onReturnToBoard?: (taskId: string) => void
  }

  let { visible, x, y, taskId, onClose, onStart, onEdit, onDelete, actions = [], onRunAction, outOfFocusTaskIds = new Set(), onMoveToOutOfFocus, onReturnToBoard }: Props = $props()

  let taskStatus = $derived<BoardStatus | ''>($tasks.find(t => t.id === taskId)?.status ?? '')
  let isOutOfFocusTask = $derived(outOfFocusTaskIds.has(taskId))
  let isCompleting = $derived($completingTasks.has(taskId))
  let hasStartAction = $derived(taskStatus === 'backlog' && Boolean(onStart))
  let hasCustomActions = $derived(taskStatus === 'backlog' && actions.length > 0 && Boolean(onRunAction))
  let hasEditAction = $derived(taskStatus === 'backlog' && Boolean(onEdit))
  let hasReturnToBoardAction = $derived(taskStatus === 'doing' && isOutOfFocusTask && Boolean(onReturnToBoard))
  let hasActionsBeforeComplete = $derived(hasStartAction || hasCustomActions || hasEditAction || hasReturnToBoardAction)

  function handleStart() {
    onClose()
    onStart?.(taskId)
  }

  function handleEdit() {
    const id = taskId
    onClose()
    onEdit?.(id)
  }

  function handleRunAction(action: Action) {
    const id = taskId
    onClose()
    onRunAction?.({ taskId: id, actionPrompt: action.prompt, agent: null })
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
    if (isCompleting || !confirmCompleteTask()) {
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
    <ContextMenuItem label="Start Task" variant="primary" onclick={handleStart} />
  {/if}
  {#if hasCustomActions}
    {#if hasStartAction}
      <div class="border-t border-base-content/10 my-1"></div>
    {/if}
    {#each actions as action (action.id)}
      <ContextMenuItem label={action.name} description={action.prompt} onclick={() => handleRunAction(action)} />
    {/each}
  {/if}
  {#if hasEditAction}
    <ContextMenuItem label="Edit Task" onclick={handleEdit} />
  {/if}
  {#if hasReturnToBoardAction}
    <ContextMenuItem label="Return to board" onclick={handleReturnToBoard} />
  {/if}
  {#if hasActionsBeforeComplete}
    <div class="border-t border-base-content/10 my-1"></div>
  {/if}
  <ContextMenuItem label={isCompleting ? 'Completing…' : 'Complete 🏁'} disabled={isCompleting} onclick={handleComplete} />
  {#if taskStatus === 'doing' && !isOutOfFocusTask && onMoveToOutOfFocus}
    <ContextMenuItem label="Set aside" onclick={handleSetAside} />
  {/if}
</ContextMenu>
