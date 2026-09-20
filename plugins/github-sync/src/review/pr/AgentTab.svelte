<script lang="ts">
  import { onDestroy } from 'svelte'
  import type {
    Disposable,
    ScopedAgentSessionState,
    SessionScope,
  } from '@openforge-app/plugin-sdk'
  import type { WalkthroughAttemptState } from '../../lib/walkthroughRecord'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Textarea from '@openforge-app/plugin-sdk/ui/Textarea.svelte'

  interface Props {
    scope: SessionScope | null
    projectResolved: boolean
    projectId: string | null
    status: ScopedAgentSessionState | null
    isLoading: boolean
    actionPending: boolean
    error: string | null
    availabilityError: string | null
    walkthroughStatus?: WalkthroughAttemptState | null
    acceptedStepCount?: number
    mountTerminal: (scope: SessionScope, element: HTMLElement) => Promise<Disposable>
    onStart: () => Promise<unknown>
    onAbort: () => Promise<unknown>
    onRestart: () => Promise<unknown>
    onSendInput: (input: string) => Promise<unknown>
    onRetryAvailability: () => Promise<unknown>
  }

  let {
    scope,
    projectResolved,
    projectId,
    status,
    isLoading,
    actionPending,
    error,
    availabilityError,
    walkthroughStatus = null,
    acceptedStepCount = 0,
    mountTerminal,
    onStart,
    onAbort,
    onRestart,
    onSendInput,
    onRetryAvailability,
  }: Props = $props()

  let terminalElement = $state<HTMLElement>()
  let terminalError = $state<string | null>(null)
  let message = $state('')
  let sendError = $state<string | null>(null)
  let destroyed = false
  let requested: { key: string; scope: SessionScope; element: HTMLElement } | null = null
  let attached: { key: string; element: HTMLElement; disposable: Disposable } | null = null
  let reconciliation = Promise.resolve()

  function scopeKey(value: SessionScope): string {
    return JSON.stringify([value.namespace, value.targetKey, value.revision])
  }

  function sameTarget(
    left: { key: string; element: HTMLElement } | null,
    right: { key: string; element: HTMLElement } | null,
  ): boolean {
    return left?.key === right?.key && left?.element === right?.element
  }

  function requestTerminalMount(next: typeof requested): void {
    if (sameTarget(requested, next)) return
    requested = next
    reconciliation = reconciliation.then(async () => {
      const target = requested
      if (attached && (!target || !sameTarget(attached, target))) {
        const previous = attached
        attached = null
        try {
          await previous.disposable.dispose()
        } catch (cause) {
          if (!destroyed) {
            terminalError = cause instanceof Error && cause.message.trim().length > 0
              ? cause.message
              : 'Failed to detach the previous review agent terminal.'
          }
        }
      }
      if (destroyed || !target || sameTarget(attached, target)) return

      try {
        const disposable = await mountTerminal(target.scope, target.element)
        if (destroyed || !sameTarget(requested, target)) {
          await disposable.dispose()
          return
        }
        attached = { ...target, disposable }
        terminalError = null
      } catch (cause) {
        if (!destroyed && sameTarget(requested, target)) {
          requested = null
          terminalError = cause instanceof Error && cause.message.trim().length > 0
            ? cause.message
            : 'Failed to mount the review agent terminal.'
        }
      }
    })
  }

  $effect(() => {
    const next = scope && status && terminalElement
      ? { key: scopeKey(scope), scope, element: terminalElement }
      : null
    requestTerminalMount(next)
  })

  onDestroy(() => {
    destroyed = true
    requested = null
    reconciliation = reconciliation.then(async () => {
      const current = attached
      attached = null
      await current?.disposable.dispose()
    }).catch(() => undefined)
  })

  function stateLabel(state: ScopedAgentSessionState): string {
    switch (state.status) {
      case 'queued': return 'Queued'
      case 'starting': return 'Starting'
      case 'running': return 'Running'
      case 'paused': return 'Awaiting input'
      case 'completed': return 'Completed'
      case 'failed': return 'Failed'
      case 'aborted': return 'Aborted'
      case 'interrupted': return 'Interrupted'
    }
  }

  function stateMessage(state: ScopedAgentSessionState): string {
    switch (state.status) {
      case 'queued':
        return state.queuePosition
          ? `Waiting for an available agent slot. Queue position ${state.queuePosition}.`
          : 'Waiting for an available agent slot.'
      case 'starting': return 'Preparing the read-only checkout and starting the review agent.'
      case 'running': return 'The review agent is working in the read-only checkout.'
      case 'paused': return 'The review agent is awaiting input.'
      case 'completed': return 'The review agent completed this turn. You can continue the same conversation.'
      case 'failed': return state.errorMessage ?? 'The review agent failed.'
      case 'aborted': return 'The review agent was stopped. Its output remains available below.'
      case 'interrupted': return state.errorMessage ?? 'The review agent was interrupted. Its output remains available below.'
    }
  }

  function isActive(state: ScopedAgentSessionState): boolean {
    return state.status === 'queued'
      || state.status === 'starting'
      || state.status === 'running'
      || state.status === 'paused'
  }

  function canRestart(state: ScopedAgentSessionState): boolean {
    return walkthroughStatus === 'no-submissions'
      || walkthroughStatus === 'failed'
      || walkthroughStatus === 'aborted'
      || state.status === 'failed'
      || state.status === 'aborted'
      || state.status === 'interrupted'
  }

  function generationMessage(): string | null {
    if (walkthroughStatus === 'generating') {
      return acceptedStepCount === 0
        ? 'Generating walkthrough. No steps accepted yet.'
        : `Generating walkthrough. ${acceptedStepCount} step${acceptedStepCount === 1 ? '' : 's'} accepted so far.`
    }
    if (walkthroughStatus === 'ready') {
      return `Walkthrough ready with ${acceptedStepCount} accepted step${acceptedStepCount === 1 ? '' : 's'}.`
    }
    if (walkthroughStatus === 'no-submissions') {
      return 'The agent finished without submitting a walkthrough. Ask it to try again and submit each step through the OpenForge CLI.'
    }
    if (walkthroughStatus === 'failed') return 'Walkthrough generation failed. Review the diagnostic below and try again.'
    if (walkthroughStatus === 'aborted') return 'Walkthrough generation was stopped. Accepted steps remain provisional.'
    return null
  }

  async function sendMessage(): Promise<void> {
    const input = message.trim()
    if (!input) return
    sendError = null
    try {
      await onSendInput(input)
      message = ''
    } catch (cause) {
      sendError = cause instanceof Error && cause.message.trim().length > 0
        ? cause.message
        : 'Failed to send the message.'
    }
  }
