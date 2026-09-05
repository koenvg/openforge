<script lang="ts">
  import { untrack, type Snippet } from 'svelte'
  import TaskListItem from '../../../src/components/focus-board/TaskListItem.svelte'
  import ContextMenu from '../../../src/components/shared/ui/ContextMenu.svelte'
  import type { TaskDetail } from '../../../src/lib/types'

  let { children, task, initiallyOpen = true }: {
    children: Snippet
    task: TaskDetail
    initiallyOpen?: boolean
  } = $props()
  let visible = $state(untrack(() => initiallyOpen))
  let trigger = $state<HTMLDivElement | null>(null)
</script>

<div class="flex-1 overflow-auto p-6">
  <div class="relative max-w-2xl" bind:this={trigger}>
    <TaskListItem
      {task}
      state="backlog"
      session={null}
      pullRequests={[]}
      reasonText="Ready to start"
      isSelected={true}
      isFocused={false}
      isMerging={false}
      onSelect={(event?: MouseEvent) => { event?.stopPropagation(); visible = true }}
      onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); visible = true }}
    />
    <ContextMenu {visible} x={trigger?.getBoundingClientRect().left ?? 0} y={trigger?.getBoundingClientRect().bottom ?? 0} onClose={() => { visible = false }} {children} />
  </div>
</div>
