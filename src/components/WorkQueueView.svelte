<script lang="ts">
  import { Eye } from 'lucide-svelte'
  import type { WorkQueueTask } from '../lib/types'
  import { getWorkQueueTasks } from '../lib/ipc'
  import { activeProjectId, currentView, selectedTaskId } from '../lib/stores'
  import { pushNavState } from '../lib/navigation'
  import { timeAgoFromSeconds } from '../lib/timeAgo'
  import Card from './Card.svelte'

  interface Props {
    refreshTrigger?: number
  }

  let { refreshTrigger = 0 }: Props = $props()

  let tasks = $state<WorkQueueTask[]>([])
  let loading = $state(true)
  let expandedSummaryTaskId = $state<string | null>(null)

  let grouped = $derived(groupByProject(tasks))

  function groupByProject(items: WorkQueueTask[]): Map<string, WorkQueueTask[]> {
    const map = new Map<string, WorkQueueTask[]>()
    for (const task of items) {
      const existing = map.get(task.project_name)
      if (existing) {
        existing.push(task)
      } else {
        map.set(task.project_name, [task])
      }
    }
    return map
  }

  async function loadTasks() {
    loading = true
    try {
      tasks = await getWorkQueueTasks()
    } catch (e) {
      console.error('Failed to load work queue tasks:', e)
      tasks = []
    } finally {
      loading = false
    }
  }
  function statusLabel(s: string): string {
    switch (s) {
      case 'running': return 'Running'
      case 'completed': return 'Done'
      case 'paused': return 'Paused'
      case 'failed': return 'Error'
      case 'interrupted': return 'Stopped'
      default: return s
    }
  }

  function statusStyle(s: string): string {
    switch (s) {
      case 'running': return 'bg-success/15 text-success'
      case 'completed': return 'bg-info/20 text-info'
      case 'paused': return 'bg-warning/15 text-warning'
      case 'failed': return 'bg-error/15 text-error'
      case 'interrupted': return 'bg-base-content/15 text-base-content/50'
      default: return 'bg-base-content/15 text-base-content/50'
    }
  }

  function handleTaskClick(task: WorkQueueTask) {
    pushNavState()
    $activeProjectId = task.project_id
    $currentView = 'board'
    $selectedTaskId = task.id
  }

  function toggleSummary(taskId: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation()
    expandedSummaryTaskId = expandedSummaryTaskId === taskId ? null : taskId
  }

  $effect(() => {
    loadTasks()
  })

  $effect(() => {
    if (refreshTrigger > 0) {
      loadTasks()
    }
  })
</script>

{#if loading}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">Loading...</span>
  </div>
{:else if tasks.length === 0}
  <div class="flex-1 overflow-hidden flex items-center justify-center">
    <span class="text-base-content/50">No tasks waiting for review</span>
  </div>
{:else}
  <div class="flex-1 overflow-auto p-6">
    <div class="flex gap-6 items-start">
      {#each [...grouped] as [projectName, projectTasks]}
        <div class="min-w-[280px] max-w-[320px]">
          <h2 class="font-mono text-sm font-semibold text-base-content mb-3 px-1">{projectName}</h2>
          <div class="flex flex-col gap-2">
            {#each projectTasks as task}
              <Card onclick={() => handleTaskClick(task)} class="block px-3.5 py-3">
                <div class="flex items-center justify-between mb-1">
                  <div class="flex items-center gap-1.5">
                    <span class="font-mono text-xs font-semibold text-primary">{task.id}</span>
                    {#if task.session_status}
                      <span
                        class="font-mono text-[0.6rem] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wider whitespace-nowrap leading-tight {statusStyle(task.session_status)}"
                      >{statusLabel(task.session_status)}</span>
                    {/if}
                  </div>
                  <span class="font-mono text-[0.6rem] text-base-content/40">{task.session_completed_at ? timeAgoFromSeconds(task.session_completed_at) : 'no session'}</span>
                </div>
                <div class="font-mono text-sm font-medium leading-relaxed text-base-content mb-1">
                  {task.title.length > 80 ? task.title.slice(0, 80) + '...' : task.title}
                </div>
                {#if task.summary}
                  <div class="relative w-full" data-testid={`summary-container-${task.id}`}>
                    <div class="flex items-center gap-1.5 min-w-0 text-xs text-base-content/50">
                      <span class="truncate">{task.summary}</span>
                      <button
                        type="button"
                        class="shrink-0 text-base-content/40 hover:text-base-content/70"
                        aria-label="Show full summary"
                        onclick={(e: MouseEvent) => toggleSummary(task.id, e)}
                        onkeydown={(e: KeyboardEvent) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleSummary(task.id, e)
                          }
                        }}
                      >
                        <Eye size={12} aria-hidden="true" />
                      </button>
                    </div>
                    {#if expandedSummaryTaskId === task.id}
                      <div
                        class="absolute left-0 top-full mt-1 z-30 w-80 max-w-[min(24rem,calc(100vw-4rem))] max-h-44 overflow-auto rounded border border-base-300 bg-base-100 p-2 text-xs text-base-content shadow-lg whitespace-pre-wrap break-words"
                        data-testid={`summary-popover-${task.id}`}
                      >
                        {task.summary}
                      </div>
                    {/if}
                  </div>
                {/if}
              </Card>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  </div>
{/if}
