<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions } from '../../lib/stores'
  import '@openforge-app/terminal-runtime/xterm.css'
  import { listenToAgentStatusChanged } from '../../lib/agentPanelSessionSync'
  import { acquire, attach, detach, isValidTerminalDimensions, type PoolEntry } from '../../lib/terminalPool'
  import {
    hydrateAgentTerminalPtyInstance,
    syncAgentPanelStatusFromSession,
  } from '../../lib/agentTerminalPanel'
  import { parseCheckpointQuestion } from '../../lib/parseCheckpoint'

  type ProviderSessionIdKey = 'opencode_session_id' | 'claude_session_id' | 'pi_session_id' | 'grok_session_id'

  interface Props {
    taskId: string
    sessionIdKey: ProviderSessionIdKey | null
    isStarting?: boolean
    rootTestId?: string | null
  }

  let {
    taskId,
    sessionIdKey,
    isStarting = false,
    rootTestId = null,
  }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: DesktopUnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let poolEntryAttached = $state(false)
  let terminalActive = $state(false)
  let destroyed = false

  let session = $derived($activeSessions.get(taskId) || null)
  let checkpointQuestion = $derived(
    sessionIdKey === 'opencode_session_id' && session?.status === 'paused'
      ? parseCheckpointQuestion(session.checkpoint_data)
      : null
  )

  // The live status no longer renders here (it lives in AgentStatusPill), but the
  // session/status sync still drives terminalActive + PTY hydration, so we keep
  // running it with a no-op status setter.
  function syncStatusFromSession(sessionStatus: string | null | undefined) {
    syncAgentPanelStatusFromSession({
      taskId,
      sessionStatus,
      setStatus: () => {},
      setTerminalActive: (active) => { terminalActive = active },
    })
  }

  $effect(() => {
    syncStatusFromSession(session?.status)
  })

  let previousCheckpointQuestion: string | null = null

  $effect(() => {
    const nextCheckpointQuestion = checkpointQuestion
    const entryReady = poolEntryAttached
    const shouldRefitForCheckpointLayout = sessionIdKey === 'opencode_session_id' && entryReady && poolEntry && (
      nextCheckpointQuestion !== null || previousCheckpointQuestion !== null
    )

    previousCheckpointQuestion = nextCheckpointQuestion

    if (!shouldRefitForCheckpointLayout) return

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!poolEntry) return
        const proposed = poolEntry.fitAddon.proposeDimensions()
        if (isValidTerminalDimensions(proposed)) {
          poolEntry.fitAddon.fit()
        }
      })
    })
  })

  onMount(async () => {
    poolEntry = await acquire(taskId)
    if (destroyed || !poolEntry) return
    await attach(poolEntry, terminalEl)
    if (destroyed) return
    poolEntryAttached = true

    syncStatusFromSession(session?.status)

    unlisteners.push(await listenToAgentStatusChanged({
      taskId,
      setStatus: () => {},
      onRunning: () => { syncStatusFromSession('running') },
      onPtyInstanceId: (ptyInstanceId) => {
        hydrateAgentTerminalPtyInstance(taskId, ptyInstanceId)
        terminalActive = true
      },
    }))
  })

  onDestroy(() => {
    destroyed = true
    unlisteners.forEach((fn) => {
      fn()
    })
    poolEntryAttached = false
    if (poolEntry) {
      detach(poolEntry)
    }
  })
</script>

<div class="flex flex-col gap-3 h-full" data-testid={rootTestId}>
  {#if checkpointQuestion}
    <div class="flex items-start gap-3 px-5 py-3 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{checkpointQuestion}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-hidden min-h-0 bg-base-100 border border-base-300 rounded-md relative">
    <div class="shell-terminal-wrapper w-full h-full p-3" bind:this={terminalEl}></div>
    {#if !session && !terminalActive}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        {#if isStarting}
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <div class="text-base font-semibold text-base-content" style="animation: badge-pulse 2s ease-in-out infinite;">Starting agent session...</div>
          <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Preparing workspace and launching agent</div>
        {:else}
          <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="text-base font-semibold text-base-content">No active agent session</div>
          <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Use the action buttons in the header to get started</div>
        {/if}
      </div>
    {/if}
  </div>
</div>
