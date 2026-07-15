<script lang="ts">
  import { ExternalLink, Copy } from '@lucide/svelte'
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { BoardCard } from '../lib/board'
  import type { RepoLabel } from '../lib/types'
  import DrawerPager from './DrawerPager.svelte'

  // The ways out of the open issue. All of them discard unsaved title/body text, so all of
  // them route through the confirm when there is any.
  type Exit = 'prev' | 'next' | 'close'

  interface Props {
    card: BoardCard
    repo: string
    allLabels: RepoLabel[]
    busy: boolean
    /** 0-based position of this card within its opened label group. */
    index: number
    total: number
    groupTitle: string
    onPrev: () => void
    onNext: () => void
    onClose: () => void
    onOpenUrl: (url: string) => void
    onCopyLink: (issueNumber: number) => void
    /** Returns whether the save reached GitHub — Save & continue must not navigate on failure. */
    onSaveText: (title: string, body: string) => Promise<boolean>
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
    index,
    total,
    groupTitle,
    onPrev,
    onNext,
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

  // The exit awaiting confirmation, or null when no unsaved-changes prompt is showing.
  let pending = $state<Exit | null>(null)
  let saveButton = $state<HTMLButtonElement | null>(null)

  $effect(() => {
    if (card.issueNumber !== lastIssueNumber) {
      lastIssueNumber = card.issueNumber
      title = card.title
      body = card.body ?? ''
      editingBody = false
    }
  })

  // Move focus into the confirm when it opens. Also keeps Escape's stage 2 reachable: stage 1
  // only fires for a focused text field, so focus must leave the title/body first.
  $effect(() => {
    if (pending) saveButton?.focus()
  })

  let issueUrl = $derived(`https://github.com/${repo}/issues/${card.issueNumber}`)
  const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  let dirty = $derived(title !== card.title || body !== (card.body ?? ''))

  const HEX6 = /^[0-9a-fA-F]{6}$/
  function chipStyle(color: string): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color}33; border-color: #${color};`
  }

  function isTextField(el: Element | null): boolean {
    return (
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (el instanceof HTMLElement && el.isContentEditable)
    )
  }

  function run(exit: Exit) {
    if (exit === 'prev') onPrev()
    else if (exit === 'next') onNext()
    else onClose()
  }

  // Every drawer exit funnels through here so unsaved title/body text is guarded once.
  function request(exit: Exit) {
    if (dirty) pending = exit
    else run(exit)
  }

  function discardAndGo() {
    // Reset explicitly rather than leaning on the reset effect: when every other queue entry
    // has left the board, stepping is a no-op, the issue number never changes, and the effect
    // would never fire — leaving "discarded" text on screen.
    title = card.title
    body = card.body ?? ''
    editingBody = false
    const exit = pending
    pending = null
    if (exit) run(exit)
  }

  async function saveAndGo() {
    const exit = pending
    const ok = await onSaveText(title.trim(), body)
    pending = null
    if (ok && exit) run(exit) // failed save: stay put; the parent surfaces the error
  }

  // Returns whether it consumed the event, matching Modal's onKeydown contract.
  function handleKeydown(event: KeyboardEvent): boolean | void {
    if (event.key === 'Escape') {
      if (pending) {
        pending = null
        return true
      }
      const el = document.activeElement
      if (isTextField(el)) {
        ;(el as HTMLElement).blur()
        return true
      }
      request('close')
      return true
    }

    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    // Modifier bailout is load-bearing: it preserves Option+←/→ word-jump and Alt+← Back.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (isTextField(document.activeElement)) return
    event.preventDefault()
    if (event.key === 'ArrowLeft') request('prev')
    else request('next')
    return true
  }
</script>

<Modal
  ariaLabel={`Issue #${card.issueNumber}`}
  closeLabel="Close"
  maxWidth="42rem"
  onClose={() => request('close')}
  onKeydown={handleKeydown}
>
  {#snippet header()}
    <div class="flex items-center gap-3 min-w-0">
      <DrawerPager {index} {total} {groupTitle} onPrev={() => request('prev')} onNext={() => request('next')} />
      <h3 class="text-base font-semibold m-0 shrink-0">#{card.issueNumber}</h3>
    </div>
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

    {#if pending}
      <!-- Overlay carries the alertdialog semantics (like the SDK Modal): a target-checked click
           and Escape both cancel, so the inner card needs no handlers. -->
      <div
        class="absolute inset-0 z-10 flex items-center justify-center bg-black/40 p-4"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="drawer-dirty-title"
        tabindex="-1"
        onclick={(e) => {
          if (e.target === e.currentTarget) pending = null
        }}
        onkeydown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            pending = null
          }
        }}
      >
        <div class="rounded-box border border-base-300 bg-base-100 shadow-xl p-5 max-w-sm">
          <p id="drawer-dirty-title" class="text-sm m-0 mb-4">#{card.issueNumber} has unsaved changes.</p>
          <div class="flex flex-wrap justify-end gap-2">
            <button class="btn btn-sm btn-primary" type="button" bind:this={saveButton} onclick={saveAndGo}>
              Save &amp; {pending === 'close' ? 'close' : 'continue'}
            </button>
            <button class="btn btn-sm" type="button" onclick={discardAndGo}>Discard</button>
            <button class="btn btn-sm btn-ghost" type="button" onclick={() => (pending = null)}>Cancel</button>
          </div>
        </div>
      </div>
    {/if}
</Modal>
