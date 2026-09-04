<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import type { DesktopUnlistenFn } from '../../lib/desktopIpc'
  import { activeSessions, tasks } from '../../lib/stores'
  import { listenToAgentStatusChanged, getAgentPanelStatusFromSessionStatus, type AgentPanelStatus } from '../../lib/agentPanelSessionSync'
  import { writeAgentTerminalTranscription } from '../../lib/agentTerminalPanel'
  import { deriveAgentStatusPillView } from '../../lib/agentStatusPill'
  import VoiceInput from '../shared/adapters/VoiceInput.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
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
  <div class="agent-status-pill" data-testid="agent-status-pill" aria-label="Agent status">
    {#if view.statusText !== null}
      <span class="agent-status-dot" data-status={status}></span>
      <span class="of-toolbar-compact-label agent-status-label">{view.statusText}</span>
    {/if}
    {#if view.checkpointActive}
      <Badge class="of-toolbar-compact-label" variant="warning" aria-label="Checkpoint question pending">! checkpoint</Badge>
    {/if}
    <VoiceInput onTranscription={handleTranscription} listenToHotkey showShortcut={false} />
  </div>
{/if}

<style>
  .agent-status-pill {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    gap: var(--of-space2);
  }

  .agent-status-dot {
    width: var(--of-space3);
    height: var(--of-space3);
    flex-shrink: 0;
    border-radius: var(--of-radius-round);
    background: var(--of-status-neutral);
  }

  .agent-status-dot[data-status='running'] {
    background: var(--of-status-running);
  }

  .agent-status-dot[data-status='paused'] {
    background: var(--of-status-waiting);
  }

  .agent-status-dot[data-status='complete'] {
    background: var(--of-status-success);
  }

  .agent-status-dot[data-status='error'] {
    background: var(--of-status-danger);
  }

  .agent-status-label {
    color: var(--of-text);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-semibold);
    white-space: nowrap;
  }
</style>
