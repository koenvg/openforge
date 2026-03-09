<script lang="ts">
  interface Props {
    label: string
    onclick: (e: MouseEvent) => void
    variant?: 'default' | 'primary' | 'danger'
  }

  let { label, onclick, variant = 'default' }: Props = $props()

  let variantClasses = $derived(
    variant === 'primary'
      ? 'text-primary font-medium hover:bg-primary hover:text-primary-content'
      : variant === 'danger'
        ? 'text-error hover:bg-error hover:text-error-content'
        : 'text-base-content hover:bg-primary hover:text-primary-content'
  )
</script>

<button
  class="context-item block w-full text-left px-3 py-2 text-sm cursor-pointer rounded {variantClasses}"
  {onclick}
  role="menuitem"
>
  {label}
</button>
