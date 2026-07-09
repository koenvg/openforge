<script lang="ts">
  import { ExternalLink, Copy } from '@lucide/svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { BoardCard } from '../lib/board'
  import type { RepoLabel } from '../lib/types'

  interface Props {
    card: BoardCard
    repo: string
    allLabels: RepoLabel[]
    busy: boolean
    onClose: () => void
    onOpenUrl: (url: string) => void
    onCopyLink: (issueNumber: number) => void
    onSaveText: (title: string, body: string) => void
    onSetValue: (value: number | null) => void
    onToggleLabel: (name: string, currentlyOn: boolean) => void
    onCloseIssue: () => void
    onOpenTask: (taskId: string) => void
  }

  let {
    card,
    repo,
    allLabels,
    busy,
    onClose,
    onOpenUrl,
    onCopyLink,
    onSaveText,
    onSetValue,
    onToggleLabel,
    onCloseIssue,
    onOpenTask,
  }: Props = $props()

  // Editable copies, re-seeded only when the open issue's identity changes (via the
  // $effect below) so an in-progress edit isn't clobbered by a parent board refresh.
  // svelte-ignore state_referenced_locally
  let title = $state(card.title)
  // svelte-ignore state_referenced_locally
  let body = $state(card.body ?? '')
  let editingBody = $state(false)
  // svelte-ignore state_referenced_locally
  let lastIssueNumber = $state(card.issueNumber)

  $effect(() => {
    if (card.issueNumber !== lastIssueNumber) {
      lastIssueNumber = card.issueNumber
      title = card.title
      body = card.body ?? ''
      editingBody = false
    }
  })

  let issueUrl = $derived(`https://github.com/${repo}/issues/${card.issueNumber}`)
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  const HEX6 = /^[0-9a-fA-F]{6}$/
  function chipStyle(color: string): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color}33; border-color: #${color};`
  }

</script>

<Modal ariaLabel={`Issue #${card.issueNumber}`} closeLabel="Close" maxWidth="42rem" {onClose}>
  {#snippet header()}
    <h3 class="text-base font-semibold m-0">#{card.issueNumber}</h3>
    <div class="flex items-center gap-2">
      <button class="btn btn-sm" type="button" onclick={() => onOpenUrl(issueUrl)}>
        <ExternalLink size={14} /> Open on GitHub
      </button>
      {#if card.taskLink}
        <button
          class="btn btn-sm"
          type="button"
          aria-label={`Open task details ${card.taskLink.taskId}`}
          onclick={() => onOpenTask(card.taskLink.taskId)}
        >
          Open task details {card.taskLink.taskId}
        </button>
      {/if}
      <button class="btn btn-sm" type="button" onclick={() => onCopyLink(card.issueNumber)}>
        <Copy size={14} /> Copy link
      </button>
    </div>
  {/snippet}

    <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      <div class="flex flex-col gap-2">
        <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="drawer-title">Title</label>
        <input id="drawer-title" class="input input-bordered input-sm w-full" bind:value={title} />
      </div>

      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="drawer-body">Body</label>
          <button class="btn btn-ghost btn-xs" type="button" onclick={() => (editingBody = !editingBody)}>
            {editingBody ? 'Preview' : 'Edit'}
          </button>
        </div>
        {#if editingBody}
          <textarea id="drawer-body" class="textarea textarea-bordered w-full min-h-32" bind:value={body} placeholder="Issue body…"></textarea>
        {:else if body.trim()}
          <div class="rounded-box border border-base-300 p-3 text-sm">
            <MarkdownContent content={body} onOpenUrl={onOpenUrl} />
          </div>
        {:else}
          <span class="text-sm text-base-content/40">No description.</span>
        {/if}
        <button class="btn btn-sm btn-primary self-start" onclick={() => onSaveText(title.trim(), body)} disabled={busy}>
          Save title &amp; body
        </button>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Value</span>
        <div class="flex flex-wrap gap-1.5">
          {#each values as n}
            <button
              class="btn btn-xs {card.value === n ? 'btn-primary' : 'btn-outline'}"
              onclick={() => onSetValue(n)}
              disabled={busy}
            >{n}</button>
          {/each}
          <button class="btn btn-xs btn-ghost" onclick={() => onSetValue(null)} disabled={busy}>clear</button>
        </div>
      </div>

      <div class="flex flex-col gap-2">
        <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Labels</span>
        {#if allLabels.length === 0}
          <span class="text-sm text-base-content/40">No labels in this repo.</span>
        {:else}
          <div class="flex flex-wrap gap-2">
            {#each allLabels as label (label.name)}
              {@const on = card.labels.includes(label.name)}
              <button
                type="button"
                class="badge badge-lg gap-1 cursor-pointer {on ? 'border' : 'badge-ghost'}"
                style={on ? chipStyle(label.color) : ''}
                onclick={() => onToggleLabel(label.name, on)}
                disabled={busy}
              >
                {on ? '✓ ' : ''}{label.name}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="pt-2 border-t border-base-300">
        <button class="btn btn-sm btn-error btn-outline" onclick={onCloseIssue} disabled={busy}>Close issue</button>
      </div>
    </div>
</Modal>
