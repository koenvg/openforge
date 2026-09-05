<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { onMount } from 'svelte'
  import {
    getCompanionGatewayStatus,
    listCompanionDevices,
    removeCompanionDevice,
    revokeCompanionDevice,
    resetCompanionHostIdentity,
    setCompanionGatewayEnabled,
    setCompanionTailscaleHostname,
  } from '../../lib/ipc'
  import type { CompanionGatewayStatus, CompanionPairedDevice } from '../../lib/types'
  import CompanionGatewayHealth from './CompanionGatewayHealth.svelte'
  import CompanionPairedDevices from './CompanionPairedDevices.svelte'
  import CompanionTailscaleEndpoint from './CompanionTailscaleEndpoint.svelte'
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

  async function saveTailscaleHostname(hostname: string) {
    if (updating) return
    updating = true
    requestError = null
    feedback = null
    try {
      const nextStatus = await setCompanionTailscaleHostname(hostname)
      status = nextStatus
      pairingRefreshGeneration += 1
      feedback = nextStatus.endpoints.some((endpoint) => endpoint.kind === 'tailscale')
        ? 'Tailscale hostname saved. New pairing codes will include this endpoint.'
        : 'Tailscale hostname saved. Connect Tailscale on this Mac and re-enable the gateway before pairing.'
    } catch (error) {
      requestError = errorMessage(error)
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

  async function removeDevice(device: CompanionPairedDevice) {
    if (updating || !device.revokedAt) return
    const confirmed = window.confirm(
      `Remove ${device.deviceName}? This permanently deletes its pairing record.`,
    )
    if (!confirmed) return
    updating = true
    requestError = null
    feedback = null
    try {
      await removeCompanionDevice(device.deviceId)
    } catch (error) {
      requestError = errorMessage(error)
      updating = false
      return
    }

    try {
      await refreshDevices()
      feedback = `Removed device: ${device.deviceName}`
    } catch (error) {
      requestError = `Device was removed, but paired devices could not be refreshed: ${errorMessage(error)}`
    } finally {
      updating = false
    }
  }

  async function resetIdentity() {
    if (updating) return
    const confirmed = window.confirm(
      'Reset the Companion host identity? This revokes all paired devices and every phone must pair again.',
    )
    if (!confirmed) return
    updating = true
    requestError = null
    feedback = null
    try {
      status = await resetCompanionHostIdentity()
      pairingRefreshGeneration += 1
      feedback = 'Companion identity reset. All devices must pair again.'
    } catch (error) {
      let message = errorMessage(error)
      try {
        status = await getCompanionGatewayStatus()
        pairingRefreshGeneration += 1
        await refreshDevices()
      } catch (refreshError) {
        message = `${message}. Current trust state could not be refreshed: ${errorMessage(refreshError)}`
      }
      requestError = message
      updating = false
      return
    }

    try {
      await refreshDevices()
    } catch (error) {
      requestError = `Identity reset succeeded, but paired devices could not be refreshed: ${errorMessage(error)}`
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
  description="Opt in to mobile Task actions with interactive Agent terminal access."
>
  <div class="flex flex-col gap-4">
    <p class="m-0 text-sm text-[var(--of-text-secondary)]">
      OpenForge must remain running for the Mobile Companion to connect. Paired phones can Create backlog Tasks from a prompt, Start backlog Tasks with saved defaults, Delete or Complete Tasks, and type into running Agent terminals as your desktop user. Task actions follow desktop lifecycle safeguards; terminal access alone cannot create, stop, or replace Agent Sessions. This authority remains active while this Mac is locked and ends when the Companion Gateway is disabled, the device is revoked, or Companion identity is reset. The internal desktop and CLI bridge stays local to this Mac.
    </p>

    {#if loading && !status}
      <p class="m-0 text-sm text-[var(--of-text-muted)]" aria-live="polite">Loading Companion Gateway status…</p>
    {:else if status}
      <CompanionGatewayHealth {status} {updating} ontoggle={toggleGateway} />

      <CompanionTailscaleEndpoint
        status={status.tailscale}
        {updating}
        onsave={saveTailscaleHostname}
      />

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

      <CompanionPairedDevices
        {devices}
        {updating}
        onrevoke={revokeDevice}
        onremove={removeDevice}
      />

      <section class="flex flex-col gap-2 border-t border-[var(--of-border)] pt-4" aria-labelledby="companion-identity-reset-heading">
        <div>
          <h3 id="companion-identity-reset-heading" class="m-0 text-sm font-medium">Reset Companion identity</h3>
          <p class="m-0 text-xs text-[var(--of-text-muted)]">
            Replace this desktop’s key and certificate, revoke every device, and require all phones to pair again.
          </p>
        </div>
        <Button
          type="button"
          variant="danger" size="sm" class="self-start"
          disabled={updating}
          onclick={resetIdentity}
        >Reset Companion identity</Button>
      </section>
    {/if}

    {#if feedback}
      <Panel padding="none" variant="subtle">
        <div class="flex items-center gap-3 p-3 text-sm" role="status">
          <Badge variant="success">Success</Badge>
          <span>{feedback}</span>
        </div>
      </Panel>
    {/if}

    {#if requestError}
      <Panel padding="none" variant="subtle">
        <div role="alert" class="flex items-center gap-3 p-3 text-sm">
          <Badge variant="danger">Error</Badge>
          <span>{requestError}</span>
          <Button type="button" variant="ghost" size="xs" onclick={refresh}>Retry</Button>
        </div>
      </Panel>
    {/if}
  </div>
</SettingsSectionCard>
