<script lang="ts">
  import type { Snippet } from 'svelte'
  import type { StoryScenario } from './storyEnvironmentPreview'

  let { scenario, children }: { scenario: StoryScenario; children: Snippet } = $props()
</script>

{#key scenario}
  {@render children()}
{/key}
