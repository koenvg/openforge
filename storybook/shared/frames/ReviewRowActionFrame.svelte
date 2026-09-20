<script lang="ts">
  import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import type { Snippet } from 'svelte'
  import ReviewPrCard from '../../../packages/pr-review-ui/src/ReviewPrCard.svelte'

  let { children, pr }: { children: Snippet; pr: ReviewPullRequest } = $props()
</script>

<div class="flex-1 overflow-auto p-6">
  <div class="mx-auto w-full max-w-2xl" aria-label="Pull request review row">
    <ReviewPrCard {pr} onClick={() => {}}>
      {#snippet footer()}{@render children()}{/snippet}
    </ReviewPrCard>
  </div>
</div>
