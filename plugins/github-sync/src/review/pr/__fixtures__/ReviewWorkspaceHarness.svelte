<script lang="ts">
  import { untrack } from 'svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import { createReviewWorkspace, type ReviewWorkspace } from '../reviewWorkspace.svelte'

  let { api, projectId = 'project-1', onWorkspace }: {
    api: FrontendOpenForgeAPI
    projectId?: string | null
    onWorkspace: (workspace: ReviewWorkspace) => void
  } = $props()

  const workspace = untrack(() => createReviewWorkspace(api, () => ({ projectId, projectName: 'Demo' })))
  untrack(() => onWorkspace(workspace))
</script>
