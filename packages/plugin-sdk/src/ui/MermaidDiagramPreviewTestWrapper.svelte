<script lang="ts">
  import MermaidDiagramPreview from './MermaidDiagramPreview.svelte'

  interface Props {
    svg: string
  }

  let { svg }: Props = $props()
  let open = $state(false)
</script>

<button type="button" onclick={() => { open = true }}>Open diagram</button>

{#if open}
  <MermaidDiagramPreview {svg} onClose={() => { open = false }} />
{/if}
