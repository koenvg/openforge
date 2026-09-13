<script lang="ts">
  import Tooltip from '@openforge-app/plugin-sdk/ui/Tooltip.svelte'

  interface Props {
    label: string
    onclick: (e: MouseEvent) => void
    variant?: 'default' | 'primary' | 'danger'
    description?: string
    disabled?: boolean
  }

  let { label, onclick, variant = 'default', description, disabled = false }: Props = $props()

  let variantClasses = $derived(
    disabled
      ? 'text-of-text/40 cursor-not-allowed'
      : variant === 'primary'
        ? 'text-of-text font-semibold hover:bg-of-accent hover:text-of-on-accent cursor-pointer'
        : variant === 'danger'
          ? 'text-of-danger hover:bg-of-danger hover:text-of-on-danger cursor-pointer'
          : 'text-of-text hover:bg-of-accent hover:text-of-on-accent cursor-pointer'
  )
  let menuItemClasses = $derived(`context-item block w-full text-left px-3 py-2 text-sm rounded-[var(--of-radius-container)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-of-accent ${variantClasses}`)
</script>

{#if description}
  <Tooltip
    label={label}
    content={description}
    delayDuration={200}
    side="right"
    class="block w-full"
    {disabled}
    triggerClass={menuItemClasses}
    triggerRole="menuitem"
    triggerTabindex={-1}
    triggerTitle={description}
    onTriggerClick={onclick}
  >
    {#snippet trigger()}
      {label}
    {/snippet}
  </Tooltip>
{:else}
  <button type="button"
    class={menuItemClasses}
    {onclick}
    {disabled}
    role="menuitem"
    tabindex="-1"
  >
    {label}
  </button>
{/if}
