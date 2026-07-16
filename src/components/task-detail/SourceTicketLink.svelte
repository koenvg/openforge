<script lang="ts">
  import { Ticket, ExternalLink } from '@lucide/svelte'
  import { openUrl } from '../../lib/ipc'
  import { getSourceTicketLink } from '../../lib/sourceTicket'

  interface Props {
    url: string | null
  }

  let { url }: Props = $props()

  const link = $derived(getSourceTicketLink(url))

  function handleOpen() {
    if (link?.clickable) {
      void openUrl(link.url)
    }
  }
</script>

{#if link}
  <section
    data-task-info-card="source-ticket"
    data-card-sizing="natural"
    class="flex items-center gap-2 rounded-lg border border-base-300/70 bg-base-100 px-3 py-2 shrink-0"
    aria-label="Source ticket"
  >
    <Ticket size={14} class="shrink-0 text-base-content/50" aria-hidden="true" />
    <span class="text-xs text-base-content/55 shrink-0">Ticket</span>
    {#if link.clickable}
      <button
        type="button"
        class="btn btn-ghost btn-xs h-auto min-h-0 gap-1 px-1 font-normal text-primary"
        onclick={handleOpen}
        title={link.url}
        aria-label="Open source ticket {link.label}"
      >
        <span class="truncate">{link.label}</span>
        <ExternalLink size={12} class="shrink-0" aria-hidden="true" />
      </button>
    {:else}
      <span class="truncate text-xs text-base-content/70" title={link.url}>{link.label}</span>
    {/if}
  </section>
{/if}
