<script lang="ts">
  import { untrack } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import PrReviewDetailSection from './PrReviewDetailSection.svelte'
  import PrReviewListSection from './PrReviewListSection.svelte'
  import { createReviewWorkspace } from './reviewWorkspace.svelte'

  let { api, projectName, projectId = null }: {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId?: string | null
  } = $props()

  const workspace = untrack(() => createReviewWorkspace(api, () => ({ projectId, projectName })))
</script>

<svelte:window onkeydown={workspace.handleKeydown} />

<div class="flex flex-col w-full h-full min-h-0 overflow-hidden">
  {#if workspace.detail}
    <PrReviewDetailSection {...workspace.detail} />
  {:else}
    <PrReviewListSection {...workspace.list} />
  {/if}
</div>
