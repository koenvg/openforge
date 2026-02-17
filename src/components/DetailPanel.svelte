<script lang="ts">
  import type { Ticket, PrComment } from '../lib/types'
  import { activeSessions } from '../lib/stores'
  import { abortSession } from '../lib/ipc'
  import LogViewer from './LogViewer.svelte'
  import CheckpointPanel from './CheckpointPanel.svelte'
  import PrCommentsPanel from './PrCommentsPanel.svelte'
  import { createEventDispatcher } from 'svelte'

  export let ticket: Ticket
  export let comments: PrComment[] = []

  const dispatch = createEventDispatcher()

  let activeTab: 'overview' | 'logs' | 'checkpoints' | 'comments' = 'overview'

  $: session = $activeSessions.get(ticket.id) || null

  function close() {
    dispatch('close')
  }

  async function handleAbort() {
    if (!session) return
    try {
      await abortSession(session.id)
    } catch (e) {
      console.error('Failed to abort session:', e)
    }
  }

  function formatDate(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleDateString()
  }
</script>

<div class="detail-panel">
  <div class="panel-header">
    <div class="header-info">
      <span class="ticket-id">{ticket.id}</span>
      <h2 class="ticket-title">{ticket.title}</h2>
    </div>
    <button class="close-btn" on:click={close}>X</button>
  </div>

  <div class="tabs">
    <button class="tab" class:active={activeTab === 'overview'} on:click={() => activeTab = 'overview'}>Overview</button>
    <button class="tab" class:active={activeTab === 'logs'} on:click={() => activeTab = 'logs'}>Agent Logs</button>
    <button class="tab" class:active={activeTab === 'checkpoints'} on:click={() => activeTab = 'checkpoints'}>Checkpoints</button>
    <button class="tab" class:active={activeTab === 'comments'} on:click={() => activeTab = 'comments'}>
      PR Comments
      {#if comments.filter(c => c.addressed === 0).length > 0}
        <span class="badge">{comments.filter(c => c.addressed === 0).length}</span>
      {/if}
    </button>
  </div>

  <div class="tab-content">
    {#if activeTab === 'overview'}
      <div class="overview">
        <div class="field">
          <span class="label">Status</span>
          <span class="value">{ticket.jira_status || ticket.status}</span>
        </div>
        {#if ticket.assignee}
          <div class="field">
            <span class="label">Assignee</span>
            <span class="value">{ticket.assignee}</span>
          </div>
        {/if}
        <div class="field">
          <span class="label">Updated</span>
          <span class="value">{formatDate(ticket.updated_at)}</span>
        </div>
        {#if ticket.description}
          <div class="field">
            <span class="label">Description</span>
            <pre class="description">{ticket.description}</pre>
          </div>
        {/if}
        {#if session}
          <div class="field">
            <span class="label">Agent</span>
            <span class="value">{session.stage} - {session.status}</span>
          </div>
          {#if session.status === 'running' || session.status === 'paused'}
            <button class="btn btn-abort" on:click={handleAbort}>Abort Session</button>
          {/if}
        {/if}
      </div>
    {:else if activeTab === 'logs'}
      {#if session}
        <LogViewer sessionId={session.id} />
      {:else}
        <div class="empty">No active session</div>
      {/if}
    {:else if activeTab === 'checkpoints'}
      {#if session}
        <div class="checkpoint-container">
          <CheckpointPanel {session} />
        </div>
      {:else}
        <div class="empty">No active session</div>
      {/if}
    {:else if activeTab === 'comments'}
      <PrCommentsPanel ticketId={ticket.id} {comments} />
    {/if}
  </div>
</div>

<style>
  .detail-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border);
  }

  .panel-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    padding: 14px 16px;
    border-bottom: 1px solid var(--border);
  }

  .header-info {
    flex: 1;
    min-width: 0;
  }

  .ticket-id {
    font-size: 0.7rem;
    font-weight: 600;
    color: var(--accent);
  }

  .ticket-title {
    font-size: 0.9rem;
    margin: 4px 0 0;
    color: var(--text-primary);
    font-weight: 500;
  }

  .close-btn {
    all: unset;
    cursor: pointer;
    color: var(--text-secondary);
    font-size: 0.8rem;
    padding: 4px 8px;
    border-radius: 4px;
  }

  .close-btn:hover {
    background: var(--bg-card);
    color: var(--text-primary);
  }

  .tabs {
    display: flex;
    border-bottom: 1px solid var(--border);
    padding: 0 16px;
  }

  .tab {
    all: unset;
    padding: 10px 14px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .tab:hover {
    color: var(--text-primary);
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .badge {
    background: var(--error);
    color: white;
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 8px;
  }

  .tab-content {
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .overview {
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .label {
    font-size: 0.7rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .value {
    font-size: 0.8rem;
    color: var(--text-primary);
  }

  .description {
    margin: 0;
    font-size: 0.8rem;
    color: var(--text-primary);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
    max-height: 200px;
    overflow-y: auto;
  }

  .empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
    font-size: 0.8rem;
  }

  .checkpoint-container {
    padding: 12px;
    overflow-y: auto;
  }

  .btn {
    padding: 8px 14px;
    border: none;
    border-radius: 4px;
    font-size: 0.75rem;
    font-weight: 600;
    cursor: pointer;
  }

  .btn-abort {
    background: var(--error);
    color: white;
    align-self: flex-start;
  }
</style>
