<script lang="ts">
  import { onMount, afterUpdate } from 'svelte'
  import type { AgentLog } from '../lib/types'
  import { getAgentLogs } from '../lib/ipc'

  export let sessionId: string

  let logs: AgentLog[] = []
  let container: HTMLDivElement
  let autoScroll = true

  async function loadLogs() {
    try {
      logs = await getAgentLogs(sessionId)
    } catch (e) {
      console.error('Failed to load logs:', e)
    }
  }

  onMount(() => {
    loadLogs()
    const interval = setInterval(loadLogs, 3000)
    return () => clearInterval(interval)
  })

  afterUpdate(() => {
    if (autoScroll && container) {
      container.scrollTop = container.scrollHeight
    }
  })

  function formatTime(timestamp: number): string {
    return new Date(timestamp * 1000).toLocaleTimeString()
  }
</script>

<div class="log-viewer" bind:this={container}>
  {#if logs.length === 0}
    <div class="empty">No logs yet</div>
  {:else}
    {#each logs as log (log.id)}
      <div class="log-entry" class:prompt={log.log_type === 'prompt'} class:response={log.log_type === 'response'} class:error={log.log_type === 'error'}>
        <span class="log-time">{formatTime(log.timestamp)}</span>
        <span class="log-type">[{log.log_type}]</span>
        <pre class="log-content">{log.content}</pre>
      </div>
    {/each}
  {/if}
</div>

<style>
  .log-viewer {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
    font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
    font-size: 0.75rem;
    background: var(--bg-primary);
    border-radius: 4px;
  }

  .empty {
    color: var(--text-secondary);
    text-align: center;
    padding: 40px;
  }

  .log-entry {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 1px solid var(--border);
  }

  .log-time {
    color: var(--text-secondary);
    flex-shrink: 0;
  }

  .log-type {
    font-weight: 600;
    flex-shrink: 0;
  }

  .prompt .log-type { color: var(--accent); }
  .response .log-type { color: var(--success); }
  .error .log-type { color: var(--error); }

  .log-content {
    margin: 0;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--text-primary);
    width: 100%;
    line-height: 1.4;
  }
</style>
