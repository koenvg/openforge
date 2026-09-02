<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import FilesView from './FilesView.svelte'
  import { createTaskWorkspaceSource } from './lib/workspaceSource'

  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    taskId: string
  }

  let { api, context, taskId }: Props = $props()
  const workspaceSource = $derived(createTaskWorkspaceSource(api, taskId))
</script>

<FilesView
  {api}
  {context}
  projectName=""
  projectId={null}
  {workspaceSource}
  rootErrorTitle="Failed to load live worktree"
  workspaceLoadingLabel="Loading live worktree files…"
  rootRetryLabel="Retry loading live worktree"
/>
