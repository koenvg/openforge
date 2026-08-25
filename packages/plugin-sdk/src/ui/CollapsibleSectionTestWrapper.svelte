<script lang="ts">
  import CollapsibleSection from './CollapsibleSection.svelte'

  interface Props {
    sectionKey: string
    title: string
    label?: string
    cardId?: string
    withActions?: boolean
    body?: string
  }

  let { sectionKey, title, label, cardId, withActions = false, body = 'Section body content' }: Props = $props()
</script>

{#if withActions}
  <CollapsibleSection {sectionKey} {title} {label} {cardId}>
    {#snippet actions()}
      <button type="button">Section action</button>
    {/snippet}
    <p>{body}</p>
  </CollapsibleSection>
{:else}
  <CollapsibleSection {sectionKey} {title} {label} {cardId}>
    <p>{body}</p>
  </CollapsibleSection>
{/if}
