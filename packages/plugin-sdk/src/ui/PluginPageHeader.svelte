<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle?: string | null
    surface?: 'default' | 'subtle'
    headingLevel?: 'h1' | 'h2'
    actions?: Snippet
  }

  let {
    title,
    subtitle = null,
    surface = 'default',
    headingLevel = 'h1',
    actions,
  }: Props = $props()
</script>

<header class="flex min-h-13 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-base-300 px-4 py-2 sm:px-6 {surface === 'default' ? 'bg-base-100' : 'bg-base-200'}">
  <div class="min-w-0">
    <svelte:element this={headingLevel} class="m-0 truncate text-base font-semibold leading-5 tracking-[-0.01em] text-base-content">{title}</svelte:element>
    {#if subtitle}
      <p class="m-0 mt-0.5 truncate text-[13px] leading-5 text-base-content/60">{subtitle}</p>
    {/if}
  </div>
  {#if actions}
    <div class="shrink-0">
      {@render actions()}
    </div>
  {/if}
</header>
