<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import type { AgentEvent } from '../lib/types'
  import { activeSessions } from '../lib/stores'
  import { abortImplementation, getLatestSession, getAgentLogs } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { parseCheckpointQuestion } from '../lib/parseCheckpoint'
  import VoiceInput from './VoiceInput.svelte'
  import { createTerminal } from '../lib/useTerminal.svelte'
  import { formatClaudeEvent } from '../lib/formatClaudeEvent'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let status = $state<'idle' | 'running' | 'complete' | 'error'>('idle')
  let errorMessage = $state<string | null>(null)
  let loadingHistory = $state(false)
  let unlisteners: UnlistenFn[] = []
  let lastReplayedTimestamp = 0
  let terminalEl: HTMLDivElement

  const termHandle = createTerminal({
    onData: () => {},
    onResize: () => {},
  })

  let session = $derived($activeSessions.get(taskId) || null)
  let questionText = $derived(session ? parseCheckpointQuestion(session.checkpoint_data) : null)

  $effect(() => {
    if (questionText !== undefined) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => termHandle.safeFit())
      })
    }
  })

  async function loadAndReplayHistory(): Promise<void> {
    loadingHistory = true
    try {
      let existingSession = $activeSessions.get(taskId) ?? null

      if (!existingSession) {
        const dbSession = await getLatestSession(taskId)
        if (dbSession && ['completed', 'failed', 'paused', 'interrupted'].includes(dbSession.status)) {
          const updated = new Map($activeSessions)
          updated.set(taskId, dbSession)
          $activeSessions = updated
          existingSession = dbSession
        }
      }

      if (!existingSession) return

      // Load and replay stored events
      try {
        const logs = await getAgentLogs(existingSession.id)
        for (const log of logs) {
          const formatted = formatClaudeEvent(log.log_type, log.content)
          if (formatted) {
            termHandle.terminal?.write(formatted)
          }
        }
        const lastLog = logs[logs.length - 1]
        if (lastLog) {
          lastReplayedTimestamp = lastLog.timestamp
        }
      } catch (e) {
        console.error('[ClaudeAgentPanel] Failed to load agent logs:', e)
      }

      // Set status based on existing session
      if (existingSession.status === 'running') {
        status = 'running'
      } else if (existingSession.status === 'completed') {
        status = 'complete'
      } else if (existingSession.status === 'failed' || existingSession.status === 'interrupted') {
        status = 'error'
        errorMessage = existingSession.error_message
      }
    } catch (e) {
      console.error('[ClaudeAgentPanel] Failed to load session history:', e)
    } finally {
      loadingHistory = false
    }
  }

  onMount(async () => {
    termHandle.terminalEl = terminalEl
    await termHandle.mount()

    await loadAndReplayHistory()

    // Listen for live Claude events
    unlisteners.push(await listen<AgentEvent>('agent-event', (event) => {
      if (event.payload.task_id !== taskId) return

      const eventType = event.payload.event_type
      const data = event.payload.data

      // Handle status changes
      if (eventType === 'session.idle') {
        status = 'complete'
      } else if (eventType === 'session.status') {
        try {
          const parsed = JSON.parse(data)
          const statusType = parsed.properties?.status?.type
          if (statusType === 'idle') {
            status = 'complete'
          } else if (statusType === 'busy' || statusType === 'retry') {
            status = 'running'
          }
        } catch { /* ignore parse errors */ }
      } else if (eventType === 'session.error') {
        status = 'error'
        errorMessage = data
      }

      // Skip events already replayed from stored logs (dedup at seam)
      if (lastReplayedTimestamp > 0 && event.payload.timestamp && event.payload.timestamp <= lastReplayedTimestamp + 2) {
        return
      }

      // Render Claude events directly to terminal
      const formatted = formatClaudeEvent(eventType, data)
      if (formatted) {
        termHandle.terminal?.write(formatted)
      }
    }))

    // Listen for action-complete
    unlisteners.push(await listen<{ task_id: string }>('action-complete', (event) => {
      if (event.payload.task_id !== taskId) return
      status = 'complete'
    }))
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
    termHandle.dispose()
  })

  async function handleAbort() {
    try {
      await abortImplementation(taskId)
      status = 'error'
      errorMessage = 'Implementation aborted by user'
    } catch (e) {
      console.error('[ClaudeAgentPanel] Failed to abort implementation:', e)
    }
  }

  function handleTranscription(_text: string) {
    // Claude panels don't support PTY input — voice transcription is a no-op
    // TODO: Could write to Claude's stdin if we expose that capability
  }

  function getStatusText(): string {
    switch (status) {
      case 'idle': return 'No active implementation'
      case 'running': return 'Agent running...'
      case 'complete': return 'Implementation complete'
      case 'error': return 'Error occurred'
      default: return ''
    }
  }

  function getStageLabel(stage: string): string {
    const stageMap: Record<string, string> = {
      'read_ticket': 'Reading Ticket',
      'implement': 'Implementing',
      'create_pr': 'Creating PR',
      'address_comments': 'Addressing Comments'
    }
    return stageMap[stage] || stage
  }

  function getSessionStatusBadgeClass(sessionStatus: string): string {
    switch (sessionStatus) {
      case 'running': return 'badge-success'
      case 'completed': return 'badge-primary'
      case 'failed': return 'badge-error'
      case 'interrupted': return 'badge-ghost'
      case 'paused': return 'badge-warning'
      default: return 'badge-ghost'
    }
  }
