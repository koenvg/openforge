<script lang="ts">
  import MarkdownContent from '@openforge-app/plugin-sdk/ui/MarkdownContent.svelte'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import type { RepoLabel, TicketDraft } from '../lib/types'

  interface RefineDraftRequest {
    text: string
    draft: TicketDraft | null
    feedback: string
    labels: string[]
  }

  interface Props {
    labelOptions: RepoLabel[]
    initialLabels?: string[]
    busy: boolean
    onClose: () => void
    onCreate: (title: string, body: string, labels: string[]) => void
    onRefine: (request: RefineDraftRequest) => Promise<TicketDraft>
    onOpenUrl: (url: string) => void
  }

  let { labelOptions, initialLabels = [], busy, onClose, onCreate, onRefine, onOpenUrl }: Props = $props()

  let note = $state('')
  let title = $state('')
  let body = $state('')
  let editingBody = $state(true)
  let hasDraft = $state(false)
  let refining = $state(false)
  let feedback = $state('')
  let refineError = $state<string | null>(null)
  // Initial labels are captured when the dialog is mounted for a create action.
  // svelte-ignore state_referenced_locally
  let labels = $state<string[]>([...initialLabels])

  const HEX6 = /^[0-9a-fA-F]{6}$/
  function chipStyle(color: string): string {
    if (!color || !HEX6.test(color)) return ''
    return `background-color: #${color}33; border-color: #${color};`
  }

  function toggleLabel(name: string) {
    labels = labels.includes(name) ? labels.filter((l) => l !== name) : [...labels, name]
  }

  async function applyRefine(request: RefineDraftRequest) {
    if (busy || refining) return
    refining = true
    refineError = null
    try {
      const draft = await onRefine(request)
      title = draft.title
      body = draft.body
      editingBody = false
      hasDraft = true
      if (request.feedback) feedback = ''
    } catch (e) {
      refineError = String(e instanceof Error ? e.message : e)
    } finally {
      refining = false
    }
  }

  function refine() {
    const text = note.trim()
    if (!text) return
    void applyRefine({ text, draft: null, feedback: '', labels: [...labels] })
  }

  function revise() {
    const fb = feedback.trim()
    if (!fb || !hasDraft) return
    void applyRefine({
      text: note.trim(),
      draft: { title: title.trim(), body: body.trim() },
      feedback: fb,
      labels: [...labels],
    })
  }

  function skipAi() {
    const text = note.trim()
    if (!text || busy || refining) return
    title = text
    body = ''
    editingBody = true
    hasDraft = true
    refineError = null
  }

  function submit() {
    const t = title.trim()
    if (!hasDraft || !t || busy) return
    onCreate(t, body.trim(), [...labels])
  }

</script>

<Modal
  ariaLabel={hasDraft ? 'Review & create' : 'New ticket'}
  closeLabel="Close"
  maxWidth="36rem"
  initialFocus="#create-note"
  {onClose}
>
  {#snippet header()}
    <h3 class="text-base font-semibold m-0">{hasDraft ? 'Review & create' : 'New ticket'}</h3>
  {/snippet}

    <div class="flex-1 overflow-y-auto p-5 flex flex-col gap-5">
      {#if !hasDraft}
        <div class="flex flex-col gap-2">
          <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-note">Describe the issue</label>
          <!-- svelte-ignore a11y_autofocus -->
          <textarea
            id="create-note"
            class="textarea textarea-bordered w-full min-h-40"
            bind:value={note}
            autofocus
            placeholder="Rough idea, bug, or task"
          ></textarea>
        </div>

        {#if refineError}
          <p class="alert alert-error text-sm m-0">{refineError}</p>
        {/if}
      {:else}
        <div class="flex flex-col gap-2">
          <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-title">Title</label>
          <input id="create-title" class="input input-bordered input-sm w-full" bind:value={title} placeholder="Issue title" />
        </div>

        <div class="flex flex-col gap-2">
          <div class="flex items-center justify-between">
            <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-body">Description</label>
            <button class="btn btn-ghost btn-xs" type="button" onclick={() => (editingBody = !editingBody)}>
              {editingBody ? 'Preview' : 'Edit'}
            </button>
          </div>
          {#if editingBody}
            <textarea id="create-body" class="textarea textarea-bordered w-full min-h-40" bind:value={body} placeholder="Description…"></textarea>
          {:else if body.trim()}
            <div class="rounded-box border border-base-300 p-3 text-sm">
              <MarkdownContent content={body} onOpenUrl={onOpenUrl} />
            </div>
          {:else}
            <span class="text-sm text-base-content/40">No description.</span>
          {/if}
        </div>

        {#if labelOptions.length > 0}
          <div class="flex flex-col gap-2">
            <span class="text-xs font-semibold text-base-content/60 uppercase tracking-wide">Labels (optional)</span>
            <div class="flex flex-wrap gap-2">
              {#each labelOptions as label (label.name)}
                {@const on = labels.includes(label.name)}
                <button
                  type="button"
                  class="badge badge-lg gap-1 cursor-pointer {on ? 'border' : 'badge-ghost'}"
                  style={on ? chipStyle(label.color) : ''}
                  aria-pressed={on}
                  onclick={() => toggleLabel(label.name)}
                >
                  {on ? '✓ ' : ''}{label.name}
                </button>
              {/each}
            </div>
          </div>
        {/if}

        <div class="flex flex-col gap-2">
          <label class="text-xs font-semibold text-base-content/60 uppercase tracking-wide" for="create-feedback">Feedback</label>
          <textarea
            id="create-feedback"
            class="textarea textarea-bordered w-full min-h-20"
            bind:value={feedback}
            placeholder="Adjust the draft"
          ></textarea>
          <button class="btn btn-sm self-start" type="button" onclick={revise} disabled={busy || refining || !feedback.trim()}>
            {refining ? 'Refining…' : 'Refine with feedback'}
          </button>
        </div>

        {#if refineError}
          <p class="alert alert-error text-sm m-0">{refineError}</p>
        {/if}
      {/if}
    </div>

    <div class="flex justify-end gap-2 px-5 py-3 border-t border-base-300 shrink-0">
      <button class="btn btn-sm btn-ghost" onclick={onClose} disabled={busy}>Cancel</button>
      {#if hasDraft}
        <button class="btn btn-sm btn-primary" onclick={submit} disabled={!title.trim() || busy}>
          {busy ? 'Creating…' : 'Create issue'}
        </button>
      {:else}
        <button class="btn btn-sm" type="button" onclick={skipAi} disabled={!note.trim() || busy || refining}>Skip AI</button>
        <button class="btn btn-sm btn-primary" type="button" onclick={refine} disabled={!note.trim() || busy || refining}>
          {refining ? 'Refining…' : 'Refine'}
        </button>
      {/if}
    </div>
</Modal>
