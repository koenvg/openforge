<script lang="ts">
  import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import type { Snippet } from 'svelte'
  import type { TaskDetail } from '../../../src/lib/types'
  import PageFrame from './PageFrame.svelte'
  import ReviewRowActionFrame from './ReviewRowActionFrame.svelte'
  import SettingsFrame from './SettingsFrame.svelte'
  import StatusFrame from './StatusFrame.svelte'

  type Host = 'settings' | 'review-row' | 'task-status'

  let { children, host, pr, task }: {
    children: Snippet
    host: Host
    pr?: ReviewPullRequest
    task?: TaskDetail
  } = $props()
</script>

<PageFrame currentView={host === 'settings' ? 'global_settings' : host === 'review-row' ? 'attention' : 'task-detail'}>
  {#if host === 'settings'}
    <SettingsFrame
      title="GitHub Sync"
      description="Integration-owned settings appear inside the enabled plugin card."
    >
      {@render children()}
    </SettingsFrame>
  {:else if host === 'review-row' && pr}
    <ReviewRowActionFrame {pr}>{@render children()}</ReviewRowActionFrame>
  {:else if host === 'task-status' && task}
    <StatusFrame {task}>{@render children()}</StatusFrame>
  {/if}
</PageFrame>
