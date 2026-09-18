<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import PrReviewView from '../PrReviewView.svelte'

  let { api, context, projectName, projectId }: {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectName: string
    projectId: string
  } = $props()
</script>

<svelte:boundary>
  {#snippet failed(error)}
    <div role="alert">{error instanceof Error ? error.message : String(error)}</div>
  {/snippet}
  <PrReviewView {api} {context} {projectName} {projectId} />
</svelte:boundary>
