<script lang="ts">
  import { onMount } from 'svelte'
  import { getCompanionGatewayStatus, setCompanionGatewayEnabled } from '../../lib/ipc'
  import type { CompanionGatewayPhase, CompanionGatewayStatus } from '../../lib/types'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  let status = $state<CompanionGatewayStatus | null>(null)
  let loading = $state(true)
  let updating = $state(false)
  let requestError = $state<string | null>(null)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  function phaseLabel(phase: CompanionGatewayPhase): string {
    switch (phase) {
      case 'disabled': return 'Disabled'
      case 'starting': return 'Starting'
      case 'running': return 'Running'
      case 'error': return 'Error'
      case 'stopped': return 'Stopped'
    }
  }

  async function refresh() {
    loading = true
    requestError = null
    try {
      status = await getCompanionGatewayStatus()
    } catch (error) {
      requestError = errorMessage(error)
    } finally {
      loading = false
    }
  }

  async function toggleGateway() {
    if (!status || updating) return
    updating = true
    requestError = null
    try {
      status = await setCompanionGatewayEnabled(!status.enabled)
    } catch (error) {
      requestError = errorMessage(error)
      await refresh()
    } finally {
      updating = false
    }
  }

  onMount(refresh)
</script>

<SettingsSectionCard
  title="Companion"
  description="Opt in to a dedicated, read-only mobile connection boundary."
>
  <div class="flex flex-col gap-4">
    <p class="m-0 text-sm text-base-content/70">
      OpenForge must remain running for the Mobile Companion to connect. The internal desktop and CLI bridge stays local to this Mac.
    </p>

    {#if loading && !status}
      <p class="m-0 text-sm text-base-content/60" aria-live="polite">Loading Companion Gateway status…</p>
    {:else if status}
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div class="text-sm font-medium">Gateway health</div>
          <div class="text-sm text-base-content/70" aria-live="polite">{phaseLabel(status.phase)}</div>
        </div>
        <button
          type="button"
          class="btn {status.enabled ? 'btn-outline btn-error' : 'btn-primary'} btn-sm"
          disabled={updating}
          onclick={toggleGateway}
        >
          {#if updating}
            Updating…
          {:else if status.enabled}
            Disable Companion Gateway
          {:else}
            Enable Companion Gateway
          {/if}
        </button>
      </div>

      {#if status.error}
        <div role="alert" class="alert alert-error text-sm">{status.error}</div>
      {/if}

      {#if status.endpoints.length > 0}
        <div class="flex flex-col gap-2">
          <div class="text-sm font-medium">Offered endpoints</div>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {#each status.endpoints as endpoint (endpoint.url)}
              <li class="flex flex-wrap items-center justify-between gap-2 rounded-md border border-base-300 px-3 py-2">
                <span class="badge badge-ghost badge-sm">{endpoint.kind === 'tailscale' ? 'Tailscale' : 'LAN'}</span>
                <code class="break-all text-xs">{endpoint.url}</code>
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if status.hostId}
        <details class="text-sm text-base-content/70">
          <summary class="cursor-pointer font-medium">Desktop host identity</summary>
          <dl class="mt-2 grid gap-2">
            <div>
              <dt class="font-medium">Host ID</dt>
              <dd class="m-0 break-all font-mono text-xs">{status.hostId}</dd>
            </div>
            {#if status.certificateFingerprint}
              <div>
                <dt class="font-medium">TLS certificate fingerprint</dt>
                <dd class="m-0 break-all font-mono text-xs">{status.certificateFingerprint}</dd>
              </div>
            {/if}
          </dl>
        </details>
      {/if}
    {/if}

    {#if requestError}
      <div role="alert" class="alert alert-error text-sm">
        <span>{requestError}</span>
        <button type="button" class="btn btn-ghost btn-xs" onclick={refresh}>Retry</button>
      </div>
    {/if}
  </div>
</SettingsSectionCard>
