<script lang="ts">
  import { onDestroy, untrack, type ComponentProps } from 'svelte'
  import type { FrontendOpenForgeAPI } from '@openforge-app/plugin-sdk/frontend'
  import { createOpenForgeRegistryFake } from '@openforge-app/plugin-sdk/testing'
  import type { GithubSyncPrReviewClient } from '../githubSyncClient'
  import { createReviewWorkspace } from '../reviewWorkspace.svelte'
  import WalkthroughTab from '../WalkthroughTab.svelte'

  let props: Omit<ComponentProps<typeof WalkthroughTab>, 'workspace'> & {
    api: FrontendOpenForgeAPI
    githubSync: GithubSyncPrReviewClient
    projectId: string | null
  } = $props()

  const registry = createOpenForgeRegistryFake({ pluginId: 'com.openforge.github-sync' })
  const backend = registry.backendApi.backend
  backend.registerMethod('getReviewPrs', { handler: async () => [] })
  backend.registerMethod('getAuthoredPrs', { handler: async () => [] })
  backend.registerMethod('markReviewPrViewed', { handler: async () => {} })
  backend.registerMethod('getPrFileDiffs', { handler: async () => props.files })
  backend.registerMethod('getReviewComments', { handler: async () => props.existingComments })
  backend.registerMethod('getPrAiReviewComments', { handler: async () => props.agentComments })
  backend.registerMethod('getAiThreads', { handler: async () => props.aiThreads ?? [] })
  backend.registerMethod('getPrWalkthrough', { handler: async (request) => props.githubSync.getPrWalkthrough(request as Parameters<GithubSyncPrReviewClient['getPrWalkthrough']>[0]) })
  backend.registerMethod('getPrTicket', { handler: async (request) => props.githubSync.getPrTicket?.(request as Parameters<GithubSyncPrReviewClient['getPrTicket']>[0]) ?? { snapshot: null, jiraConfigured: false } })
  backend.registerMethod('setPrJiraKey', { handler: async (request) => props.githubSync.setPrJiraKey(request as Parameters<GithubSyncPrReviewClient['setPrJiraKey']>[0]) })
  backend.registerMethod('startAgentWalkthrough', { handler: async (request) => props.githubSync.startAgentWalkthrough(request as Parameters<GithubSyncPrReviewClient['startAgentWalkthrough']>[0]) })
  backend.registerMethod('abortAgentWalkthrough', { handler: async (request) => props.githubSync.abortAgentWalkthrough(request as Parameters<GithubSyncPrReviewClient['abortAgentWalkthrough']>[0]) })
  backend.registerMethod('deletePrWalkthrough', { handler: async (request) => props.githubSync.deletePrWalkthrough(request as Parameters<GithubSyncPrReviewClient['deletePrWalkthrough']>[0]) })

  const workspace = createReviewWorkspace(registry.frontendApi, () => ({ projectId: props.projectId, projectName: 'Demo' }))
  $effect(() => {
    const pr = props.pr
    untrack(() => { void workspace.list.onSelectPr(pr).then(() => workspace.detail?.onActiveTabChange('walkthrough')) })
  })
  onDestroy(() => workspace.detail?.onBackToList())
</script>

{#if workspace.detail}
  <WalkthroughTab {...props} workspace={workspace.detail.walkthrough} />
{/if}
