<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'
  import TooltipControl from './TooltipControl.svelte'
  import type { TooltipAlign, TooltipSide } from './Tooltip.svelte'

  type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'link' | 'destructive' | 'danger' | 'error'
  type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends Omit<HTMLButtonAttributes, 'aria-label' | 'children'> {
    label: string
    children: Snippet
    variant?: IconButtonVariant
    size?: IconButtonSize
    loading?: boolean
    loadingLabel?: string
    tooltip?: boolean
    tooltipSide?: TooltipSide
    tooltipAlign?: TooltipAlign
    tooltipSideOffset?: number
    onClick?: (event: MouseEvent) => void
  }

  let {
    label,
    children,
    variant = 'ghost',
    size = 'md',
    loading = false,
    loadingLabel,
    tooltip = true,
    tooltipSide = 'top',
    tooltipAlign = 'center',
    tooltipSideOffset = 6,
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

<TooltipControl
  content={effectiveLabel}
  disabled={!tooltip || effectiveDisabled}
  side={tooltipSide}
  align={tooltipAlign}
  sideOffset={tooltipSideOffset}
  triggerAttributes={{
    ...attributes,
    type: attributes.type ?? 'submit',
    title: tooltip ? undefined : attributes.title,
    class: className,
    'aria-label': effectiveLabel,
    'aria-busy': effectiveAriaBusy,
    disabled: effectiveDisabled,
    onclick,
  }}
>
  {#snippet trigger(props)}
    <ButtonControl
      {...props}
      variant={semanticVariant}
      {size}
      kind="icon"
      {loading}
      {onClick}
      {children}
    />
  {/snippet}
</TooltipControl>
