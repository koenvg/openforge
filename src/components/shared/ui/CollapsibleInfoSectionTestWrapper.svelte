<script lang="ts">
  import CollapsibleInfoSection from './CollapsibleInfoSection.svelte'

  interface Props {
    sectionKey: string
    title: string
    label?: string
    cardId?: string
    withActions?: boolean
  }

  let { sectionKey, title, label, cardId, withActions = false }: Props = $props()
</script>

{#if withActions}
  <CollapsibleInfoSection {sectionKey} {title} {label} {cardId}>
    {#snippet actions()}
      <button type="button">Section action</button>
    {/snippet}
    <p>Section body content</p>
  </CollapsibleInfoSection>
{:else}
  <CollapsibleInfoSection {sectionKey} {title} {label} {cardId}>
    <p>Section body content</p>
  </CollapsibleInfoSection>
{/if}
