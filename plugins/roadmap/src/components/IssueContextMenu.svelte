<script lang="ts">
  import type { Action } from '@openforge-app/plugin-sdk'

  interface Props {
    visible: boolean
    x: number
    y: number
    actions: Action[]
    disabled?: boolean
    onClose: () => void
    onStart: () => void
    onRunAction: (action: Action) => void
  }

  let { visible, x, y, actions, disabled = false, onClose, onStart, onRunAction }: Props = $props()

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose()
  }
</script>

<svelte:window onclick={onClose} onkeydown={handleKeydown} />

{#if visible}
  <div
    class="fixed z-[100] min-w-48 rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
    style="left: {x}px; top: {y}px;"
    role="menu"
    tabindex="-1"
    aria-label="Roadmap issue actions"
    onclick={(event) => event.stopPropagation()}
    onkeydown={handleKeydown}
  >
    <button
      type="button"
      class="block w-full rounded px-3 py-2 text-left text-sm font-semibold text-base-content transition-colors hover:bg-primary hover:text-primary-content disabled:pointer-events-none disabled:opacity-50"
      role="menuitem"
      {disabled}
      onclick={onStart}
    >
      Start Task
    </button>

    {#if actions.length > 0}
      <div class="my-1 border-t border-base-content/10"></div>
      {#each actions as action (action.id)}
        <button
          type="button"
          class="block w-full rounded px-3 py-2 text-left text-sm text-base-content transition-colors hover:bg-primary hover:text-primary-content disabled:pointer-events-none disabled:opacity-50"
          role="menuitem"
          title={action.prompt}
          {disabled}
          onclick={() => onRunAction(action)}
        >
          <span class="block truncate">{action.name}</span>
          {#if action.prompt}
            <span class="block max-w-72 truncate text-xs opacity-60">{action.prompt}</span>
          {/if}
        </button>
      {/each}
    {/if}
  </div>
{/if}
