<script lang="ts">
  import { onDestroy } from 'svelte'
  import type { Disposable, ScopedAgentSessionState, SessionScope } from '@openforge-app/plugin-sdk'

  interface Props {
    scope: SessionScope | null
    projectResolved: boolean
    projectId: string | null
    status: ScopedAgentSessionState | null
    isLoading: boolean
    error: string | null
    availabilityError: string | null
    mountTerminal: (scope: SessionScope, element: HTMLElement) => Promise<Disposable>
    onTerminalReadyChange?: (ready: boolean) => void
  }

  let {
    scope,
    projectResolved,
    projectId,
    status,
    isLoading,
    error,
    availabilityError,
    mountTerminal,
    onTerminalReadyChange = () => undefined,
  }: Props = $props()

  let terminalElement = $state<HTMLElement>()
  let terminalError = $state<string | null>(null)
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
    onTerminalReadyChange(false)
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
        onTerminalReadyChange(true)
      } catch (cause) {
        if (!destroyed && sameTarget(requested, target)) {
          requested = null
          onTerminalReadyChange(false)
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
    onTerminalReadyChange(false)
    reconciliation = reconciliation.then(async () => {
      const current = attached
      attached = null
      await current?.disposable.dispose()
    }).catch(() => undefined)
  })

  let passiveMessage = $derived.by(() => {
    if (availabilityError) return availabilityError
    if (terminalError) return terminalError
    if (error) return error
    if (!projectResolved || isLoading) return 'Starting review agent…'
    if (projectId === null) return 'A local OpenForge Project linked to this repository is required to start the review agent.'
    if (status === null) return 'Starting review agent…'
    if (status.status === 'queued') return status.queueReason ?? 'Waiting for an available agent slot…'
    if (status.status === 'starting') return 'Starting review agent…'
    return null
  })
</script>

<section class="flex h-full min-h-0 flex-col bg-of-surface-subtle/50 p-3" aria-label="Pull request review agent">
  <div
    class="agent-terminal-surface relative min-h-0 flex-1 overflow-hidden rounded-[var(--of-radius-container)] border"
    style="background: var(--of-agent-terminal-bg); border-color: var(--of-agent-terminal-border)"
    data-testid="review-agent-terminal-frame"
  >
    <div
      class="shell-terminal-wrapper h-full w-full p-3"
      bind:this={terminalElement}
      data-testid="review-agent-terminal"
    ></div>
    {#if passiveMessage}
      <div
        class="absolute inset-0 flex items-center justify-center bg-[var(--of-agent-terminal-bg)] px-6 text-center font-mono text-sm text-of-text/70"
        role={availabilityError || terminalError || error ? 'alert' : 'status'}
      >
        {passiveMessage}
      </div>
    {/if}
  </div>
</section>
