<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    header: Snippet
    children: Snippet
    class?: string
  }

  let { header, children, class: className = '' }: Props = $props()
</script>

<div class="of-plugin-page-shell {className}">
  <div class="of-plugin-page-shell-header">{@render header()}</div>
  <div class="of-plugin-page-shell-body">{@render children()}</div>
</div>

<style>
  .of-plugin-page-shell { display: flex; height: 100%; min-height: 0; flex-direction: column; overflow: hidden; background: var(--of-surface); color: var(--of-text); }
  .of-plugin-page-shell-header { flex-shrink: 0; }
  .of-plugin-page-shell-body { display: flex; min-height: 0; flex: 1; flex-direction: column; overflow: hidden; }
</style>
