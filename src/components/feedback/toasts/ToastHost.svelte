<script lang="ts">
  import AppToast, { type ToastVariant } from './AppToast.svelte'
  import {
    checkpointNotification,
    ciFailureNotification,
    error,
    rateLimitNotification,
    taskSpawned,
  } from '../../../lib/stores'
  import { useAppRouter } from '../../../lib/router.svelte'

  type ToastPosition = 'bottom' | 'raised'
  type ToastItem = {
    id: string
    message: string
    variant: ToastVariant
    title?: string
    description?: string
    actionLabel?: string
    timeout: number
    position: ToastPosition
    onclick?: () => void
    ondismiss: () => void
  }

  const router = useAppRouter()

  function truncate(text: string, max: number): string {
    return text.length > max ? `${text.slice(0, max)}...` : text
  }

  function calculateResetTime(resetAt: number | null): string {
    if (!resetAt) return ''
    const secondsUntilReset = resetAt - Math.floor(Date.now() / 1000)
    if (secondsUntilReset <= 0) return 'now'
    return `${Math.ceil(secondsUntilReset / 60)} min`
  }

  function checkpointMessage(): string {
    const notification = $checkpointNotification
    if (!notification) return ''
    return `Agent needs input on ${notification.ticketKey || truncate(notification.ticketId, 20)}`
  }

  function ciFailureMessage(): string {
    const notification = $ciFailureNotification
    return notification ? `Pipeline failed: ${truncate(notification.pr_title, 40)}` : ''
  }

  function rateLimitMessage(): string {
    const resetAt = $rateLimitNotification?.reset_at
    return resetAt
      ? `GitHub API rate limited\nResets in ${calculateResetTime(resetAt)}`
      : 'GitHub API rate limited'
  }

  function rateLimitDescription(): string {
    const resetAt = $rateLimitNotification?.reset_at
    return resetAt ? `Resets in ${calculateResetTime(resetAt)}` : ''
  }

  const toastItems = $derived.by<ToastItem[]>(() => [
    $error
      ? {
          id: 'error',
          message: $error,
          title: $error,
          variant: 'error',
          timeout: 5000,
          position: 'bottom',
          ondismiss: () => $error = null,
        }
      : null,
    $checkpointNotification
      ? {
          id: 'checkpoint',
          message: checkpointMessage(),
          title: 'Agent needs input on',
          description: $checkpointNotification.ticketKey || truncate($checkpointNotification.ticketId, 20),
          variant: 'warning',
          actionLabel: 'Open',
          timeout: 8000,
          position: 'raised',
          onclick: () => router.navigateToTask($checkpointNotification!.ticketId),
          ondismiss: () => $checkpointNotification = null,
        }
      : null,
    $ciFailureNotification
      ? {
          id: 'ci-failure',
          message: ciFailureMessage(),
          title: 'Pipeline failed:',
          description: truncate($ciFailureNotification.pr_title, 40),
          variant: 'error',
          actionLabel: 'Open',
          timeout: 8000,
          position: 'raised',
          onclick: () => router.navigateToTask($ciFailureNotification!.task_id),
          ondismiss: () => $ciFailureNotification = null,
        }
      : null,
    $taskSpawned
      ? {
          id: 'task-spawned',
          message: `New task created: ${$taskSpawned.promptText}`,
          title: 'New task created:',
          description: $taskSpawned.promptText,
          variant: 'success',
          timeout: 5000,
          position: 'bottom',
          ondismiss: () => $taskSpawned = null,
        }
      : null,
    $rateLimitNotification
      ? {
          id: 'rate-limit',
          message: rateLimitMessage(),
          title: 'GitHub API rate limited',
          description: rateLimitDescription(),
          variant: 'warning',
          timeout: 15000,
          position: 'raised',
          ondismiss: () => $rateLimitNotification = null,
        }
      : null,
  ].filter((item): item is ToastItem => item !== null))
</script>

{#if toastItems.length > 0}
  <div class="toast-stack" role="region" aria-label="Notifications">
    {#each toastItems as toast (toast.id)}
      <AppToast {...toast} />
    {/each}
  </div>
{/if}

<style>
  .toast-stack {
    position: fixed;
    right: var(--of-space4);
    bottom: var(--of-space6);
    z-index: 200;
    display: flex;
    width: min(calc(100vw - 2 * var(--of-space4)), 24rem);
    flex-direction: column;
    align-items: stretch;
    gap: var(--of-space2);
    pointer-events: none;
  }

  .toast-stack :global(.app-toast) {
    pointer-events: auto;
  }

  @media (max-width: 640px) {
    .toast-stack {
      right: var(--of-space3);
      bottom: var(--of-space4);
      width: calc(100vw - 2 * var(--of-space3));
    }
  }
</style>
