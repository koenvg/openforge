<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'
  import TooltipControl from './TooltipControl.svelte'
  import type { TooltipAlign, TooltipSide } from './Tooltip.svelte'

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
    tooltip?: boolean
    tooltipSide?: TooltipSide
    tooltipAlign?: TooltipAlign
    tooltipSideOffset?: number
  }

  let {
    children,
    variant = 'primary',
    size = 'md',
    loading = false,
    loadingLabel,
    element = $bindable(),
    tooltip = false,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipSideOffset = 6,
    title,
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
  let tooltipEnabled = $derived(tooltip && Boolean(effectiveAriaLabel?.trim()))
</script>

<TooltipControl
  content={effectiveAriaLabel ?? ''}
  disabled={!tooltipEnabled || effectiveDisabled}
  side={tooltipSide}
  align={tooltipAlign}
  sideOffset={tooltipSideOffset}
  triggerAttributes={{
    ...attributes,
    type: attributes.type ?? 'submit',
    title: tooltipEnabled ? undefined : title,
    class: className,
    disabled: effectiveDisabled,
    'aria-label': effectiveAriaLabel,
    'aria-busy': effectiveAriaBusy,
    onclick,
  }}
>
  {#snippet trigger(props)}
    <ButtonControl
      {...props}
      bind:element
      variant={semanticVariant}
      {size}
      kind="text"
      {loading}
      {onClick}
      {children}
    />
  {/snippet}
</TooltipControl>
