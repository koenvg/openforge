<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions, tasks } from '../../lib/stores'
  import { listenToAgentStatusChanged, getAgentPanelStatusFromSessionStatus, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { writeAgentTerminalTranscription } from '../../lib/agentTerminalPanel'
  import { deriveAgentStatusPillView } from '../../lib/agentStatusPill'
  import VoiceInput from '../shared/adapters/VoiceInput.svelte'
  import InjectionPointSlot from '../plugin/InjectionPointSlot.svelte'

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

  let injectableProjectId = $derived($tasks.find((t) => t.id === taskId)?.projectId ?? null)
</script>

<InjectionPointSlot
  location="agentSession"
  projectId={injectableProjectId}
  taskId={taskId}
  onInsert={(text) => { void writeAgentTerminalTranscription(taskId, text, 'InjectionPoint') }}
/>
{#if view}
  <div class="flex shrink-0 items-center gap-2" data-testid="agent-status-pill" aria-label="Agent status">
    {#if view.statusText !== null}
      <span class="shrink-0 {dotClass(status)}"></span>
      <span class="of-toolbar-compact-label whitespace-nowrap text-xs font-semibold text-base-content">{view.statusText}</span>
    {/if}
    {#if view.checkpointActive}
      <span class="of-toolbar-compact-label badge badge-sm badge-warning shrink-0" aria-label="Checkpoint question pending">! checkpoint</span>
    {/if}
    <VoiceInput onTranscription={handleTranscription} listenToHotkey showShortcut={false} />
  </div>
{/if}
