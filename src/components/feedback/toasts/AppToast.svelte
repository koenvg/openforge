<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { onDestroy } from 'svelte'

  type ToastVariant = 'error' | 'warning' | 'success'
  type ToastPosition = 'bottom' | 'raised'

  interface Props {
    message: string
    variant: ToastVariant
    timeout?: number
    onclick?: () => void
    ondismiss: () => void
    position?: ToastPosition
  }

  let {
    message,
    variant,
    timeout = 5000,
    onclick,
    ondismiss,
    position = 'bottom',
  }: Props = $props()

  let timer: ReturnType<typeof setTimeout> | undefined
  let dismissed = false

  const role = $derived(variant === 'error' ? 'alert' : 'status')
  const ariaLive = $derived(variant === 'error' ? 'assertive' : 'polite')
  const variantClass = $derived(
    variant === 'error' ? 'alert-error' : variant === 'warning' ? 'alert-warning' : 'alert-success',
  )

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function dismiss(): void {
    if (dismissed) return
    dismissed = true
    clearTimer()
    ondismiss()
  }

  function activate(): void {
    onclick?.()
    dismiss()
  }

  function resetTimer(): void {
    clearTimer()
    dismissed = false
    timer = setTimeout(dismiss, timeout)
  }

  $effect(() => {
    message
    variant
    timeout
    resetTimer()
  })

  onDestroy(clearTimer)
</script>

<div
  class:toast-bottom={position === 'bottom'}
  class:bottom-20={position === 'raised'}
  class="toast toast-end z-[200]"
  data-position={position}
>
  <div
    class="alert {variantClass} max-w-[400px] gap-3 text-sm shadow-lg animate-slideIn"
    role={role}
    aria-live={ariaLive}
  >
    {#if onclick}
      <button
        class="min-w-0 flex-1 cursor-pointer break-words text-left font-semibold"
        type="button"
        aria-label={message}
        onclick={activate}
      >{message}</button>
    {:else}
      <span class="min-w-0 flex-1 whitespace-pre-line break-words">{message}</span>
    {/if}
    <Button
      variant="ghost" size="xs" class="shrink-0"
      type="button"
      aria-label="Dismiss notification"
      onclick={dismiss}
    >✕</Button>
  </div>
</div>
