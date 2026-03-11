<script lang="ts">
  import type { Task, AgentSession } from '../lib/types'
  import { tasks, selectedTaskId, activeSessions, ticketPrs, error, activeProjectId, startingTasks } from '../lib/stores'
  import { clearDoneTasks } from '../lib/ipc'
  import { pushNavState } from '../lib/navigation'
  import { loadBoardColumns, DEFAULT_BOARD_COLUMNS } from '../lib/boardColumns'
  import { computeTaskState } from '../lib/taskState'
  import { sortBySessionActivity } from '../lib/taskSort'
  import { isInputFocused } from '../lib/domUtils'
  import { useVimNavigation } from '../lib/useVimNavigation.svelte'
  import TaskCard from './TaskCard.svelte'
  import TaskContextMenu from './TaskContextMenu.svelte'

  type BoardColumnConfig = (typeof DEFAULT_BOARD_COLUMNS)[number]

  interface Props {
    onRunAction: (data: { taskId: string; actionPrompt: string; agent: string | null }) => void
  }

  let { onRunAction }: Props = $props()

  let boardColumns = $state<BoardColumnConfig[]>([])

  $effect(() => {
    const pid = $activeProjectId
    if (pid) {
      loadBoardColumns(pid).then(cols => {
        boardColumns = cols
      })
    } else {
      boardColumns = [...DEFAULT_BOARD_COLUMNS]
    }
  })

  let columnTasks = $derived.by(() => {
    return boardColumns.map(col => ({
      config: col,
      tasks: sortBySessionActivity(
        $tasks.filter(t => {
          const session = $activeSessions.get(t.id) ?? null
          const prs = $ticketPrs.get(t.id) ?? []
           const state = computeTaskState(t, session, prs)
          return col.statuses.includes(state)
        }),
        $activeSessions,
      ),
    }))
  })

  let focusedColumn = $state(0)

  let columns = $derived(columnTasks.map(ct => ({ key: ct.config.id, tasks: ct.tasks })))

  function currentColumnTasks(): Task[] {
    return columns[focusedColumn]?.tasks ?? []
  }

  const vim = useVimNavigation({
    getItemCount: () => currentColumnTasks().length,
    onSelect: (index) => {
      const task = currentColumnTasks()[index]
      if (task) handleSelect(task.id)
    },
    onAction: (index) => {
      const task = currentColumnTasks()[index]
      if (task) onRunAction({ taskId: task.id, actionPrompt: '', agent: null })
    },
    onLeft: () => {
      if (focusedColumn > 0) {
        focusedColumn--
        vim.setFocusedIndex(0)
      }
    },
    onRight: () => {
      if (focusedColumn < columns.length - 1) {
        focusedColumn++
        vim.setFocusedIndex(0)
      }
    },
  })

  $effect(() => {
    if (focusedColumn >= columns.length) {
      focusedColumn = Math.max(0, columns.length - 1)
    }
  })

  // Scroll focused item into view
  $effect(() => {
    const idx = vim.focusedIndex
    const col = columns[focusedColumn]
    if (!col) return
    const container = document.querySelector(`[data-vim-column="${col.key}"]`)
    if (!container) return
    const items = container.querySelectorAll('[data-vim-item]')
    const el = items[idx] as HTMLElement | undefined
    el?.scrollIntoView?.({ block: 'nearest' })
  })

  function handleBoardKeydown(e: KeyboardEvent) {
    if (isInputFocused()) return
    if (e.metaKey || e.ctrlKey || e.altKey) return
    vim.handleKeydown(e)
  }

  function getSession(sessions: Map<string, AgentSession>, taskId: string): AgentSession | null {
    return sessions.get(taskId) || null
  }

  function handleSelect(taskId: string) {
    pushNavState()
    $selectedTaskId = taskId
  }

  let contextMenu = $state({ visible: false, x: 0, y: 0, taskId: '' })

  function handleContextMenu(event: MouseEvent, taskId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, taskId }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
  }

  let isClearing = $state(false)

  async function handleClearDone() {
    if (!$activeProjectId) return
    isClearing = true
    try {
      await clearDoneTasks($activeProjectId)
    } catch (err: unknown) {
      console.error('Failed to clear done tasks:', err)
      $error = String(err)
    } finally {
      isClearing = false
    }
  }
</script>


<svelte:window onkeydown={handleBoardKeydown} />

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex gap-4 px-6 py-4 flex-1 overflow-hidden">
    {#each columnTasks as colData, colIdx (colData.config.id)}
      <div class="flex-1 min-w-0 flex flex-col">
        <div class="flex items-center justify-between py-2 mb-2">
          <span class="font-mono text-[11px] font-semibold text-secondary">// {colData.config.name.toLowerCase()}</span>
          <div class="flex items-center gap-2">
            <span class="font-mono text-[10px] text-secondary bg-base-300 px-1.5 py-0.5 rounded">{colData.tasks.length}</span>
            {#if colData.config.underlyingStatus === 'done' && colData.tasks.length > 0}
              <button class="font-mono text-[11px] text-secondary hover:text-error cursor-pointer transition-colors" onclick={handleClearDone} disabled={isClearing} title="Clear done tasks">
                {#if isClearing}<span class="loading loading-spinner loading-xs"></span>{:else}$ clear{/if}
              </button>
            {/if}
          </div>
        </div>
        <div class="flex-1 flex flex-col gap-2 overflow-y-auto" role="listbox" data-vim-column={colData.config.id}>
          {#each colData.tasks as task, i (task.id)}
            {@const isVimFocused = columns[focusedColumn]?.key === colData.config.id && vim.focusedIndex === i}
            <div data-vim-item oncontextmenu={(e: MouseEvent) => handleContextMenu(e, task.id)} class={isVimFocused ? 'vim-focus' : ''}>
              <TaskCard {task} session={getSession($activeSessions, task.id)} pullRequests={$ticketPrs.get(task.id) || []} isStarting={$startingTasks.has(task.id)} onSelect={handleSelect} />
            </div>
          {/each}
          {#if colData.tasks.length === 0}
            <div class="text-center font-mono text-xs text-secondary py-5">No tasks</div>
          {/if}
        </div>
      </div>
      {#if colIdx < columnTasks.length - 1}
        <div class="w-px bg-base-300 self-stretch my-2"></div>
      {/if}
    {/each}
  </div>
</div>


<TaskContextMenu
  visible={contextMenu.visible}
  x={contextMenu.x}
  y={contextMenu.y}
  taskId={contextMenu.taskId}
  {boardColumns}
  onClose={closeContextMenu}
  onStart={(taskId) => onRunAction({ taskId, actionPrompt: '', agent: null })}
  onDelete={(taskId) => { if ($selectedTaskId === taskId) $selectedTaskId = null }}
/>
