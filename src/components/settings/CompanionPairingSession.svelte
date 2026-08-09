<script lang="ts">
  import QRCode from 'qrcode'
  import { onMount } from 'svelte'
  import {
    approveCompanionPairing,
    cancelCompanionPairing,
    getCompanionPairingStatus,
    rejectCompanionPairing,
    startCompanionPairing,
  } from '../../lib/ipc'
  import type { CompanionPairingSession } from '../../lib/types'

  interface Props {
    gatewayEnabled: boolean
    gatewayRunning: boolean
    refreshGeneration: number
    updating: boolean
    onupdatingchange: (updating: boolean) => void
    onfeedback: (message: string | null) => void
    onerror: (message: string | null) => void
    ondeviceschanged: () => Promise<void>
  }

  let {
    gatewayEnabled,
    gatewayRunning,
    refreshGeneration,
    updating,
    onupdatingchange,
    onfeedback,
    onerror,
    ondeviceschanged,
  }: Props = $props()

  let pairing = $state<CompanionPairingSession | null>(null)
  let qrDataUrl = $state<string | null>(null)
  let pairingGeneration = 0

  function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error)
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
    if (!gatewayEnabled) {
      await applyPairing(null)
      return
    }
    const generation = ++pairingGeneration
    const nextPairing = await getCompanionPairingStatus()
    await applyPairing(nextPairing, generation)
  }

  async function startPairing() {
    onupdatingchange(true)
    onerror(null)
    onfeedback(null)
    try {
      await applyPairing(await startCompanionPairing())
    } catch (error) {
      onerror(errorMessage(error))
    } finally {
      onupdatingchange(false)
    }
  }

  async function cancelPairing() {
    if (!pairing) return
    onupdatingchange(true)
    onerror(null)
    try {
      await cancelCompanionPairing(pairing.sessionId)
      await applyPairing(null)
      onfeedback('Pairing cancelled.')
    } catch (error) {
      onerror(errorMessage(error))
    } finally {
      onupdatingchange(false)
    }
  }

  async function decidePairing(decision: 'approve' | 'reject') {
    const pending = pairing?.pendingRequest
    if (!pending) return
    onupdatingchange(true)
    onerror(null)
    try {
      if (decision === 'approve') {
        await approveCompanionPairing(pending.requestId)
        onfeedback(`Device approved: ${pending.deviceName}`)
        if (pairing) {
          await applyPairing({
            ...pairing,
            pendingRequest: null,
            deliveryPending: true,
          })
        }
      } else {
        await rejectCompanionPairing(pending.requestId)
        onfeedback(`Device rejected: ${pending.deviceName}`)
        await applyPairing(null)
      }
      await ondeviceschanged()
    } catch (error) {
      onerror(errorMessage(error))
    } finally {
      onupdatingchange(false)
    }
  }

  $effect(() => {
    gatewayEnabled
    refreshGeneration
    void refreshPairing().catch((error) => {
      onerror(errorMessage(error))
    })
  })

  onMount(() => {
    const interval = window.setInterval(() => {
      if (gatewayEnabled && !updating) {
        void refreshPairing().catch((error) => {
          onerror(errorMessage(error))
        })
      }
    }, 1000)
    return () => window.clearInterval(interval)
  })
</script>

{#if gatewayRunning}
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
        <div class="mt-1 text-sm text-base-content/70">
          {platformLabel(pairing.pendingRequest.platform)} · Awaiting your approval
        </div>
        <p class="m-0 mt-2 text-xs text-base-content/70">
          Approval lets this phone Start backlog Tasks with saved defaults, Delete or Complete Tasks, and type into
          running Agent terminals as your desktop user.
        </p>
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
