<script lang="ts">
  import { onDestroy, onMount } from 'svelte'
  import { Terminal } from '@lucide/svelte'
  import { getDeveloperLogSnapshot, openInEditor } from '../../lib/ipc'
  import { isNearBottom } from '../../lib/developerLogsScroll'
  import type { DeveloperLogEntry } from '../../lib/types'

  const LIVE_REFRESH_INTERVAL_MS = 1000
  const DISPLAY_LOG_LIMIT = 1000
  // Grace distance from the bottom that still counts as "pinned", so the view
  // keeps following new logs without needing pixel-perfect scroll positioning.
  const STICK_TO_BOTTOM_THRESHOLD_PX = 32

  let logs = $state<DeveloperLogEntry[]>([])
  let totalEntries = $state(0)
  let logFilePath = $state('')
  let loading = $state(false)
  let loadError = $state<string | null>(null)
  let liveRefreshTimer: ReturnType<typeof setInterval> | null = null
  let refreshInFlight = false
  let logContainer = $state<HTMLPreElement | null>(null)
  // Follow new logs while the user is at the bottom; pause once they scroll up.
  let stickToBottom = $state(true)

  const formattedLogs = $derived(logs.map(formatLogEntry).join('\n'))
  const showingSummary = $derived(totalEntries > logs.length
    ? `Showing latest ${logs.length.toLocaleString()} of ${totalEntries.toLocaleString()} entries. Full trace is written to disk.`
    : `Showing ${logs.length.toLocaleString()} entries. Full trace is written to disk.`)

  // Auto-scroll to the newest entry whenever the rendered log text changes,
  // but only while pinned to the bottom so we never yank a user who scrolled up.
  $effect(() => {
    // Read the derived text so this effect re-runs on every log update.
    void formattedLogs
    const el = logContainer
    if (!el || !stickToBottom) return
    el.scrollTop = el.scrollHeight
  })

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function formatLogEntry(entry: DeveloperLogEntry): string {
    return `[${entry.timestamp}] ${entry.level.toUpperCase()} ${entry.message}`
  }

  async function refreshLogs(options: { showLoading?: boolean } = {}) {
    if (refreshInFlight) return
    const showLoading = options.showLoading ?? true
    refreshInFlight = true
    if (showLoading) loading = true
    loadError = null
    try {
      const snapshot = await getDeveloperLogSnapshot(DISPLAY_LOG_LIMIT)
      logs = snapshot.entries
      totalEntries = snapshot.totalEntries
      logFilePath = snapshot.logFilePath
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

  function handleLogScroll() {
    const el = logContainer
    if (!el) return
    stickToBottom = isNearBottom(el.scrollTop, el.scrollHeight, el.clientHeight, STICK_TO_BOTTOM_THRESHOLD_PX)
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

<div id="section-developer" class="rounded-lg border border-base-300 overflow-hidden" style="background-color: var(--project-bg, oklch(var(--b1)))">
  <div class="flex items-center justify-between gap-3 px-5 py-3 border-b border-base-300">
    <div class="flex items-center gap-2">
      <Terminal size={16} />
      <h3 class="text-sm font-semibold text-base-content m-0">Developer</h3>
    </div>
    <div class="flex items-center gap-2">
      <button type="button" class="btn btn-xs btn-ghost" onclick={openFullLogFile} disabled={!logFilePath}>
        Open full log file
      </button>
      <button type="button" class="btn btn-xs btn-ghost" onclick={() => { void refreshLogs() }} disabled={loading}>
        {loading ? 'Refreshing…' : 'Refresh logs'}
      </button>
    </div>
  </div>

  <div class="p-5 flex flex-col gap-3">
    <p class="text-sm text-base-content/70 m-0">
      Live OpenForge desktop log tail, including Electron and Rust sidecar output. The full trace is appended to a file so it does not have to stay in memory.
    </p>

    {#if logFilePath}
      <p class="text-xs text-base-content/60 m-0 break-all">Full trace file: {logFilePath}</p>
    {/if}

    {#if logs.length > 0}
      <p class="text-xs text-base-content/60 m-0">{showingSummary}</p>
    {/if}

    {#if loadError}
      <p class="text-sm text-error m-0">Failed to load logs: {loadError}</p>
    {:else if loading && logs.length === 0}
      <p class="text-sm text-base-content/60 m-0">Loading logs…</p>
    {:else if logs.length === 0}
      <p class="text-sm text-base-content/60 m-0">No logs captured yet.</p>
    {:else}
      <pre bind:this={logContainer} onscroll={handleLogScroll} aria-label="OpenForge log trace" class="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-base-200 p-3 text-xs text-base-content">{formattedLogs}</pre>
    {/if}
  </div>
</div>
