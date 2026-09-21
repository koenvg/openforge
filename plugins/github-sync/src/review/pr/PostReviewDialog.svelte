<script lang="ts">
  import type { ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Alert from '@openforge-app/plugin-sdk/ui/Alert.svelte'

  // Shown right after an in-app review is submitted. Removal is never automatic, so
  // this is where a reviewer clears the PR once they're done with it. Dismissing the
  // dialog (escape/overlay) keeps the PR, the non-destructive default.
  let { pr, trackingError = null, onKeep, onRemove }: {
    pr: ReviewPullRequest
    trackingError?: string | null
    onKeep: () => void
    onRemove: () => void
  } = $props()
</script>

<Modal onClose={onKeep} ariaLabel="You reviewed this pull request" maxWidth="28rem">
  {#snippet header()}
    <h2 class="m-0 text-base font-semibold text-base-content">You reviewed this pull request</h2>
  {/snippet}
  <div class="flex flex-col gap-4 p-5">
    <p class="m-0 text-sm text-base-content/70">
      Your review of
      <span class="font-medium text-base-content">{pr.repo_owner}/{pr.repo_name} #{pr.number}</span>
      was submitted. Keep it in your list, or remove it now that you're done?
    </p>
    {#if trackingError}
      <Alert variant="warning" role="status" aria-live="polite">{trackingError}</Alert>
    {:else}
      <p class="m-0 text-sm text-base-content/70">
        If you keep it, it will move to the collapsed Reviewed group until new commits arrive.
      </p>
    {/if}
    <div class="flex justify-end gap-2">
      <Button variant="ghost" size="sm" onclick={onKeep}>Keep in my list</Button>
      <Button size="sm" onclick={onRemove}>Remove from my list</Button>
    </div>
  </div>
</Modal>
