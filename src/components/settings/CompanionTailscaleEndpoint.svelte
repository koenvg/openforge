<script lang="ts">
  import type { CompanionTailscaleStatus } from '../../lib/types'

  interface Props {
    status: CompanionTailscaleStatus
    updating: boolean
    onsave: (hostname: string) => void
  }

  let { status, updating, onsave }: Props = $props()
  let hostname = $state('')
  let lastSuggestion = $state<string | null>(null)

  $effect(() => {
    const suggestion = status.configuredHostname ?? status.detectedHostname ?? ''
    if (suggestion !== lastSuggestion) {
      hostname = suggestion
      lastSuggestion = suggestion
    }
  })

  function submit(event: SubmitEvent) {
    event.preventDefault()
    const normalized = hostname.trim()
    if (normalized && !updating) onsave(normalized)
  }
</script>

<section class="flex flex-col gap-3" aria-labelledby="tailscale-endpoint-heading">
  <div class="flex flex-wrap items-start justify-between gap-2">
    <div>
      <h3 id="tailscale-endpoint-heading" class="m-0 text-sm font-medium">Tailscale remote access</h3>
      <p class="m-0 mt-1 text-sm text-base-content/70">
        {#if status.detectedHostname}
          Detected a stable MagicDNS hostname on this Mac. Confirm it or enter a correction.
        {:else}
          Local detection is unavailable or ambiguous. Enter this Mac's full MagicDNS hostname.
        {/if}
      </p>
    </div>
    {#if status.configuredHostname}
      <span class="badge badge-success badge-sm">Confirmed</span>
    {:else if status.detectedHostname}
      <span class="badge badge-warning badge-sm">Needs confirmation</span>
    {/if}
  </div>

  <form class="flex flex-col gap-2 sm:flex-row sm:items-end" onsubmit={submit}>
    <label class="form-control min-w-0 flex-1">
      <span class="label-text mb-1 text-sm">Tailscale MagicDNS hostname</span>
      <input
        class="input input-bordered min-h-11 w-full font-mono text-sm"
        type="text"
        bind:value={hostname}
        placeholder="openforge-mac.your-tailnet.ts.net"
        autocomplete="off"
        autocapitalize="none"
        spellcheck="false"
        aria-describedby="tailscale-hostname-help"
      />
    </label>
    <button type="submit" class="btn btn-primary min-h-11" disabled={updating || !hostname.trim()}>
      {updating ? 'Saving…' : 'Save Tailscale hostname'}
    </button>
  </form>

  <p id="tailscale-hostname-help" class="m-0 text-xs leading-relaxed text-base-content/60">
    OpenForge uses this hostname only as a candidate for the existing pinned TLS identity and device credential. It never receives Tailscale account credentials.
  </p>
  <p class="m-0 text-xs leading-relaxed text-base-content/60">
    OpenForge operates no central server or relay. Tailscale remains user-selected network infrastructure.
  </p>
</section>
