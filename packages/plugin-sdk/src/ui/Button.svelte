<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'
  import ButtonControl from './ButtonControl.svelte'

  type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'error'
  type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    children: Snippet
    variant?: ButtonVariant
    size?: ButtonSize
    onClick?: (event: MouseEvent) => void
    element?: HTMLButtonElement
  }

  let {
    children,
    variant = 'primary',
    size = 'md',
    element = $bindable(),
    class: className,
    disabled = false,
    onclick,
    onClick,
    ...attributes
  }: Props = $props()

  let semanticVariant = $derived(variant === 'error' ? 'danger' : variant)
</script>

<ButtonControl
  bind:element
  {...attributes}
  class={className}
  variant={semanticVariant}
  {size}
  kind="text"
  {disabled}
  {onclick}
  {onClick}
  {children}
/>
