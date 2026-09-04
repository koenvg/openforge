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
      ? 'text-base-content/40 cursor-not-allowed'
      : variant === 'primary'
        ? 'text-base-content font-semibold hover:bg-primary hover:text-primary-content cursor-pointer'
        : variant === 'danger'
          ? 'text-error hover:bg-error hover:text-error-content cursor-pointer'
          : 'text-base-content hover:bg-primary hover:text-primary-content cursor-pointer'
  )
  let menuItemClasses = $derived(`context-item block w-full text-left px-3 py-2 text-sm rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${variantClasses}`)
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
