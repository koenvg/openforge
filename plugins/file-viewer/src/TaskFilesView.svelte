<script lang="ts">
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import FilesView from './FilesView.svelte'
  import { createTaskWorkspaceSource } from './lib/workspaceSource'

  import { onDestroy } from 'svelte'
  import type { Disposable } from '@openforge-app/plugin-sdk'
  interface Props {
    api: FrontendOpenForgeAPI
    context: OpenForgeContextSnapshot
    taskId: string
  }

  let { api, context, taskId }: Props = $props()
  let documentRevision = $state(0)
  let subscription: Disposable | undefined
  let subscribedApi: FrontendOpenForgeAPI | undefined
  let subscribedProject: string | null | undefined
  const workspaceSource = $derived(createTaskWorkspaceSource(api, taskId, documentRevision))

  // A host task invalidation can replace the workspace without changing taskId.
  // Dispose by explicit subscription identity, not prop-keyed effect cleanup.
  $effect(() => {
    const projectId = context.projectId
    if (subscribedApi === api && subscribedProject === projectId) return
    subscription?.dispose()
    subscription = undefined
    subscribedApi = api
    subscribedProject = projectId
    if (projectId && api.tasks?.onDidChange) {
      subscription = api.tasks.onDidChange(projectId, event => {
        if ((event.taskId === null || event.taskId === taskId) && event.reason !== 'attention') documentRevision++
      })
    }
  })
  onDestroy(() => { subscription?.dispose(); subscription = undefined })
</script>

<FilesView
  {api}
  {context}
  projectName=""
  projectId={null}
  {workspaceSource}
  rootErrorTitle="Failed to load live worktree"
  sourceLabel="Live worktree"
  workspaceLoadingLabel="Loading live worktree files…"
  rootRetryLabel="Retry loading live worktree"
/>
