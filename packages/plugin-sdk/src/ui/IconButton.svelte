<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'

  type IconButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends Omit<HTMLButtonAttributes, 'aria-label' | 'children'> {
    label: string
    children: Snippet
    variant?: IconButtonVariant
    size?: IconButtonSize
    onClick?: (event: MouseEvent) => void
  }

  let {
    label,
    children,
    variant = 'ghost',
    size = 'md',
    class: className,
    disabled = false,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()
</script>

<ButtonControl
  {...attributes}
  class={className}
  aria-label={label}
  {variant}
  {size}
  kind="icon"
  {disabled}
  {onclick}
  {onClick}
  {children}
/>
