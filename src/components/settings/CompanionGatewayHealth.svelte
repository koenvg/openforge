<script lang="ts">
  import type { CompanionGatewayPhase, CompanionGatewayStatus } from '../../lib/types'

  interface Props {
    status: CompanionGatewayStatus
    updating: boolean
    ontoggle: () => void
  }

  let { status, updating, ontoggle }: Props = $props()

  function phaseLabel(phase: CompanionGatewayPhase): string {
    switch (phase) {
      case 'disabled': return 'Disabled'
      case 'starting': return 'Starting'
      case 'running': return 'Running'
      case 'error': return 'Error'
      case 'stopped': return 'Stopped'
    }
  }
</script>

<div class="flex flex-wrap items-center justify-between gap-3">
  <div>
    <div class="text-sm font-medium">Gateway health</div>
    <div class="text-sm text-base-content/70" aria-live="polite">{phaseLabel(status.phase)}</div>
  </div>
  <button
    type="button"
    class="btn {status.enabled ? 'btn-outline btn-error' : 'btn-primary'} btn-sm"
    disabled={updating}
    onclick={ontoggle}
  >
    {status.enabled ? 'Disable Companion Gateway' : 'Enable Companion Gateway'}
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
