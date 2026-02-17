<script lang="ts">
  import { onMount, onDestroy } from 'svelte'
  import { listen } from '@tauri-apps/api/event'
  import type { UnlistenFn } from '@tauri-apps/api/event'
  import { tickets, selectedTicketId, activeSessions, error } from './lib/stores'
  import { getTickets, getOpenCodeStatus, getSessionStatus } from './lib/ipc'
  import type { OpenCodeStatus, PrComment } from './lib/types'
  import KanbanBoard from './components/KanbanBoard.svelte'
  import DetailPanel from './components/DetailPanel.svelte'
  import SettingsPanel from './components/SettingsPanel.svelte'

  let openCodeStatus: OpenCodeStatus | null = null
  let unlisteners: UnlistenFn[] = []
  let showSettings = false
  let prComments: PrComment[] = []

  $: selectedTicket = $tickets.find(t => t.id === $selectedTicketId) || null

  async function loadTickets() {
    try {
      $tickets = await getTickets()
    } catch (e) {
      console.error('Failed to load tickets:', e)
      $error = String(e)
    }
  }

  async function checkOpenCode() {
    try {
      openCodeStatus = await getOpenCodeStatus()
    } catch (e) {
      openCodeStatus = null
    }
  }

  onMount(async () => {
    await loadTickets()
    await checkOpenCode()

    unlisteners.push(
      await listen('jira-sync-complete', () => {
        loadTickets()
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string; stage: string; data: unknown }>('checkpoint-reached', async (event) => {
        try {
          const session = await getSessionStatus(event.payload.session_id)
          $activeSessions = new Map($activeSessions).set(session.ticket_id, session)
        } catch (e) {
          console.error('Failed to get session status:', e)
        }
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string; stage: string }>('stage-completed', async (event) => {
        try {
          const session = await getSessionStatus(event.payload.session_id)
          $activeSessions = new Map($activeSessions).set(session.ticket_id, session)
          await loadTickets()
        } catch (e) {
          console.error('Failed to get session status:', e)
        }
      })
    )

    unlisteners.push(
      await listen('new-pr-comment', () => {
        loadTickets()
      })
    )

    unlisteners.push(
      await listen<{ ticket_id: string; session_id: string }>('session-aborted', (event) => {
        const updated = new Map($activeSessions)
        updated.delete(event.payload.ticket_id)
        $activeSessions = updated
      })
    )
  })

  onDestroy(() => {
    unlisteners.forEach(fn => fn())
  })
</script>

<div class="app">
  <header class="top-bar">
    <h1 class="app-title">AI Command Center</h1>
    <div class="status-bar">
      <button class="settings-btn" on:click={() => showSettings = !showSettings}>
        {showSettings ? 'Board' : 'Settings'}
      </button>
      {#if openCodeStatus}
        <span class="status-indicator" class:healthy={openCodeStatus.healthy} class:unhealthy={!openCodeStatus.healthy}>
          <span class="dot"></span>
          OpenCode {openCodeStatus.healthy ? 'Connected' : 'Disconnected'}
        </span>
      {:else}
        <span class="status-indicator unhealthy">
          <span class="dot"></span>
          OpenCode Unavailable
        </span>
      {/if}
    </div>
  </header>

  <main class="main-content">
    {#if showSettings}
      <SettingsPanel on:close={() => showSettings = false} />
    {:else}
      <div class="board-area" class:has-detail={selectedTicket !== null}>
        <KanbanBoard />
      </div>
      {#if selectedTicket}
        <div class="detail-area">
          <DetailPanel ticket={selectedTicket} comments={prComments} on:close={() => $selectedTicketId = null} />
        </div>
      {/if}
    {/if}
  </main>
</div>

<style>
  :global(:root) {
    --bg-primary: #1a1b26;
    --bg-secondary: #24283b;
    --bg-card: #2f3349;
    --text-primary: #c0caf5;
    --text-secondary: #565f89;
    --accent: #7aa2f7;
    --success: #9ece6a;
    --warning: #e0af68;
    --error: #f7768e;
    --border: #3b4261;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
      'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue',
      sans-serif;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    background: var(--bg-primary);
    color: var(--text-primary);
  }

  :global(*) {
    box-sizing: border-box;
  }

  .app {
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  .top-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 48px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
  }

  .app-title {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: 0.02em;
  }

  .status-bar {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 0.75rem;
    color: var(--text-secondary);
  }

  .dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--text-secondary);
  }

  .healthy .dot {
    background: var(--success);
  }

  .unhealthy .dot {
    background: var(--error);
  }

  .main-content {
    flex: 1;
    overflow: hidden;
    display: flex;
  }

  .board-area {
    flex: 1;
    overflow: hidden;
  }

  .board-area.has-detail {
    flex: 1;
  }

  .detail-area {
    width: 400px;
    flex-shrink: 0;
    overflow: hidden;
  }

  .settings-btn {
    all: unset;
    padding: 4px 12px;
    font-size: 0.75rem;
    color: var(--text-secondary);
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }

  .settings-btn:hover {
    color: var(--text-primary);
    border-color: var(--accent);
  }
</style>
