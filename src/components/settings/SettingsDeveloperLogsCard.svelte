<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { onDestroy, onMount, tick } from 'svelte'
  import { Terminal } from '@lucide/svelte'
  import { getDeveloperLogSnapshot, openInEditor } from '../../lib/ipc'
  import type { DeveloperLogEntry } from '../../lib/types'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  const LIVE_REFRESH_INTERVAL_MS = 1000
  const DISPLAY_LOG_LIMIT = 1000

  let logs = $state<DeveloperLogEntry[]>([])
  let totalEntries = $state(0)
  let logFilePath = $state('')
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let liveRefreshTimer: ReturnType<typeof setInterval> | null = null
  let refreshInFlight = false
  let logTraceElement = $state<HTMLPreElement | null>(null)

  const formattedLogs = $derived(logs.map(formatLogEntry).join('\n'))
  const showingSummary = $derived(totalEntries > logs.length
    ? `Showing latest ${logs.length.toLocaleString()} of ${totalEntries.toLocaleString()} entries. Full trace is written to disk.`
    : `Showing ${logs.length.toLocaleString()} entries. Full trace is written to disk.`)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function formatLogEntry(entry: DeveloperLogEntry): string {
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`
  }

  function isLogTraceAtBottom(): boolean {
    if (!logTraceElement) return true
    const distanceFromBottom = logTraceElement.scrollHeight - logTraceElement.clientHeight - logTraceElement.scrollTop
    return distanceFromBottom <= 2
  }

  function scrollLogTraceToBottom() {
    if (!logTraceElement) return
    logTraceElement.scrollTop = logTraceElement.scrollHeight
  }

  async function refreshLogs(options: { showLoading?: boolean } = {}) {
    if (refreshInFlight) return
    const showLoading = options.showLoading ?? true
    refreshInFlight = true
    const shouldStickToBottom = logs.length === 0 || isLogTraceAtBottom()
    if (showLoading) loading = true
    loadError = null
    try {
      const snapshot = await getDeveloperLogSnapshot(DISPLAY_LOG_LIMIT)
      logs = snapshot.entries
      totalEntries = snapshot.totalEntries
      logFilePath = snapshot.logFilePath
      if (shouldStickToBottom && snapshot.entries.length > 0) {
        await tick()
        scrollLogTraceToBottom()
      }
    } catch (error) {
      loadError = errorMessage(error)
    } finally {
      if (showLoading) loading = false
      refreshInFlight = false
    }
  }

  function openFullLogFile() {
    if (!logFilePath) return
    void openInEditor(logFilePath)
  }

  onMount(() => {
    void refreshLogs()
    liveRefreshTimer = setInterval(() => {
      void refreshLogs({ showLoading: false })
    }, LIVE_REFRESH_INTERVAL_MS)
  })

  onDestroy(() => {
    if (liveRefreshTimer) {
      clearInterval(liveRefreshTimer)
      liveRefreshTimer = null
    }
  })
</script>

<SettingsSectionCard id="section-developer" title="Developer">
  {#snippet icon()}<Terminal size={16} />{/snippet}
  {#snippet actions()}
    <Button type="button" variant="ghost" size="xs" onclick={openFullLogFile} disabled={!logFilePath}>
      Open full log file
    </Button>
    <Button type="button" variant="ghost" size="xs" onclick={() => { void refreshLogs() }} disabled={loading}>
      {loading ? 'Refreshing…' : 'Refresh logs'}
    </Button>
  {/snippet}
  <div class="flex flex-col gap-3">
    <p class="text-sm text-[var(--of-text-secondary)] m-0">
      Live OpenForge desktop log tail, including Electron and Rust sidecar output. The full trace is appended to a file so it does not have to stay in memory.
    </p>

    {#if logFilePath}
      <p class="text-xs text-[var(--of-text-muted)] m-0 break-all">Full trace file: {logFilePath}</p>
    {/if}

    {#if logs.length > 0}
      <p class="text-xs text-[var(--of-text-muted)] m-0">{showingSummary}</p>
    {/if}

    {#if loadError}
      <p class="text-sm text-[var(--of-danger)] m-0">Failed to load logs: {loadError}</p>
    {:else if loading && logs.length === 0}
      <p class="text-sm text-[var(--of-text-muted)] m-0">Loading logs…</p>
    {:else if logs.length === 0}
      <p class="text-sm text-[var(--of-text-muted)] m-0">No logs captured yet.</p>
    {:else}
      <pre bind:this={logTraceElement} aria-label="OpenForge log trace" class="settings-layout max-h-96 overflow-auto whitespace-pre-wrap bg-[var(--of-surface-subtle)] p-3 text-xs text-[var(--of-text)]">{formattedLogs}</pre>
    {/if}
  </div>
</SettingsSectionCard>
