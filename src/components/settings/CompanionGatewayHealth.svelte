<script lang="ts">
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
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
    <div class="text-sm text-[var(--of-text-secondary)]" aria-live="polite">{phaseLabel(status.phase)}</div>
  </div>
  <Button
    type="button"
    variant={status.enabled ? 'danger' : 'primary'} size="sm"
    disabled={updating}
    onclick={ontoggle}
  >
    {status.enabled ? 'Disable Companion Gateway' : 'Enable Companion Gateway'}
  </Button>
</div>

{#if status.error}
  <Panel padding="none" variant="subtle">
    <div role="alert" class="flex items-center gap-3 p-3 text-sm">
      <Badge variant="danger">Error</Badge>
      <span>{status.error}</span>
    </div>
  </Panel>
{/if}

{#if status.endpoints.length > 0}
  <div class="flex flex-col gap-2">
    <div class="text-sm font-medium">Offered endpoints</div>
    <ul class="m-0 flex list-none flex-col gap-2 p-0">
      {#each status.endpoints as endpoint (endpoint.url)}
        <li><Panel padding="none"><div class="flex flex-wrap items-center justify-between gap-3 p-3">
          <Badge variant="neutral">{endpoint.kind === 'tailscale' ? 'Tailscale' : 'LAN'}</Badge>
          <code class="break-all text-xs">{endpoint.url}</code>
        </div>
        </Panel></li>
      {/each}
    </ul>
  </div>
{/if}

{#if status.hostId}
  <details class="text-sm text-[var(--of-text-secondary)]">
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
