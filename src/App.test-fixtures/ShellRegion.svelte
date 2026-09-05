<script lang="ts">
  let { label, collapsed = false, onToggleCollapse, onNewProject }: {
    label: string
    collapsed?: boolean
    onToggleCollapse?: () => void
    onNewProject?: () => void
  } = $props()
</script>

<section aria-label={label}>
  <span>{label}</span>
  {#if onToggleCollapse}
    <button onclick={onToggleCollapse}>{collapsed ? 'Expand sidebar' : 'Collapse sidebar'}</button>
  {/if}
  {#if onNewProject}<button onclick={onNewProject}>New project</button>{/if}
</section>
