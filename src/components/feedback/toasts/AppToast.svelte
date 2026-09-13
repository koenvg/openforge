<script lang="ts">
  import { AlertCircle, CheckCircle2, Info, TriangleAlert, X } from '@lucide/svelte'
  import LoadingIndicator from '@openforge-app/plugin-sdk/ui/LoadingIndicator.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import { onDestroy } from 'svelte'

  export type ToastVariant = 'error' | 'warning' | 'success' | 'info' | 'neutral' | 'loading'
  type ToastPosition = 'bottom' | 'raised'

  interface Props {
    message: string
    variant: ToastVariant
    title?: string
    description?: string
    actionLabel?: string
    timeout?: number
    onclick?: () => void
    ondismiss: () => void
    position?: ToastPosition
  }

  let {
    message,
    variant,
    title,
    description,
    actionLabel,
    timeout = 5000,
    onclick,
    ondismiss,
    position = 'bottom',
  }: Props = $props()

  let timer: ReturnType<typeof setTimeout> | undefined
  let dismissed = false

  const role = $derived(variant === 'error' ? 'alert' : 'status')
  const ariaLive = $derived(variant === 'error' ? 'assertive' : 'polite')
  const hasStructuredCopy = $derived(title !== undefined || description !== undefined)
  const needsFullMessageText = $derived(
    title !== undefined && message !== title && !message.startsWith(`${title}\n`),
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
    if (timeout <= 0) return
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
  class="app-toast"
  class:app-toast-raised={position === 'raised'}
  data-position={position}
  data-variant={variant}
  role={role}
  aria-live={ariaLive}
>
  <div class="app-toast-icon app-toast-icon--{variant}" aria-hidden="true">
    {#if variant === 'error'}
      <AlertCircle size={17} strokeWidth={2.2} />
    {:else if variant === 'warning'}
      <TriangleAlert size={17} strokeWidth={2.2} />
    {:else if variant === 'success'}
      <CheckCircle2 size={17} strokeWidth={2.2} />
    {:else if variant === 'loading'}
      <LoadingIndicator decorative style="width: 17px; height: 17px" />
    {:else}
      <Info size={17} strokeWidth={2.2} />
    {/if}
  </div>

  <div class="app-toast-content">
    {#if hasStructuredCopy}
      {#if needsFullMessageText}
        <span class="sr-only">{message}</span>
      {/if}
      <div aria-hidden={needsFullMessageText ? 'true' : undefined}>
        <p class="app-toast-title">{title ?? message}</p>
        {#if description}
          <p class="app-toast-description">{description}</p>
        {/if}
      </div>
    {:else if onclick}
      <button class="app-toast-title app-toast-title-action" type="button" aria-label={message} onclick={activate}>
        {message}
      </button>
    {:else}
      <p class="app-toast-title whitespace-pre-line">{message}</p>
    {/if}

    {#if actionLabel && onclick}
      <Button
        variant="secondary"
        size="xs"
        class="app-toast-action"
        type="button"
        aria-label={`${actionLabel}: ${message}`}
        onclick={activate}
      >{actionLabel}</Button>
    {/if}
  </div>

  <IconButton label="Dismiss notification" size="xs" class="app-toast-dismiss" onclick={dismiss}>
    <X size={15} strokeWidth={1.8} aria-hidden="true" />
  </IconButton>
</div>

<style>
  .app-toast {
    display: flex;
    width: 100%;
    max-width: 24rem;
    align-items: flex-start;
    gap: var(--of-space3);
    box-sizing: border-box;
    padding: var(--of-space3);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: calc(var(--of-radius-container) + var(--of-space1));
    background: var(--of-surface);
    box-shadow:
      0 1.25rem 2.5rem color-mix(in srgb, var(--of-text) 12%, transparent),
      0 0.25rem 0.75rem color-mix(in srgb, var(--of-text) 8%, transparent);
    animation: toast-enter var(--of-duration-normal) var(--of-ease-standard);
  }

  .app-toast-icon {
    display: grid;
    width: var(--of-control-height-compact);
    height: var(--of-control-height-compact);
    flex: 0 0 auto;
    place-items: center;
    margin-top: calc(var(--of-space1) / 2);
    border-radius: var(--of-radius-round);
    color: var(--of-text-secondary);
    background: var(--of-surface-subtle);
  }

  .app-toast-icon--error {
    color: var(--of-danger);
    background: color-mix(in srgb, var(--of-danger) 12%, var(--of-surface));
  }

  .app-toast-icon--warning {
    color: var(--of-warning);
    background: color-mix(in srgb, var(--of-warning) 14%, var(--of-surface));
  }

  .app-toast-icon--success {
    color: var(--of-success);
    background: color-mix(in srgb, var(--of-success) 13%, var(--of-surface));
  }

  .app-toast-icon--info,
  .app-toast-icon--neutral {
    color: var(--of-info);
    background: color-mix(in srgb, var(--of-info) 12%, var(--of-surface));
  }

  .app-toast-icon--loading {
    color: var(--of-accent);
    background: color-mix(in srgb, var(--of-accent) 12%, var(--of-surface));
  }

  .app-toast-content {
    min-width: 0;
    flex: 1 1 auto;
    padding-top: 0;
  }

  .app-toast-title,
  .app-toast-description {
    margin: 0;
    overflow-wrap: anywhere;
  }

  .app-toast-title {
    color: var(--of-text);
    font-size: var(--of-text-sm);
    font-weight: var(--of-weight-medium);
    line-height: var(--of-line-height-sm);
  }

  .app-toast-title-action {
    display: block;
    width: 100%;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    text-align: left;
  }

  .app-toast-description {
    margin-top: var(--of-space1);
    color: var(--of-text-secondary);
    font-size: var(--of-text-xs);
    line-height: var(--of-line-height-sm);
  }

  .app-toast-action {
    margin-top: var(--of-space2);
  }

  .app-toast-dismiss {
    flex: 0 0 auto;
    color: var(--of-text-muted);
  }

  .app-toast-dismiss:hover {
    color: var(--of-text);
  }

  @keyframes toast-enter {
    from {
      opacity: 0;
      transform: translateY(0.5rem) scale(0.98);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .app-toast {
      animation: none;
    }
  }
</style>
