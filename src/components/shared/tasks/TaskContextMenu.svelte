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
  {#if taskStatus === 'backlog' && onStart}
    <ContextMenuItem label="Start Task" variant="primary" onclick={handleStart} />
  {/if}
  {#if taskStatus === 'backlog' && actions.length > 0 && onRunAction}
    <div class="border-t border-base-content/10 my-1"></div>
    {#each actions as action (action.id)}
      <ContextMenuItem label={action.name} description={action.prompt} onclick={() => handleRunAction(action)} />
    {/each}
  {/if}
  {#if taskStatus === 'backlog' && onEdit}
    <ContextMenuItem label="Edit Task" onclick={handleEdit} />
  {/if}
  {#if taskStatus === 'doing' && isOutOfFocusTask && onReturnToBoard}
    <ContextMenuItem label="Return to board" onclick={handleReturnToBoard} />
  {/if}
  <div class="border-t border-base-content/10 my-1"></div>
  <ContextMenuItem label={isCompleting ? 'Completing…' : 'Complete 🏁'} disabled={isCompleting} onclick={handleComplete} />
  {#if taskStatus === 'doing' && !isOutOfFocusTask && onMoveToOutOfFocus}
    <ContextMenuItem label="Set aside" onclick={handleSetAside} />
  {/if}
</ContextMenu>
