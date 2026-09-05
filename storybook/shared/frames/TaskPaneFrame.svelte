<script lang="ts">
  import type { Snippet } from 'svelte'
  import TaskPaneNavigation from '../../../src/components/task-detail/TaskPaneNavigation.svelte'
  import type { ResolvedTab } from '../../../src/lib/plugin/contributionResolver'

  let { children, tab, taskId = 'T-42', onSelect = () => {} }: {
    children: Snippet
    tab: ResolvedTab
    taskId?: string
    onSelect?: (viewId: string) => void
  } = $props()
</script>

<section aria-label="Task {taskId}" class="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
  <header class="relative flex h-12 shrink-0 items-center border-b border-base-300 px-4">
    <span class="font-mono text-sm text-primary">{taskId}</span>
    <TaskPaneNavigation activeView={tab.namespacedId} tabs={[tab]} commandHeld={false} {onSelect} />
  </header>
  <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {@render children()}
  </div>
</section>
