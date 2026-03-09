<script lang="ts">
  import type { KanbanColumn } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { tasks, error } from '../lib/stores'
  import { updateTaskStatus, deleteTask } from '../lib/ipc'
  import ContextMenu from './ContextMenu.svelte'
  import ContextMenuItem from './ContextMenuItem.svelte'

  interface Props {
    visible: boolean
    x: number
    y: number
    taskId: string
    onClose: () => void
    onStart?: (taskId: string) => void
    onDelete?: (taskId: string) => void
  }

  let { visible, x, y, taskId, onClose, onStart, onDelete }: Props = $props()

  let showMoveSubmenu = $state(false)

  let taskStatus = $derived(($tasks.find(t => t.id === taskId)?.status ?? '') as KanbanColumn | '')

  $effect(() => {
    if (visible) {
      showMoveSubmenu = false
    }
  })

  function handleStart() {
    onClose()
    onStart?.(taskId)
  }

  function toggleMoveSubmenu() {
    showMoveSubmenu = !showMoveSubmenu
  }

  async function handleMoveTo(column: KanbanColumn) {
    const id = taskId
    onClose()
    try {
      await updateTaskStatus(id, column)
    } catch (err: unknown) {
      console.error('Failed to move task:', err)
      $error = String(err)
    }
  }

  async function handleDelete() {
    const id = taskId
    onClose()
    try {
      await deleteTask(id)
      onDelete?.(id)
    } catch (err: unknown) {
      console.error('Failed to delete task:', err)
      $error = String(err)
    }
  }
</script>

<ContextMenu {visible} {x} {y} {onClose}>
  {#if taskStatus === 'backlog' && onStart}
    <ContextMenuItem label="Start Task" variant="primary" onclick={handleStart} />
  {/if}
  <ContextMenuItem label="Move to... ›" onclick={(e: MouseEvent) => { e.stopPropagation(); toggleMoveSubmenu() }} />
  {#if showMoveSubmenu}
    <div class="border-t border-base-300 mt-0.5 pt-0.5">
      {#each COLUMNS as col}
        <ContextMenuItem label={COLUMN_LABELS[col]} onclick={() => handleMoveTo(col)} />
      {/each}
    </div>
  {/if}
  <ContextMenuItem label="Delete" variant="danger" onclick={handleDelete} />
</ContextMenu>
