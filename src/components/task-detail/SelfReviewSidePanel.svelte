<script lang="ts">
  import { FileText, MessageSquare } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Tabs from '@openforge-app/plugin-sdk/ui/Tabs.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import SelfReviewChangedFilesPanel from './SelfReviewChangedFilesPanel.svelte'
  import SelfReviewFeedbackPanel from './SelfReviewFeedbackPanel.svelte'
  import type { SelfReviewWorkspaceController } from './selfReviewWorkspaceController.svelte'

  interface Props {
    controller: SelfReviewWorkspaceController
    availableWidth?: number
  }

  let { controller, availableWidth }: Props = $props()
  let changedFilesPanel = $state<SelfReviewChangedFilesPanel>()
  let githubCommentCount = $derived(controller.feedbackPane.pullRequest.comments.length)

  export function focusTree(): void {
    changedFilesPanel?.focusTree()
  }
</script>

{#snippet changedFilesTabIcon()}
  <FileText size={16} strokeWidth={1.8} />
{/snippet}

{#snippet githubCommentsTabIcon()}
  <MessageSquare size={16} strokeWidth={1.8} />
{/snippet}

{#snippet githubCommentsTabCount()}
  <Badge class="self-review-comment-count" variant="neutral" aria-hidden="true">{githubCommentCount}</Badge>
{/snippet}

<ResizablePanel storageKey="self-review-side-panel" defaultWidth={320} minWidth={240} maxWidth={520} {availableWidth} side="left" label="Review">
  <div class="flex h-full min-w-0 flex-col overflow-hidden border-r border-of-border bg-of-surface">
    <Tabs
      label="Review navigation"
      tabs={[
        { value: 'files', label: 'Changed files', icon: changedFilesTabIcon, title: 'Changed files' },
        { value: 'github-comments', label: githubCommentCount
          ? `GitHub comments (${githubCommentCount})` : 'GitHub comments', icon: githubCommentsTabIcon,
          trailing: githubCommentCount > 0 ? githubCommentsTabCount : undefined, title: 'GitHub comments' },
      ]}
      value={controller.sidePanelTab}
      onValueChange={(value) => controller.selectSidePanelTab(value === 'files' ? 'files' : 'github-comments')}
      fill
      attached
    >
      {#snippet children(value)}
        {#if value === 'files'}
          <SelfReviewChangedFilesPanel bind:this={changedFilesPanel} pane={controller.changedFilesPane} />
        {:else}
          <SelfReviewFeedbackPanel pane={controller.feedbackPane} />
        {/if}
      {/snippet}
    </Tabs>
  </div>
</ResizablePanel>

<style>
  :global(.self-review-comment-count) {
    min-width: var(--of-space5);
    min-height: var(--of-space5);
    justify-content: center;
    padding: 0 var(--of-space1);
    font-family: var(--of-font-mono);
    font-size: var(--of-text-xs);
    line-height: 1;
    white-space: nowrap;
  }
</style>
