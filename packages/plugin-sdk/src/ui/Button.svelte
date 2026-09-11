<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'

  type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive' | 'danger' | 'error'
  type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    children: Snippet
    variant?: ButtonVariant
    size?: ButtonSize
    loading?: boolean
    loadingLabel?: string
    onClick?: (event: MouseEvent) => void
    element?: HTMLButtonElement
  }

  let {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    element = $bindable(),
    class: className,
    disabled = false,
    'aria-busy': ariaBusy,
    'aria-label': ariaLabel,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()

  let semanticVariant = $derived(variant === 'danger' || variant === 'error' ? 'destructive' : variant)
  let effectiveDisabled = $derived(disabled || loading)
  let effectiveAriaLabel = $derived(loading && loadingLabel ? loadingLabel : ariaLabel)
  let effectiveAriaBusy = $derived(loading ? 'true' : ariaBusy)
</script>

<ButtonControl
  bind:element
  {...attributes}
  class={className}
  variant={semanticVariant}
  {size}
  kind="text"
  {loading}
  disabled={effectiveDisabled}
  aria-label={effectiveAriaLabel}
  aria-busy={effectiveAriaBusy}
  {onclick}
  {onClick}
  {children}
/>
