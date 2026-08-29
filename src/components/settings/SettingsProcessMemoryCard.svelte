<script lang="ts">
  import { Activity } from '@lucide/svelte'
  import { onDestroy, onMount } from 'svelte'
  import { getProcessMemoryHistory, setProcessMemoryHistoryEnabled } from '../../lib/ipc'
  import type { ProcessMemoryHistorySample, ProcessMemoryHistorySnapshot } from '../../lib/types'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  const REFRESH_INTERVAL_MS = 15_000
  const CHART_WIDTH = 480
  const CHART_HEIGHT = 112
  const CHART_PADDING = 8

  const series = [
    { label: 'Electron', key: 'electronTotalTreeRssBytes', color: 'text-primary' },
    { label: 'Sidecar', key: 'sidecarTotalTreeRssBytes', color: 'text-secondary' },
    { label: 'Managed PTY', key: 'managedPtyTotalTreeRssBytes', color: 'text-accent' },
    { label: 'Plugin host', key: 'pluginHostTotalTreeRssBytes', color: 'text-warning' },
  ] as const

  let snapshot = $state<ProcessMemoryHistorySnapshot | null>(null)
  let loading = $state(true)
  let saving = $state(false)
  let loadError = $state<string | null>(null)
  let refreshTimer: ReturnType<typeof setInterval> | null = null
  let refreshInFlight = false
  let requestVersion = 0

  const latestSample = $derived(snapshot?.samples.at(-1) ?? null)
  const chartMaximum = $derived.by(() => {
    if (!snapshot?.samples.length) return 1
    return Math.max(
      1,
      ...snapshot.samples.flatMap((sample) => series.map(({ key }) => sample[key])),
    )
  })
  const chartLabel = $derived(latestSample
    ? `Process memory RSS trends. Latest tracked unique total ${formatBytes(latestSample.trackedUniqueRssBytes)}.`
    : 'Process memory RSS trends. No samples collected yet.')

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function formatBytes(bytes: number): string {
    const megabytes = bytes / 1024 / 1024
    if (megabytes >= 10) return `${Math.round(megabytes).toLocaleString()} MB`
    return `${megabytes.toFixed(1)} MB`
  }

  function pointsFor(key: keyof ProcessMemoryHistorySample): string {
    const samples = snapshot?.samples ?? []
    if (samples.length === 0) return ''
    const usableWidth = CHART_WIDTH - CHART_PADDING * 2
    const usableHeight = CHART_HEIGHT - CHART_PADDING * 2
    return samples.map((sample, index) => {
      const x = samples.length === 1
        ? CHART_WIDTH / 2
        : CHART_PADDING + index * usableWidth / (samples.length - 1)
      const y = CHART_PADDING + usableHeight * (1 - Number(sample[key]) / chartMaximum)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    }).join(' ')
  }

  async function refresh() {
    if (refreshInFlight || saving) return
    const version = ++requestVersion
    refreshInFlight = true
    loadError = null
    try {
      const nextSnapshot = await getProcessMemoryHistory()
      if (version === requestVersion) snapshot = nextSnapshot
    } catch (error) {
      if (version === requestVersion) loadError = errorMessage(error)
    } finally {
      loading = false
      refreshInFlight = false
    }
  }

  async function handleEnabledChange(event: Event) {
    const enabled = (event.currentTarget as HTMLInputElement).checked
    const version = ++requestVersion
    saving = true
    loadError = null
    try {
      const nextSnapshot = await setProcessMemoryHistoryEnabled(enabled)
      if (version === requestVersion) snapshot = nextSnapshot
    } catch (error) {
      if (version === requestVersion) loadError = errorMessage(error)
    } finally {
      saving = false
    }
  }

  onMount(() => {
    void refresh()
    refreshTimer = setInterval(() => void refresh(), REFRESH_INTERVAL_MS)
  })

  onDestroy(() => {
    if (refreshTimer) {
      clearInterval(refreshTimer)
      refreshTimer = null
    }
  })
</script>

<SettingsSectionCard
  id="section-process-memory"
  title="Process memory history"
  description="Observe one hour of app process RSS without an external sampler."
>
  {#snippet icon()}<Activity size={16} />{/snippet}
  {#snippet actions()}
    <label class="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
      <span>Collect history</span>
      <input
        type="checkbox"
        class="toggle toggle-sm toggle-primary"
        aria-label="Collect process memory history"
        checked={snapshot?.enabled ?? false}
        disabled={loading || saving}
        onchange={handleEnabledChange}
      />
    </label>
  {/snippet}

  <div class="flex flex-col gap-4">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <p class="m-0 max-w-3xl text-sm text-base-content/70">
        Sampling runs once per minute only while enabled. OpenForge keeps the latest {snapshot?.maxSamples ?? 60} samples in memory and never records commands or payloads.
      </p>
      <span class="badge badge-ghost font-mono text-xs">
        {snapshot?.samples.length ?? 0}/{snapshot?.maxSamples ?? 60} samples
      </span>
    </div>

    {#if loadError}
      <p class="m-0 text-sm text-error" role="alert">Process memory history failed: {loadError}</p>
    {:else if loading}
      <p class="m-0 text-sm text-base-content/60" aria-live="polite">Loading process memory history…</p>
    {:else if !snapshot?.enabled && snapshot?.samples.length === 0}
      <p class="m-0 rounded-lg border border-dashed border-base-300 bg-base-200/50 p-4 text-sm text-base-content/65">
        History is off. Enable it to begin collecting totals-only RSS samples.
      </p>
    {:else if snapshot?.samples.length === 0}
      <p class="m-0 rounded-lg border border-dashed border-base-300 bg-base-200/50 p-4 text-sm text-base-content/65" aria-live="polite">
        Sampling is on. The first totals are being collected.
      </p>
    {:else}
      <div class="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {#each series as item (item.key)}
          <div class="rounded-lg border border-base-300 bg-base-200/45 px-3 py-2">
            <div class="flex items-center gap-2 text-xs text-base-content/65">
              <span class="h-2 w-2 rounded-full bg-current {item.color}" aria-hidden="true"></span>
              {item.label}
            </div>
            <div class="mt-1 font-mono text-sm font-semibold tabular-nums">
              {formatBytes(latestSample?.[item.key] ?? 0)}
            </div>
          </div>
        {/each}
      </div>

      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        class="h-28 w-full overflow-visible rounded-lg border border-base-300 bg-base-200/35"
        role="img"
        aria-label={chartLabel}
      >
        <line x1={CHART_PADDING} y1={CHART_HEIGHT - CHART_PADDING} x2={CHART_WIDTH - CHART_PADDING} y2={CHART_HEIGHT - CHART_PADDING} class="stroke-base-content/15" />
        {#each series as item (item.key)}
          <polyline
            points={pointsFor(item.key)}
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            vector-effect="non-scaling-stroke"
            class={item.color}
          />
        {/each}
      </svg>
    {/if}

    {#if snapshot}
      <p class="m-0 text-xs leading-relaxed text-base-content/55">{snapshot.rssSemantics}</p>
    {/if}
  </div>
</SettingsSectionCard>
