<script lang="ts">
  import CollapsibleSection from '@openforge-app/plugin-sdk/ui/CollapsibleSection.svelte'
  import { pluginSectionKey } from '@openforge-app/plugin-sdk/collapsibleSectionState'

  let { title = 'SDK spacing contract' }: { title?: string } = $props()
  const pluginId = 'com.openforge.sdk-spacing-contract'
</script>

<CollapsibleSection sectionKey={pluginSectionKey(pluginId, title)} {title} cardId="sdk-spacing-contract">
  <p>SDK spacing body</p>
</CollapsibleSection>
