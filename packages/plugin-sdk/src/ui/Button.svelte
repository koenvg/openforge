<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { HTMLButtonAttributes } from 'svelte/elements'

  type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'error'
  type ButtonSize = 'xs' | 'sm' | 'md' | 'lg'

  interface Props extends HTMLButtonAttributes {
    children: Snippet
    variant?: ButtonVariant
    size?: ButtonSize
  }

  const variantClasses: Record<ButtonVariant, string> = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    outline: 'btn-outline',
    ghost: 'btn-ghost',
    error: 'btn-error',
  }

  const sizeClasses: Record<ButtonSize, string> = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: 'btn-md',
    lg: 'btn-lg',
  }

  let {
    children,
    variant = 'primary',
    size = 'md',
    class: className,
    disabled = false,
    onclick,
    ...attributes
  }: Props = $props()
</script>

<button
  {...attributes}
  class={['btn', variantClasses[variant], sizeClasses[size], className]}
  {disabled}
  onclick={(event) => {
    if (!disabled) onclick?.(event)
  }}
>
  {@render children()}
</button>
