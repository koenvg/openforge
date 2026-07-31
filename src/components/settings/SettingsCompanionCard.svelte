<script lang="ts">
  import QRCode from 'qrcode'
  import { onMount } from 'svelte'
  import {
    approveCompanionPairing,
    cancelCompanionPairing,
    getCompanionGatewayStatus,
    getCompanionPairingStatus,
    listCompanionDevices,
    rejectCompanionPairing,
    revokeCompanionDevice,
    setCompanionGatewayEnabled,
    startCompanionPairing,
  } from '../../lib/ipc'
  import type {
    CompanionGatewayPhase,
    CompanionGatewayStatus,
    CompanionPairedDevice,
    CompanionPairingSession,
  } from '../../lib/types'
  import SettingsSectionCard from './SettingsSectionCard.svelte'

  let status = $state<CompanionGatewayStatus | null>(null)
  let pairing = $state<CompanionPairingSession | null>(null)
  let devices = $state<CompanionPairedDevice[]>([])
  let qrDataUrl = $state<string | null>(null)
  let loading = $state(true)
  let updating = $state(false)
  let requestError = $state<string | null>(null)
  let feedback = $state<string | null>(null)
  let pairingGeneration = 0

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

  function platformLabel(platform: 'ios' | 'android'): string {
    return platform === 'ios' ? 'iOS' : 'Android'
  }

  function formattedDate(value: string): string {
    return new Date(value).toLocaleString()
  }

  async function applyPairing(
    nextPairing: CompanionPairingSession | null,
    generation = ++pairingGeneration,
  ) {
    let nextQrDataUrl: string | null = null
    if (nextPairing && !nextPairing.pendingRequest && !nextPairing.deliveryPending) {
      nextQrDataUrl = await QRCode.toDataURL(nextPairing.qrPayload, {
        errorCorrectionLevel: 'M',
        margin: 1,
        width: 320,
      })
    }
    if (generation !== pairingGeneration) return
    pairing = nextPairing
    qrDataUrl = nextQrDataUrl
  }

  async function refreshPairing() {
    if (!status?.enabled) {
      await applyPairing(null)
      return
    }
    const generation = ++pairingGeneration
    const nextPairing = await getCompanionPairingStatus()
    await applyPairing(nextPairing, generation)
  }

  async function refreshDevices() {
    devices = await listCompanionDevices()
  }

  async function refresh() {
    loading = true
    requestError = null
    try {
      status = await getCompanionGatewayStatus()
      await Promise.all([refreshPairing(), refreshDevices()])
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
      await Promise.all([refreshPairing(), refreshDevices()])
    } catch (error) {
      requestError = errorMessage(error)
      await refresh()
    } finally {
      updating = false
    }
  }

  async function startPairing() {
    updating = true
    requestError = null
    feedback = null
    try {
      await applyPairing(await startCompanionPairing())
    } catch (error) {
      requestError = errorMessage(error)
    } finally {
      updating = false
    }
  }

  async function cancelPairing() {
    if (!pairing) return
    updating = true
    requestError = null
    try {
      await cancelCompanionPairing(pairing.sessionId)
      await applyPairing(null)
      feedback = 'Pairing cancelled.'
    } catch (error) {
      requestError = errorMessage(error)
    } finally {
      updating = false
    }
  }

  async function decidePairing(decision: 'approve' | 'reject') {
    const pending = pairing?.pendingRequest
    if (!pending) return
    updating = true
    requestError = null
    try {
      if (decision === 'approve') {
        await approveCompanionPairing(pending.requestId)
        feedback = `Device approved: ${pending.deviceName}`
        if (pairing) {
          await applyPairing({
            ...pairing,
            pendingRequest: null,
            deliveryPending: true,
          })
        }
      } else {
        await rejectCompanionPairing(pending.requestId)
        feedback = `Device rejected: ${pending.deviceName}`
        await applyPairing(null)
      }
      await refreshDevices()
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

  onMount(() => {
    void refresh()
    const interval = window.setInterval(() => {
      if (status?.enabled && !updating) {
        void refreshPairing().catch((error) => {
          requestError = errorMessage(error)
        })
      }
    }, 1000)
    return () => window.clearInterval(interval)
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
          {status.enabled ? 'Disable Companion Gateway' : 'Enable Companion Gateway'}
        </button>
      </div>

      {#if status.error}
        <div role="alert" class="alert alert-error text-sm">{status.error}</div>
      {/if}

      {#if status.phase === 'running'}
        <section class="flex flex-col gap-3" aria-labelledby="pair-phone-heading">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 id="pair-phone-heading" class="m-0 text-sm font-medium">Pair a phone</h3>
              <p class="m-0 text-xs text-base-content/60">The QR expires quickly and can be scanned only once.</p>
            </div>
            {#if !pairing}
              <button type="button" class="btn btn-primary btn-sm" disabled={updating} onclick={startPairing}>Pair a phone</button>
            {/if}
          </div>

          {#if pairing?.deliveryPending}
            <div class="rounded-md border border-base-300 p-3" aria-live="polite">
              <div class="font-medium">Approved — waiting for phone</div>
              <p class="m-0 mt-1 text-sm text-base-content/70">Keep this session open while the phone receives its one-time credential.</p>
            </div>
          {:else if pairing?.pendingRequest}
            <div class="rounded-md border border-base-300 p-3">
              <div class="font-medium">{pairing.pendingRequest.deviceName}</div>
              <div class="mt-1 text-sm text-base-content/70">{platformLabel(pairing.pendingRequest.platform)} · Awaiting your approval</div>
              <div class="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  disabled={updating}
                  aria-label={`Approve ${pairing.pendingRequest.deviceName}`}
                  onclick={() => decidePairing('approve')}
                >Approve</button>
                <button
                  type="button"
                  class="btn btn-outline btn-error btn-sm"
                  disabled={updating}
                  aria-label={`Reject ${pairing.pendingRequest.deviceName}`}
                  onclick={() => decidePairing('reject')}
                >Reject</button>
              </div>
            </div>
          {:else if pairing && qrDataUrl}
            <div class="flex flex-col items-center gap-3 rounded-md border border-base-300 p-4 text-center">
              <img src={qrDataUrl} alt="Companion pairing QR code" width="320" height="320" class="max-w-full rounded bg-white" />
              <p class="m-0 text-sm text-base-content/70">Expires {formattedDate(pairing.expiresAt)}</p>
              <button type="button" class="btn btn-ghost btn-sm" disabled={updating} onclick={cancelPairing}>Cancel pairing</button>
            </div>
          {/if}
        </section>
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

      {#if devices.length > 0}
        <section class="flex flex-col gap-2" aria-labelledby="paired-devices-heading">
          <h3 id="paired-devices-heading" class="m-0 text-sm font-medium">Paired devices</h3>
          <ul class="m-0 flex list-none flex-col gap-2 p-0">
            {#each devices as device (device.deviceId)}
              <li class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-base-300 px-3 py-2">
                <div>
                  <div class="text-sm font-medium">{device.deviceName}</div>
                  <div class="text-xs text-base-content/60">{platformLabel(device.platform)} · Paired {formattedDate(device.pairedAt)}</div>
                </div>
                {#if device.revokedAt}
                  <span class="badge badge-error badge-outline">Revoked</span>
                {:else}
                  <button
                    type="button"
                    class="btn btn-ghost btn-sm text-error"
                    disabled={updating}
                    aria-label={`Revoke ${device.deviceName}`}
                    onclick={() => revokeDevice(device)}
                  >Revoke</button>
                {/if}
              </li>
            {/each}
          </ul>
        </section>
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