</script>

<div class="flex flex-col gap-3 h-full">
  <div class="flex items-center justify-between px-5 py-3.5 bg-base-200 border border-base-300 rounded-md">
    <div class="flex items-start gap-2.5">
      <span class="mt-1.5 shrink-0 {status === 'idle' ? 'status status-neutral' : status === 'running' ? 'status status-success' : status === 'complete' ? 'status status-primary' : 'status status-error'}"></span>
      <div class="flex flex-col gap-1.5">
        <span class="text-sm font-semibold text-base-content">{getStatusText()}</span>
        {#if session}
          <div class="flex items-center gap-2">
            <span class="text-xs font-medium text-base-content/50 tracking-wide">{getStageLabel(session.stage)}</span>
            <span class="badge badge-sm {getSessionStatusBadgeClass(session.status)}">
              {session.status}
            </span>
            {#if session.claude_session_id}
              <span class="text-[0.6875rem] font-mono text-base-content/50 max-w-[180px] truncate" title={session.claude_session_id}>
                {session.claude_session_id}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    </div>
    <div class="flex items-center gap-3">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      {#if status === 'running'}
        <button class="btn btn-error btn-sm uppercase tracking-wide shadow-sm hover:shadow-md transition-shadow" onclick={handleAbort}>
          Abort
        </button>
      {/if}
    </div>
  </div>

  {#if questionText}
    <div class="flex items-start gap-3 px-5 py-3 bg-warning/10 border border-warning/30 rounded-md">
      <span class="flex items-center justify-center w-5 h-5 rounded-full bg-warning/20 text-warning text-xs font-bold shrink-0 mt-0.5">?</span>
      <span class="text-[0.8125rem] text-base-content leading-relaxed line-clamp-3">{questionText}</span>
    </div>
  {/if}

  <div class="flex-1 overflow-hidden min-h-0 bg-base-100 border border-base-300 rounded-md relative">
    <div class="terminal-wrapper" bind:this={terminalEl}></div>
    {#if loadingHistory}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <div class="text-base font-semibold text-base-content">Loading session output...</div>
      </div>
    {:else if !session && status === 'idle'}
      <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
        <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
       </svg>
         <div class="text-base font-semibold text-base-content">No active agent session</div>
         <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">Use the action buttons in the header to get started</div>
       </div>
    {/if}
  </div>
</div>

<style>
  .terminal-wrapper {
    width: 100%;
    height: 100%;
    padding: 12px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar) {
    width: 6px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-track) {
    background: var(--color-base-200);
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb) {
    background: var(--color-base-300);
    border-radius: 3px;
  }

  :global(.terminal-wrapper .xterm-viewport::-webkit-scrollbar-thumb:hover) {
    background: color-mix(in oklch, var(--color-base-content) 40%, transparent);
  }
</style>
