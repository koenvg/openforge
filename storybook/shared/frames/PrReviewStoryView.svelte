<script lang="ts">
  import { onMount } from 'svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import PrReviewView from '../../../plugins/github-sync/src/review/pr/PrReviewView.svelte'

  let { api, context, projectId = null }: {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    projectId?: string | null
  } = $props()
  let ready = $state(false)

  onMount(() => {
    let active = true
    void Promise.all([
      api.config.set('github_token', 'story-only-token'),
      ...(projectId ? [api.projectConfig.set('resolved_repo', 'openforge/openforge', projectId)] : []),
    ]).then(() => {
      if (active) ready = true
    })
    return () => { active = false }
  })
</script>

{#if ready}
  <PrReviewView {api} {context} projectName="OpenForge" {projectId} />
{/if}
