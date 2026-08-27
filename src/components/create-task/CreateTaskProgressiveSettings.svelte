<script lang="ts">
  import { ChevronDown, Info } from '@lucide/svelte'
  import type { CreateTaskDraft } from './createTaskDraft'

  interface Props {
    draft: CreateTaskDraft
  }

  let { draft = $bindable() }: Props = $props()
</script>

<details class="group rounded-xl border border-base-300 bg-base-100">
  <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <span>Title and source ticket</span>
    <ChevronDown size={16} class="transition-transform group-open:rotate-180" aria-hidden="true" />
  </summary>
  <div class="grid gap-4 border-t border-base-300 p-4 sm:grid-cols-2">
    <label class="flex flex-col gap-1.5 text-xs font-medium text-base-content/70">
      Optional title
      <input type="text" class="input input-bordered w-full" placeholder="Generated automatically if omitted" aria-label="Task title" bind:value={draft.title} />
    </label>
    <label class="flex flex-col gap-1.5 text-xs font-medium text-base-content/70">
      Source ticket
      <input type="text" inputmode="url" class="input input-bordered w-full" placeholder="GitHub issue, Linear, or Jira URL" aria-label="Source ticket link" bind:value={draft.sourceTicketUrl} />
    </label>
  </div>
</details>

<details class="group rounded-xl border border-base-300 bg-base-100">
  <summary class="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
    <span>Advanced settings</span>
    <ChevronDown size={16} class="transition-transform group-open:rotate-180" aria-hidden="true" />
  </summary>
  <div class="grid gap-3 border-t border-base-300 p-4 sm:grid-cols-2">
    <label class="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/80 sm:col-span-2">
      <input type="checkbox" class="toggle toggle-primary toggle-sm" aria-label="Task display title updates" bind:checked={draft.taskDisplayTitleUpdatesEnabled} />
      <span>Auto-update task display title</span>
    </label>
  </div>
</details>

<div class="flex items-start gap-2 rounded-lg bg-base-200 px-3 py-2 text-xs text-base-content/60">
  <Info size={15} class="mt-0.5 shrink-0" aria-hidden="true" />
  <span>You can refine details after starting. The agent will confirm the plan before making changes.</span>
</div>
