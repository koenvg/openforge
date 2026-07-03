<script lang="ts">
  import HoverTooltip from './HoverTooltip.svelte'

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
</script>

{#if description}
  <HoverTooltip text={description}>
    <button
      class="context-item block w-full text-left px-3 py-2 text-sm rounded {variantClasses}"
      {onclick}
      {disabled}
      role="menuitem"
    >
      {label}
    </button>
  </HoverTooltip>
{:else}
  <button
    class="context-item block w-full text-left px-3 py-2 text-sm rounded {variantClasses}"
    {onclick}
    {disabled}
    role="menuitem"
  >
    {label}
  </button>
{/if}
