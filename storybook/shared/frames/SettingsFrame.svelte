<script lang="ts">
  import type { Snippet } from 'svelte'
  import SettingsSectionCard from '../../../src/components/settings/SettingsSectionCard.svelte'

  let { children, title, description }: { children: Snippet; title: string; description?: string } = $props()
</script>

<div class="flex-1 overflow-y-auto p-6">
  <div class="mx-auto w-full max-w-5xl space-y-6">
    <SettingsSectionCard {title} {description} {children} />
  </div>
</div>
