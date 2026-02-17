<script lang="ts">
  import type { Ticket, AgentSession, KanbanColumn } from '../lib/types'
  import { COLUMNS, COLUMN_LABELS } from '../lib/types'
  import { tickets, selectedTicketId, activeSessions, ticketPrs, error } from '../lib/stores'
  import { startTicketImplementation } from '../lib/ipc'
  import TicketCard from './TicketCard.svelte'

  function ticketsForColumn(allTickets: Ticket[], column: KanbanColumn): Ticket[] {
    return allTickets.filter(t => t.status === column)
  }

  function getSession(sessions: Map<string, AgentSession>, ticketId: string): AgentSession | null {
    return sessions.get(ticketId) || null
  }

  function handleSelect(event: CustomEvent<string>) {
    $selectedTicketId = event.detail
  }

  let contextMenu = { visible: false, x: 0, y: 0, ticketId: '' }

  function handleContextMenu(event: MouseEvent, ticketId: string) {
    event.preventDefault()
    contextMenu = { visible: true, x: event.clientX, y: event.clientY, ticketId }
  }

  function closeContextMenu() {
    contextMenu = { ...contextMenu, visible: false }
  }

  async function handleStartImplementation() {
    closeContextMenu()
    try {
      await startTicketImplementation(contextMenu.ticketId)
    } catch (err: unknown) {
      console.error('Failed to start implementation:', err)
      $error = String(err)
    }
  }
</script>

<svelte:window on:click={closeContextMenu} />

<div class="kanban">
  {#each COLUMNS as column}
    {@const columnTickets = ticketsForColumn($tickets, column)}
    <div class="column">
      <div class="column-header">
        <span class="column-name">{COLUMN_LABELS[column]}</span>
        <span class="column-count">{columnTickets.length}</span>
      </div>
      <div class="column-body">
        {#each columnTickets as ticket (ticket.id)}
          <div on:contextmenu={(e) => handleContextMenu(e, ticket.id)}>
            <TicketCard {ticket} session={getSession($activeSessions, ticket.id)} pullRequests={$ticketPrs.get(ticket.id) || []} on:select={handleSelect} />
          </div>
        {/each}
        {#if columnTickets.length === 0}
          <div class="empty-column">No tickets</div>
        {/if}
      </div>
    </div>
  {/each}
</div>

{#if contextMenu.visible}
  <div class="context-menu" style="left: {contextMenu.x}px; top: {contextMenu.y}px;">
    <button class="context-item" on:click={handleStartImplementation}>Start Implementation</button>
  </div>
{/if}

<style>
  .kanban {
    display: flex;
    gap: 12px;
    padding: 16px;
    height: 100%;
    overflow-x: auto;
  }

  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .column-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    border-bottom: 1px solid var(--border);
  }

  .column-name {
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-primary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .column-count {
    font-size: 0.7rem;
    color: var(--text-secondary);
    background: var(--bg-primary);
    padding: 2px 8px;
    border-radius: 10px;
  }

  .column-body {
    flex: 1;
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow-y: auto;
  }

  .empty-column {
    text-align: center;
    font-size: 0.75rem;
    color: var(--text-secondary);
    padding: 20px 0;
  }

  .context-menu {
    position: fixed;
    z-index: 100;
    background: var(--bg-card);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    min-width: 180px;
    padding: 4px;
  }

  .context-item {
    all: unset;
    display: block;
    width: 100%;
    box-sizing: border-box;
    padding: 8px 12px;
    font-size: 0.8rem;
    color: var(--text-primary);
    cursor: pointer;
    border-radius: 4px;
  }

  .context-item:hover {
    background: var(--accent);
    color: var(--bg-primary);
  }
</style>
