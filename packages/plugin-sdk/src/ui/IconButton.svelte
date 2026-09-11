<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'

  type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive' | 'danger' | 'error'
  type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends Omit<HTMLButtonAttributes, 'aria-label' | 'children'> {
    label: string
    children: Snippet
    variant?: IconButtonVariant
    size?: IconButtonSize
    loading?: boolean
    loadingLabel?: string
    onClick?: (event: MouseEvent) => void
  }

  let {
    label,
    children,
    variant = 'ghost',
    size = 'md',
    loading = false,
    loadingLabel,
    class: className,
    disabled = false,
    'aria-busy': ariaBusy,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()

  let semanticVariant = $derived(variant === 'danger' || variant === 'error' ? 'destructive' : variant)
  let effectiveDisabled = $derived(disabled || loading)
  let effectiveLabel = $derived(loading && loadingLabel ? loadingLabel : label)
  let effectiveAriaBusy = $derived(loading ? 'true' : ariaBusy)
</script>

<ButtonControl
  {...attributes}
  class={className}
  aria-label={effectiveLabel}
  variant={semanticVariant}
  {size}
  kind="icon"
  {loading}
  disabled={effectiveDisabled}
  aria-busy={effectiveAriaBusy}
  {onclick}
  {onClick}
  {children}
/>
