<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions } from '../../lib/stores'
  import '@openforge-app/terminal-runtime/xterm.css'
  import { listenToAgentStatusChanged } from '../../lib/agentPanelSessionSync'
  import type { TerminalSession, TerminalViewAttachment } from '@openforge-app/terminal-runtime'
  import { agentTerminalSessions } from '../../lib/terminalSessionService'
  import { hydrateAgentTerminalPtyInstance } from '../../lib/agentTerminalPanel'
  import { parseCheckpointQuestion } from '../../lib/parseCheckpoint'

  type ProviderSessionIdKey = 'opencode_session_id' | 'claude_session_id' | 'pi_session_id' | 'grok_session_id'

  interface Props {
    taskId: string
    sessionIdKey: ProviderSessionIdKey | null
    isStarting?: boolean
    isActive?: boolean
    rootTestId?: string | null
  }

  let {
    taskId,
    sessionIdKey,
    isStarting = false,
    isActive = false,
    rootTestId = null,
  }: Props = $props()

  let terminalEl: HTMLDivElement
  let unlisteners: DesktopUnlistenFn[] = []
  let poolEntry: TerminalSession | null = null
  let viewAttachment: TerminalViewAttachment | null = null
  let poolEntryAttached = $state(false)
  let terminalActive = $state(false)
  let destroyed = false

  let session = $derived($activeSessions.get(taskId) || null)
  let checkpointQuestion = $derived(
    sessionIdKey === 'opencode_session_id' && session?.status === 'paused'
      ? parseCheckpointQuestion(session.checkpoint_data)
      : null
  )

  function syncTerminalActiveFromLifecycle() {
    terminalActive = agentTerminalSessions.getShellLifecycleState(taskId).ptyActive
  }

  $effect(() => {
    if (
      (session?.status === 'running' || session?.status === 'paused')
      && typeof session.pty_instance_id === 'number'
    ) {
      hydrateAgentTerminalPtyInstance(taskId, session.pty_instance_id)
    }
    syncTerminalActiveFromLifecycle()
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
        void viewAttachment?.refit()
      })
    })
  })

  $effect(() => {
    if (!isActive || !poolEntryAttached) return

    const activeEntry = poolEntry
    if (!activeEntry) return
    const recoveryController = new AbortController()
    const frame = requestAnimationFrame(() => {
      if (isActive && poolEntryAttached && poolEntry === activeEntry) {
        void viewAttachment?.refit(recoveryController.signal)
      }
    })

    return () => {
      cancelAnimationFrame(frame)
      recoveryController.abort()
    }
  })

  onMount(async () => {
    poolEntry = await agentTerminalSessions.acquire(taskId)
    if (destroyed || !poolEntry) return
    viewAttachment = await agentTerminalSessions.attach(poolEntry, terminalEl)
    if (destroyed) {
      viewAttachment.detach()
      viewAttachment = null
      return
    }
    poolEntryAttached = true

    syncTerminalActiveFromLifecycle()

    unlisteners.push(await listenToAgentStatusChanged({
      taskId,
      onRunning: syncTerminalActiveFromLifecycle,
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
    viewAttachment?.detach()
    viewAttachment = null
  })
</script>

<div class="flex flex-col gap-3 h-full" data-testid={rootTestId}>
  {#if checkpointQuestion}
    <div class="flex items-start gap-3 px-5 py-3 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{checkpointQuestion}</span>
    </div>
  {/if}

  <div class="agent-terminal-surface relative min-h-0 flex-1 overflow-hidden rounded-md border" style="background: var(--of-agent-terminal-bg); border-color: var(--of-agent-terminal-border)">
    <div class="shell-terminal-wrapper w-full h-full p-3" bind:this={terminalEl}></div>
    {#if !session && !terminalActive}
      <div class="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-4 p-16 pointer-events-none" style="background: var(--of-agent-terminal-bg); color: var(--of-agent-terminal-text)">
        {#if isStarting}
          <span class="loading loading-spinner loading-lg text-primary"></span>
          <div class="text-base font-semibold" style="animation: badge-pulse 2s ease-in-out infinite;">Starting agent session...</div>
          <div class="max-w-[320px] text-center text-sm leading-relaxed" style="color: var(--of-agent-terminal-muted)">Preparing workspace and launching agent</div>
        {:else}
          <svg class="h-16 w-16 opacity-40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <div class="text-base font-semibold">No active agent session</div>
          <div class="max-w-[320px] text-center text-sm leading-relaxed" style="color: var(--of-agent-terminal-muted)">Use the action buttons in the header to get started</div>
        {/if}
      </div>
    {/if}
  </div>
</div>
