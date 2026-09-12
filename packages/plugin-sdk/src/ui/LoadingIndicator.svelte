<script lang="ts">
  import type { HTMLAttributes } from 'svelte/elements'

  interface Props extends Omit<HTMLAttributes<HTMLSpanElement>, 'children'> {
    size?: 'xs' | 'sm' | 'md' | 'lg'
    decorative?: boolean
  }

  let {
    size = 'md',
    decorative,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledby,
    role = 'status',
    'aria-live': ariaLive,
    ...attributes
  }: Props = $props()
  let hidden = $derived(decorative ?? !(ariaLabel || ariaLabelledby))
</script>

<span
  {...attributes}
  data-size={size}
  role={hidden ? undefined : role}
  aria-hidden={hidden ? true : undefined}
  aria-label={hidden ? undefined : ariaLabel}
  aria-labelledby={hidden ? undefined : ariaLabelledby}
  aria-live={hidden ? undefined : ariaLive}
></span>

<style>
  span {
    box-sizing: border-box;
    display: inline-block;
    flex-shrink: 0;
    vertical-align: middle;
    width: calc(var(--of-control-height-compact) * .75);
    height: calc(var(--of-control-height-compact) * .75);
    border: 2px solid currentColor;
    border-right-color: transparent;
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }
  span[data-size='xs'] { width: calc(var(--of-control-height-compact) * .5); height: calc(var(--of-control-height-compact) * .5); }
  span[data-size='sm'] { width: calc(var(--of-control-height-compact) * .625); height: calc(var(--of-control-height-compact) * .625); }
  span[data-size='lg'] { width: calc(var(--of-control-height-compact) * .875); height: calc(var(--of-control-height-compact) * .875); }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { span { animation: none; } }
</style>
