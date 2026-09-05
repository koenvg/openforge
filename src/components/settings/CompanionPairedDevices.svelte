<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import type { CompanionPairedDevice } from '../../lib/types'

  interface Props {
    devices: CompanionPairedDevice[]
    updating: boolean
    onrevoke: (device: CompanionPairedDevice) => void
    onremove: (device: CompanionPairedDevice) => void
  }

  let { devices, updating, onrevoke, onremove }: Props = $props()

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
    <p class="m-0 text-xs text-[var(--of-text-muted)]">
      Paired devices can Create backlog Tasks from a prompt, Start backlog Tasks with saved defaults, Delete or Complete Tasks, and type into running Agent terminals as your desktop user until revoked. Existing paired devices inherit this fixed authority without reapproval or credential migration.
    </p>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {#each devices as device (device.deviceId)}
        <li><Panel padding="none"><div class="flex flex-wrap items-center justify-between gap-3 p-3">
          <div class="settings-layout min-w-0 flex-1">
            <div class="text-sm font-medium">{device.deviceName}</div>
            <div class="text-xs text-[var(--of-text-muted)]">{platformLabel(device.platform)}</div>
            <dl class="mt-1 grid gap-0.5 text-xs text-[var(--of-text-muted)]">
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
            <div class="flex items-center gap-2">
              <Badge variant="danger">Revoked</Badge>
              <Button
                type="button"
                variant="danger" size="sm"
                disabled={updating}
                aria-label={`Remove ${device.deviceName}`}
                onclick={() => onremove(device)}
              >Remove</Button>
            </div>
          {:else}
            <Button
              type="button"
              variant="danger" size="sm"
              disabled={updating}
              aria-label={`Revoke ${device.deviceName}`}
              onclick={() => onrevoke(device)}
            >Revoke</Button>
          {/if}
        </div>
        </Panel></li>
      {/each}
    </ul>
  </section>
{/if}
