<script lang="ts">
  import { ChevronDown, Info } from '@lucide/svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import type { CreateTaskDraft } from './createTaskDraft'

  interface Props {
    draft: CreateTaskDraft
  }

  let { draft = $bindable() }: Props = $props()
</script>

<details class="task-settings-section group">
  <summary>
    <span>Title and source ticket</span>
    <ChevronDown size={16} class="transition-transform group-open:rotate-180" aria-hidden="true" />
  </summary>
  <div class="grid gap-4 border-t border-[var(--of-border)] p-4 sm:grid-cols-2">
    <TextField
      label="Optional title"
      aria-label="Task title"
      placeholder="Generated automatically if omitted"
      bind:value={draft.title}
    />
    <TextField
      label="Source ticket"
      aria-label="Source ticket link"
      inputmode="url"
      placeholder="GitHub issue, Linear, or Jira URL"
      bind:value={draft.sourceTicketUrl}
    />
  </div>
</details>

<details class="task-settings-section group">
  <summary>
    <span>Advanced settings</span>
    <ChevronDown size={16} class="transition-transform group-open:rotate-180" aria-hidden="true" />
  </summary>
  <div class="grid gap-3 border-t border-[var(--of-border)] p-4 sm:grid-cols-2">
    <Switch
      class="sm:col-span-2"
      label="Auto-update task display title"
      aria-label="Task display title updates"
      bind:checked={draft.taskDisplayTitleUpdatesEnabled}
    />
  </div>
</details>

<div class="flex items-start gap-2 bg-[var(--of-surface-subtle)] px-3 py-2 text-xs text-[var(--of-text-muted)]">
  <Info size={15} class="mt-0.5 shrink-0" aria-hidden="true" />
  <span>You can refine details after starting. The agent will confirm the plan before making changes.</span>
</div>

<style>
  .task-settings-section {
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
    color: var(--of-text);
  }

  summary {
    display: flex;
    min-height: var(--of-control-height-touch);
    align-items: center;
    justify-content: space-between;
    padding-inline: var(--of-space4);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    list-style: none;
    cursor: pointer;
  }

  summary:focus-visible {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  @media (prefers-reduced-motion: reduce) {
    summary :global(svg) {
      transition: none;
    }
  }
</style>
