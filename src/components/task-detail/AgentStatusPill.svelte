<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions } from '../../lib/stores'
  import { listenToAgentStatusChanged, getAgentPanelStatusFromSessionStatus, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { getAgentSessionStatusBadgeClass, writeAgentTerminalTranscription } from '../../lib/agentTerminalPanel'
  import { deriveAgentStatusPillView, getAgentProviderConfig } from '../../lib/agentStatusPill'
  import VoiceInput from '../shared/input/VoiceInput.svelte'

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
  let badgeVariant = $derived(getAgentProviderConfig(session?.provider ?? null).uppercaseSessionStatus ? 'soft' : 'badge')

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
</script>

{#if view}
  <div class="flex items-center gap-2 min-w-0" data-testid="agent-status-pill" aria-label="Agent status">
    <span class="shrink-0 {dotClass(status)}"></span>
    <span class="text-xs font-semibold text-base-content truncate">{view.statusText}</span>
    <span class="text-[0.7rem] font-mono text-secondary shrink-0">{view.stageLabel}</span>
    <span class="badge badge-sm font-bold shrink-0 {getAgentSessionStatusBadgeClass(view.sessionStatus, badgeVariant)}">{view.sessionStatusLabel}</span>
    {#if view.checkpointActive}
      <span class="badge badge-sm badge-warning shrink-0" aria-label="Checkpoint question pending">! checkpoint</span>
    {/if}
    {#if view.resumeCommand}
      <code class="text-[0.65rem] font-mono text-secondary whitespace-nowrap select-all truncate max-w-[12rem]" title={view.resumeCommand}>{view.resumeCommand}</code>
    {/if}
    <VoiceInput onTranscription={handleTranscription} listenToHotkey />
  </div>
{/if}
