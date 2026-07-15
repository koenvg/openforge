<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions, tasks } from '../../lib/stores'
  import { listenToAgentStatusChanged, getAgentPanelStatusFromSessionStatus, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { writeAgentTerminalTranscription } from '../../lib/agentTerminalPanel'
  import { deriveAgentStatusPillView } from '../../lib/agentStatusPill'
  import { pickerState } from '../../lib/injectables/pickerState.svelte'
  import VoiceInput from '../shared/adapters/VoiceInput.svelte'

  interface Props {
    taskId: string
  }

  let { taskId }: Props = $props()

  let session = $derived($activeSessions.get(taskId) || null)
  let status = $state<AgentPanelStatus>('idle')
  let unlisten: DesktopUnlistenFn | null = null

  // Mirror the session store into the live AgentPanelStatus; the listener layers
  // transient running/permission transitions on top, matching AgentTerminalShell.
  $effect(() => {
    status = getAgentPanelStatusFromSessionStatus(session?.status)
  })

  onMount(async () => {
    unlisten = await listenToAgentStatusChanged({
      taskId,
      setStatus: (next) => { status = next },
    })
  })

  onDestroy(() => {
    unlisten?.()
  })

  let view = $derived(deriveAgentStatusPillView(session, status))

  function dotClass(current: AgentPanelStatus): string {
    if (current === 'running') return 'status status-success'
    if (current === 'paused') return 'status status-warning'
    if (current === 'complete') return 'status status-primary'
    if (current === 'error') return 'status status-error'
    return 'status status-neutral'
  }

  function handleTranscription(text: string) {
    void writeAgentTerminalTranscription(taskId, text, 'AgentStatusPill')
  }

  // Live-terminal entry point for the injectable picker (⌘⇧I). Inserts the picked
  // skill/command/snippet text into the agent terminal — no auto-Enter — reusing
  // the same transcription-write path as VoiceInput above.
  let injectableProjectId = $derived($tasks.find((t) => t.id === taskId)?.project_id ?? null)

  function openInjectables() {
    pickerState.openPicker({
      projectId: injectableProjectId,
      onInsert: (text) => { void writeAgentTerminalTranscription(taskId, text, 'AgentStatusPill') },
    })
  }
</script>

{#if view}
  <div class="flex items-center gap-2 min-w-0" data-testid="agent-status-pill" aria-label="Agent status">
    <span class="shrink-0 {dotClass(status)}"></span>
    <span class="text-xs font-semibold text-base-content truncate">{view.statusText}</span>
    {#if view.checkpointActive}
      <span class="badge badge-sm badge-warning shrink-0" aria-label="Checkpoint question pending">! checkpoint</span>
    {/if}
    <button
      type="button"
      class="btn btn-ghost btn-xs gap-1 shrink-0"
      aria-label="Open injectables"
      title="Insert a skill, command, or snippet (⌘⇧I)"
      onclick={openInjectables}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3z"/></svg>
    </button>
    <VoiceInput onTranscription={handleTranscription} listenToHotkey />
  </div>
{/if}
