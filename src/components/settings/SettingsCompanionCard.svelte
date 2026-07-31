<script lang="ts">
  import { onMount } from 'svelte'
  import {
    getCompanionGatewayStatus,
    listCompanionDevices,
    revokeCompanionDevice,
    setCompanionGatewayEnabled,
  } from '../../lib/ipc'
  import type { CompanionGatewayStatus, CompanionPairedDevice } from '../../lib/types'
  import CompanionGatewayHealth from './CompanionGatewayHealth.svelte'
  import CompanionPairedDevices from './CompanionPairedDevices.svelte'
  import CompanionPairingSession from './CompanionPairingSession.svelte'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  let status = $state<CompanionGatewayStatus | null>(null)
  let devices = $state<CompanionPairedDevice[]>([])
  let loading = $state(true)
  let updating = $state(false)
  let requestError = $state<string | null>(null)
  let feedback = $state<string | null>(null)
  let pairingRefreshGeneration = $state(0)

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
  }

  async function refreshDevices() {
    devices = await listCompanionDevices()
  }

  async function refresh() {
    loading = true
    requestError = null
    try {
      status = await getCompanionGatewayStatus()
      pairingRefreshGeneration += 1
      await refreshDevices()
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
    feedback = null
    try {
      status = await setCompanionGatewayEnabled(!status.enabled)
      pairingRefreshGeneration += 1
      await refreshDevices()
    } catch (error) {
      requestError = errorMessage(error)
      await refresh()
    } finally {
      updating = false
    }
  }

  async function revokeDevice(device: CompanionPairedDevice) {
    if (!window.confirm(`Revoke Companion access for ${device.deviceName}?`)) return
    updating = true
    requestError = null
    try {
      await revokeCompanionDevice(device.deviceId)
      feedback = `Access revoked: ${device.deviceName}`
      await refreshDevices()
    } catch (error) {
      requestError = errorMessage(error)
    } finally {
      updating = false
    }
  }

  onMount(() => {
    void refresh()
  })
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
      <CompanionGatewayHealth {status} {updating} ontoggle={toggleGateway} />

      <CompanionPairingSession
        gatewayEnabled={status.enabled}
        gatewayRunning={status.phase === 'running'}
        refreshGeneration={pairingRefreshGeneration}
        {updating}
        onupdatingchange={(nextUpdating) => updating = nextUpdating}
        onfeedback={(message) => feedback = message}
        onerror={(message) => requestError = message}
        ondeviceschanged={refreshDevices}
      />

      <CompanionPairedDevices {devices} {updating} onrevoke={revokeDevice} />
    {/if}

    {#if feedback}
      <div class="alert alert-success text-sm" aria-live="polite">{feedback}</div>
    {/if}

    {#if requestError}
      <div role="alert" class="alert alert-error text-sm">
        <span>{requestError}</span>
        <button type="button" class="btn btn-ghost btn-xs" onclick={refresh}>Retry</button>
      </div>
    {/if}
  </div>
</SettingsSectionCard>
