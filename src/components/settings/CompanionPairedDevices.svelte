<script lang="ts">
  import type { CompanionPairedDevice } from '../../lib/types'

  interface Props {
    devices: CompanionPairedDevice[]
    updating: boolean
    onrevoke: (device: CompanionPairedDevice) => void
  }

  let { devices, updating, onrevoke }: Props = $props()

  function platformLabel(platform: 'ios' | 'android'): string {
    return platform === 'ios' ? 'iOS' : 'Android'
  }

  function formattedDate(value: string): string {
    return new Date(value).toLocaleString()
  }
</script>

{#if devices.length > 0}
  <section class="flex flex-col gap-2" aria-labelledby="paired-devices-heading">
    <h3 id="paired-devices-heading" class="m-0 text-sm font-medium">Paired devices</h3>
    <p class="m-0 text-xs text-base-content/60">
      Paired devices can type into running Agent terminals as your desktop user until revoked.
    </p>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {#each devices as device (device.deviceId)}
        <li class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-base-300 px-3 py-2">
          <div class="min-w-0 flex-1">
            <div class="text-sm font-medium">{device.deviceName}</div>
            <div class="text-xs text-base-content/60">{platformLabel(device.platform)}</div>
            <dl class="mt-1 grid gap-0.5 text-xs text-base-content/60">
              <div class="flex flex-wrap gap-1">
                <dt class="font-medium">Device ID</dt>
                <dd class="m-0 break-all font-mono">{device.deviceId}</dd>
              </div>
              <div class="flex flex-wrap gap-1">
                <dt class="font-medium">Paired</dt>
                <dd class="m-0">{formattedDate(device.pairedAt)}</dd>
              </div>
              <div class="flex flex-wrap gap-1">
                <dt class="font-medium">Last seen</dt>
                <dd class="m-0">{device.lastSeenAt ? formattedDate(device.lastSeenAt) : 'never'}</dd>
              </div>
              {#if device.revokedAt}
                <div class="flex flex-wrap gap-1">
                  <dt class="font-medium">Revoked</dt>
                  <dd class="m-0">{formattedDate(device.revokedAt)}</dd>
                </div>
              {/if}
            </dl>
          </div>
          {#if device.revokedAt}
            <span class="badge badge-error badge-outline">Revoked</span>
          {:else}
            <button
              type="button"
              class="btn btn-ghost btn-sm text-error"
              disabled={updating}
              aria-label={`Revoke ${device.deviceName}`}
              onclick={() => onrevoke(device)}
            >Revoke</button>
          {/if}
        </li>
      {/each}
    </ul>
  </section>
{/if}