</script>

<section class="flex h-full min-h-0 flex-col bg-base-100" aria-label="Pull request review agent">
  {#if availabilityError !== null || isLoading || !projectResolved || !scope}
    <div
      class="m-auto max-w-lg px-6 text-center"
      role={availabilityError !== null ? undefined : 'status'}
      aria-live={availabilityError !== null ? undefined : 'polite'}
      aria-atomic={availabilityError !== null ? undefined : 'true'}
    >
      {#if availabilityError !== null}
        <div class="flex flex-col items-center gap-3">
          <h3 class="m-0 text-base font-semibold text-base-content">Couldn’t check the review agent</h3>
          <p class="m-0 text-sm text-error" role="alert">{availabilityError}</p>
          <Button disabled={isLoading} onclick={() => { void onRetryAvailability().catch(() => undefined) }}>
            Try again
          </Button>
        </div>
      {:else}
        <h3 class="m-0 text-base font-semibold text-base-content">Checking review agent availability…</h3>
      {/if}
    </div>
  {:else if status === null}
    <div class="m-auto flex max-w-lg flex-col items-center gap-3 px-6 text-center">
      {#if projectId === null}
        <h3 class="m-0 text-base font-semibold text-base-content">Review agent unavailable</h3>
        <p class="m-0 text-sm text-base-content/70">
          A local OpenForge Project linked to this repository is required to start the review agent.
        </p>
        <Button disabled>Generate walkthrough</Button>
      {:else}
        <h3 class="m-0 text-base font-semibold text-base-content">No walkthrough session yet.</h3>
        <p class="m-0 text-sm text-base-content/70">
          Generate a walkthrough in a host-owned, read-only checkout of this pull request head.
        </p>
        <Button disabled={actionPending} onclick={() => { void onStart().catch(() => undefined) }}>
          Generate walkthrough
        </Button>
      {/if}
      {#if error}
        <p class="m-0 text-sm text-error" role="alert">{error}</p>
      {/if}
    </div>
  {:else}
    <header class="flex shrink-0 items-start justify-between gap-4 border-b border-base-300 bg-base-200 px-4 py-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="m-0 text-sm font-semibold text-base-content">Review agent</h3>
          <Badge variant={status.status === 'failed' || status.status === 'interrupted' ? 'error' : 'neutral'}>
            {stateLabel(status)}
          </Badge>
        </div>
        <p class="mt-1 mb-0 text-xs text-base-content/70" aria-live="polite">{stateMessage(status)}</p>
        {#if status.queueReason}
          <p class="mt-1 mb-0 text-xs text-base-content/60">{status.queueReason}</p>
        {/if}
        {#if generationMessage()}
          <p class="mt-1 mb-0 text-xs text-base-content/80" role="status" aria-live="polite" aria-atomic="true">
            {generationMessage()}
          </p>
        {/if}
      </div>
      {#if isActive(status)}
        <Button variant="ghost" size="sm" disabled={actionPending} onclick={() => { void onAbort().catch(() => undefined) }}>
          {walkthroughStatus === 'generating' ? 'Stop generation' : 'Stop review agent'}
        </Button>
      {:else if canRestart(status)}
        <Button size="sm" disabled={actionPending} onclick={() => { void onRestart().catch(() => undefined) }}>
          Generate again
        </Button>
      {/if}
    </header>

    <div class="min-h-0 flex-1 bg-base-300" bind:this={terminalElement} data-testid="review-agent-terminal"></div>

    {#if terminalError}
      <p class="m-0 border-t border-base-300 px-4 py-2 text-sm text-error" role="alert">{terminalError}</p>
    {/if}
    {#if error}
      <p class="m-0 border-t border-base-300 px-4 py-2 text-sm text-error" role="alert">{error}</p>
    {/if}

    {#if status.acceptsInput}
      <form
        class="flex shrink-0 items-end gap-3 border-t border-base-300 bg-base-200 p-3"
        onsubmit={(event) => { event.preventDefault(); void sendMessage() }}
      >
        <div class="min-w-0 flex-1">
          <Textarea
            label="Message the review agent"
            hideLabel
            rows={2}
            placeholder="Ask a follow-up question"
            bind:value={message}
            error={sendError}
            disabled={actionPending}
          />
        </div>
        <Button type="submit" size="sm" disabled={actionPending || message.trim().length === 0}>Send</Button>
      </form>
    {/if}
  {/if}
</section>
