<script lang="ts">
  import type { Snippet } from 'svelte'

  let {
    ready = true,
    zen = false,
    sidebar,
    projectNavigation,
    children,
    dialogs,
    overlays,
  }: {
    ready?: boolean
    zen?: boolean
    sidebar: Snippet
    projectNavigation?: Snippet
    children: Snippet
    dialogs?: Snippet
    overlays?: Snippet
  } = $props()
</script>

<div
  class="of-application-shell flex h-screen overflow-hidden"
  style:opacity={ready ? 1 : 0}
  inert={!ready}
  data-app-ready={ready}
>
  {#if !zen}
    {@render sidebar()}
    {@render projectNavigation?.()}
  {/if}
  <div class="flex flex-col flex-1 min-w-0 relative">
    <main class="flex-1 overflow-hidden flex">
      <div class="flex-1 overflow-hidden flex flex-col">
        {@render children()}
        {@render dialogs?.()}
      </div>
    </main>
  </div>
</div>

{@render overlays?.()}

<style>
  .of-application-shell {
    background: var(--of-canvas);
    color: var(--of-text);
  }
</style>
