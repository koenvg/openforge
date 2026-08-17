<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle?: string | null
    surface?: 'default' | 'subtle'
    actions?: Snippet
  }

  let { title, subtitle = null, surface = 'subtle', actions }: Props = $props()
</script>

<header class="flex items-center justify-between gap-4 border-b border-base-300 px-6 py-3 shrink-0 {surface === 'default' ? 'bg-base-100' : 'bg-base-200'}">
  <div class="min-w-0">
    <h2 class="text-[22px] font-semibold text-base-content tracking-tight m-0 truncate">{title}</h2>
    {#if subtitle}
      <p class="text-[13px] text-secondary mt-0.5 m-0 truncate">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="shrink-0">
      {@render actions()}
    </div>
  {/if}
</header>
