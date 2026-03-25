<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { activeProjectId, shepherdStatus, actionItemCount, selectedTaskId, currentView } from '../lib/stores'
  import { writePty, getActionItems, dismissActionItem, getActionItemCount } from '../lib/ipc'
  import '@xterm/xterm/css/xterm.css'
  import { acquire, attach, detach, isPtyActive, type PoolEntry } from '../lib/terminalPool'
  import VoiceInput from './VoiceInput.svelte'
  import ActionItemPanel from './ActionItemPanel.svelte'
  import type { ShepherdStatus, ActionItem } from '../lib/types'
  import { PanelRight } from 'lucide-svelte'

  let terminalEl: HTMLDivElement
  let unlisteners: UnlistenFn[] = []
  let poolEntry: PoolEntry | null = null
  let terminalActive = $state(false)
  let actionItems = $state<ActionItem[]>([])
  let panelOpen = $state(true)

  let status = $derived($shepherdStatus)

  let taskId = $derived($activeProjectId ? `shepherd-${$activeProjectId}` : null)

  function getStatusText(s: ShepherdStatus): string {
    switch (s) {
      case 'idle': return 'Shepherd running'
      case 'thinking': return 'Shepherd thinking...'
      case 'disabled': return 'Shepherd disabled'
      case 'error': return 'Shepherd error'
      default: return ''
    }
  }

  function getStatusClass(s: ShepherdStatus): string {
    switch (s) {
      case 'idle': return 'status status-success'
      case 'thinking': return 'status status-warning'
      case 'disabled': return 'status status-neutral'
      case 'error': return 'status status-error'
      default: return 'status status-neutral'
    }
  }

  async function loadActionItems() {
    if (!$activeProjectId) return
    try {
      actionItems = await getActionItems($activeProjectId, 50)
    } catch (e) {
      console.error('[ShepherdView] Failed to load action items:', e)
    }
  }

  async function handleDismiss(id: number) {
    try {
      await dismissActionItem(id)
      await loadActionItems()
      if ($activeProjectId) {
        $actionItemCount = await getActionItemCount($activeProjectId)
      }
    } catch (e) {
      console.error('[ShepherdView] Failed to dismiss action item:', e)
    }
  }

  function handleNavigateToTask(taskId: string) {
    $selectedTaskId = taskId
    $currentView = 'board'
  }

  onMount(async () => {
    if (!taskId) return

    try {
      poolEntry = await acquire(taskId)
      attach(poolEntry, terminalEl)
      terminalActive = isPtyActive(taskId)

      unlisteners.push(await listen<{ data?: string }>(`pty-output-${taskId}`, () => {
        terminalActive = isPtyActive(taskId)
      }))
      unlisteners.push(await listen(`pty-exit-${taskId}`, () => {
        terminalActive = isPtyActive(taskId)
      }))
    } catch (e) {
      console.error('[ShepherdView] Failed to initialize terminal:', e)
    }

    await loadActionItems()

    unlisteners.push(await listen('action-item-created', () => {
      loadActionItems()
    }))
    unlisteners.push(await listen('action-item-dismissed', () => {
      loadActionItems()
    }))
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
    if (poolEntry) {
      detach(poolEntry)
    }
  })

  function handleTranscription(text: string) {
    if (taskId && isPtyActive(taskId)) {
      writePty(taskId, text).catch(e => console.error('[ShepherdView] transcription write failed:', e))
    }
  }
</script>

<div class="flex flex-col h-full">
  <div class="flex items-center justify-between px-5 py-3.5 bg-base-200 border-b border-base-300 shrink-0">
    <div class="flex items-center gap-2.5">
      <span class="mt-0.5 shrink-0 {getStatusClass(status)}"></span>
      <span class="text-sm font-semibold text-base-content font-mono">{getStatusText(status)}</span>
      <span class="badge badge-sm badge-ghost font-mono text-[0.65rem]">
        {$activeProjectId ? `shepherd-${$activeProjectId.slice(0, 8)}` : ''}
      </span>
    </div>
    <div class="flex items-center gap-3">
      <VoiceInput onTranscription={handleTranscription} listenToHotkey />
      <kbd class="kbd kbd-sm text-base-content/40">⌘A</kbd>
      <button
        class="btn btn-ghost btn-xs {panelOpen ? 'text-primary' : 'text-base-content/40'}"
        onclick={() => { panelOpen = !panelOpen }}
        title={panelOpen ? 'Hide action items' : 'Show action items'}
      >
        <PanelRight size={16} />
      </button>
    </div>
  </div>

  <div class="flex flex-row flex-1 overflow-hidden min-h-0">
    <div class="flex-1 overflow-hidden min-h-0 relative">
      <div class="terminal-wrapper" bind:this={terminalEl}></div>
      {#if !terminalActive}
        <div class="absolute inset-0 flex flex-col items-center justify-center p-16 gap-4 bg-base-100 z-[1] pointer-events-none">
          {#if status === 'disabled'}
            <svg class="w-16 h-16 text-base-content/40" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="2"/>
              <path d="M8 14s1.5 2 4 2 4-2 4-2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <circle cx="9" cy="9" r="1.5" fill="currentColor"/>
              <circle cx="15" cy="9" r="1.5" fill="currentColor"/>
            </svg>
            <div class="text-base font-semibold text-base-content">Shepherd is disabled</div>
            <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">
              Enable the Task Shepherd experiment in project settings to get started.
            </div>
          {:else}
            <span class="loading loading-spinner loading-lg text-primary"></span>
            <div class="text-base font-semibold text-base-content">Waiting for shepherd session...</div>
            <div class="text-sm text-base-content/50 text-center max-w-[320px] leading-relaxed">
              The shepherd agent will appear here once it starts.
            </div>
          {/if}
        </div>
      {/if}
    </div>
    {#if panelOpen}
      <div class="w-72 border-l border-base-300 flex flex-col h-full bg-base-100">
        <ActionItemPanel items={actionItems} onDismiss={handleDismiss} onNavigateToTask={handleNavigateToTask} />
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
