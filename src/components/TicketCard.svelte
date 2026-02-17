<script lang="ts">
  import type { Ticket, AgentSession, PullRequestInfo } from '../lib/types'
  import { openUrl } from '../lib/ipc'
  import { createEventDispatcher } from 'svelte'

  export let ticket: Ticket
  export let session: AgentSession | null = null
  export let pullRequests: PullRequestInfo[] = []

  const dispatch = createEventDispatcher()

  function handleClick() {
    dispatch('select', ticket.id)
  }

  function truncate(text: string, max: number): string {
    return text.length > max ? text.slice(0, max) + '...' : text
  }

  function stageLabel(stage: string): string {
    const labels: Record<string, string> = {
      read_ticket: 'Reading ticket',
      implement: 'Implementing',
      create_pr: 'Creating PR',
      address_comments: 'Addressing comments',
    }
    return labels[stage] || stage
  }

  $: statusClass = session?.status || 'idle'
</script>

<button class="card" class:running={statusClass === 'running'} class:paused={statusClass === 'paused'} class:failed={statusClass === 'failed'} on:click={handleClick}>
  <div class="card-header">
    <span class="ticket-id">{ticket.id}</span>
    {#if session}
      <span class="status-dot {statusClass}"></span>
    {/if}
  </div>
  <div class="card-title">{truncate(ticket.title, 60)}</div>
  {#if session}
    <div class="card-status">
      {#if session.status === 'running'}
        {stageLabel(session.stage)}...
      {:else if session.status === 'paused'}
        Awaiting approval
      {:else if session.status === 'failed'}
        {session.error_message || 'Error'}
      {:else if session.status === 'completed'}
        Completed
      {/if}
    </div>
  {/if}
  {#if pullRequests.length > 0}
    <div class="card-prs">
      {#each pullRequests as pr}
        <span
          class="pr-link"
          class:pr-open={pr.state === 'open'}
          class:pr-closed={pr.state !== 'open'}
          role="link"
          tabindex="0"
          on:click|stopPropagation={() => openUrl(pr.url)}
          on:keydown|stopPropagation={(e) => e.key === 'Enter' && openUrl(pr.url)}
        >
          PR #{pr.id}
        </span>
      {/each}
    </div>
  {/if}
  {#if ticket.assignee}
    <div class="card-assignee">{ticket.assignee}</div>
  {/if}
</button>

<style>
  .card {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 10px 12px;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: border-color 0.15s, box-shadow 0.15s;
  }

  .card:hover {
    border-color: var(--accent);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .card.running {
    border-left: 3px solid var(--success);
  }

  .card.paused {
    border-left: 3px solid var(--warning);
  }

  .card.failed {
    border-left: 3px solid var(--error);
  }

  .card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 4px;
  }

  .ticket-id {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--accent);
    letter-spacing: 0.02em;
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .status-dot.running {
    background: var(--success);
    animation: pulse 1.5s infinite;
  }

  .status-dot.paused {
    background: var(--warning);
  }

  .status-dot.failed {
    background: var(--error);
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .card-title {
    font-size: 0.85rem;
    color: var(--text-primary);
    line-height: 1.3;
    margin-bottom: 6px;
  }

  .card-status {
    font-size: 0.7rem;
    color: var(--text-secondary);
    margin-bottom: 4px;
  }

  .card-prs {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 4px;
  }

  .pr-link {
    font-size: 0.65rem;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 4px;
    cursor: pointer;
    transition: opacity 0.15s;
  }

  .pr-link:hover {
    opacity: 0.8;
  }

  .pr-link.pr-open {
    background: rgba(158, 206, 106, 0.15);
    color: var(--success);
  }

  .pr-link.pr-closed {
    background: rgba(86, 95, 137, 0.2);
    color: var(--text-secondary);
  }

  .card-assignee {
    font-size: 0.7rem;
    color: var(--text-secondary);
  }
</style>
