<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    subtitle: string
    actions?: Snippet
  }

  let { title, subtitle, actions }: Props = $props()
</script>

<header class="flex shrink-0 flex-col gap-3 border-b border-of-border bg-of-surface px-4 py-4 sm:px-6 xl:flex-row xl:items-center xl:justify-between">
  <div class="min-w-0">
    <h1 class="m-0 text-xl font-semibold tracking-tight text-of-text sm:text-[1.4rem]">{title}</h1>
    <p class="m-0 mt-1 text-sm leading-5 text-of-text/60">{subtitle}</p>
  </div>
  {#if actions}
    <div class="shrink-0">
      {@render actions()}
    </div>
  {/if}
</header>
