<script lang="ts">
  import type { Action } from '../../lib/types'
  import HoverTooltip from '../shared/ui/HoverTooltip.svelte'
  import AnchoredMenu from '../shared/ui/AnchoredMenu.svelte'
  import ContextMenuItem from '../shared/ui/ContextMenuItem.svelte'
  import { ChevronDown } from '@lucide/svelte'

  interface Props {
    actions: Action[]
    disabled?: boolean
    onAction: (action: Action) => void
  }

  let { actions, disabled = false, onAction }: Props = $props()

  let isOpen = $state(false)
  let triggerRef: HTMLButtonElement | null = $state(null)

  let primaryAction = $derived(actions[0])
  let otherActions = $derived(actions.slice(1))

  function toggleDropdown(e: MouseEvent) {
    e.stopPropagation()
    if (disabled) return
    isOpen = !isOpen
  }

  function handlePrimaryClick() {
    if (disabled || !primaryAction) return
    onAction(primaryAction)
  }

  function handleActionClick(action: Action) {
    if (!action.enabled) return
    isOpen = false
    onAction(action)
  }
</script>

{#if actions.length === 0}
  <!-- No actions to display -->
{:else if actions.length === 1}
  {#if primaryAction.prompt}
    <HoverTooltip text={primaryAction.prompt} position="left">
      <button
        class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
        disabled={disabled}
        onclick={handlePrimaryClick}
      >
        {primaryAction.name}
      </button>
    </HoverTooltip>
  {:else}
    <button
      class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200"
      disabled={disabled}
      onclick={handlePrimaryClick}
    >
      {primaryAction.name}
    </button>
  {/if}
{:else}
  <div class="relative">
    <div class="flex items-stretch">
      {#if primaryAction.prompt}
        <HoverTooltip text={primaryAction.prompt} position="left">
          <button
            class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-r-none border-r-0"
            disabled={disabled}
            onclick={handlePrimaryClick}
          >
            {primaryAction.name}
          </button>
        </HoverTooltip>
      {:else}
        <button
          class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-r-none border-r-0"
          disabled={disabled}
          onclick={handlePrimaryClick}
        >
          {primaryAction.name}
        </button>
      {/if}
      
      <button
        bind:this={triggerRef}
        class="btn btn-soft btn-sm shadow-sm hover:shadow-md hover:btn-primary transition-all duration-200 rounded-l-none px-1.5"
        disabled={disabled}
        onclick={toggleDropdown}
        aria-label="More actions"
        aria-expanded={isOpen}
        aria-haspopup="menu"
      >
        <ChevronDown size={14} class="transition-transform duration-200 {isOpen ? 'rotate-180' : ''}" />
      </button>
    </div>

    <AnchoredMenu visible={isOpen} trigger={triggerRef} onClose={() => { isOpen = false }}>
      <div class="max-h-[300px] overflow-y-auto">
        {#each otherActions as action (action.id)}
          <ContextMenuItem
            label={action.name}
            description={action.prompt || undefined}
            disabled={!action.enabled}
            onclick={() => handleActionClick(action)}
          />
        {/each}
      </div>
    </AnchoredMenu>
  </div>
{/if}
