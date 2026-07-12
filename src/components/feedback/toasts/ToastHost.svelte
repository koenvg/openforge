<script lang="ts">
  import AppToast from './AppToast.svelte'
  import {
    checkpointNotification,
    ciFailureNotification,
    error,
    rateLimitNotification,
    taskSpawned,
  } from '../../../lib/stores'
  import { useAppRouter } from '../../../lib/router.svelte'

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
</script>

{#if $error}
  <AppToast message={$error} variant="error" timeout={5000} ondismiss={() => $error = null} />
{/if}

{#if $checkpointNotification}
  <AppToast
    message={checkpointMessage()}
    variant="warning"
    timeout={8000}
    position="raised"
    onclick={() => router.navigateToTask($checkpointNotification!.ticketId)}
    ondismiss={() => $checkpointNotification = null}
  />
{/if}

{#if $ciFailureNotification}
  <AppToast
    message={ciFailureMessage()}
    variant="error"
    timeout={8000}
    position="raised"
    onclick={() => router.navigateToTask($ciFailureNotification!.task_id)}
    ondismiss={() => $ciFailureNotification = null}
  />
{/if}

{#if $taskSpawned}
  <AppToast
    message={`New task created: ${$taskSpawned.promptText}`}
    variant="success"
    timeout={5000}
    ondismiss={() => $taskSpawned = null}
  />
{/if}

{#if $rateLimitNotification}
  <AppToast
    message={rateLimitMessage()}
    variant="warning"
    timeout={15000}
    position="raised"
    ondismiss={() => $rateLimitNotification = null}
  />
{/if}
