<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import { tick } from 'svelte'
  import type { TaskDetail, PullRequestInfo, PullRequestMergeMethod } from '../../lib/types'
  import { getAvailableActions, filterActions, type PaletteAction } from '../../lib/actionPalette'
  import { activeProjectId, outOfFocusTaskIdsByProject } from '../../lib/stores'
  import PaletteFooter from '../shared/ui/PaletteFooter.svelte'
  import PaletteInput from '../shared/ui/PaletteInput.svelte'
  import PaletteListbox from '../shared/ui/PaletteListbox.svelte'
  import PaletteModal from './PaletteModal.svelte'

  interface Props {
    task: TaskDetail | null
    taskPrs: PullRequestInfo[]
    canRunApp?: boolean
    onClose: () => void
    onExecute: (actionId: string, mergeMethod?: PullRequestMergeMethod) => void
  }

  let { task, taskPrs, canRunApp = false, onClose, onExecute }: Props = $props()
  let searchQuery = $state('')
  let selectedActionId = $state<string | null>(null)
  let pendingConfirmation = $state<PaletteAction | null>(null)
  let confirmButton: HTMLButtonElement | null = $state(null)
  let paletteListbox: { handleKeydown: (event: KeyboardEvent) => boolean } | null = $state(null)

  let outOfFocusTaskIds = $derived.by(() => {
    const taskProjectId = task?.projectId ?? $activeProjectId
    return taskProjectId ? $outOfFocusTaskIdsByProject.get(taskProjectId) ?? new Set<string>() : new Set<string>()
  })
  let allActions = $derived(getAvailableActions(task, taskPrs, outOfFocusTaskIds, { canRunApp }))
  let filtered = $derived(filterActions(allActions, searchQuery))
  let orderedActions = $derived(
    ['task', 'navigation', 'general'].flatMap(category => filtered.filter(action => action.category === category))
  )
  let selectedIndex = $derived.by(() => {
    if (orderedActions.length === 0) return -1
    if (selectedActionId === null) return 0
    const index = orderedActions.findIndex(action => action.id === selectedActionId)
    return index === -1 ? 0 : index
  })
  let lastSearchQuery = $state('')

  $effect(() => {
    const trimmedSearchQuery = searchQuery.trim()
    if (orderedActions.length === 0) {
      selectedActionId = null
      lastSearchQuery = trimmedSearchQuery
      return
    }
    const searchChanged = trimmedSearchQuery !== lastSearchQuery
    lastSearchQuery = trimmedSearchQuery
    if (searchChanged || selectedActionId === null || !orderedActions.some(action => action.id === selectedActionId)) {
      selectedActionId = orderedActions[0].id
    }
  })

  $effect(() => {
    if (pendingConfirmation === null) return
    void tick().then(() => confirmButton?.focus())
  })

  function executePendingConfirmation(): void {
    const action = pendingConfirmation
    if (!action) return
    pendingConfirmation = null
    onExecute(action.id, action.mergeMethod)
  }

  function selectAction(action: PaletteAction): void {
    if (action.mergeMethod !== undefined) {
      pendingConfirmation = action
      return
    }
    onExecute(action.id)
  }

  function handleKeyDown(event: KeyboardEvent): boolean {
    if (pendingConfirmation !== null) {
      if (event.key === 'Escape') {
        pendingConfirmation = null
        return true
      }
      if (event.key === 'Enter' && !event.repeat) {
        event.preventDefault()
        executePendingConfirmation()
        return true
      }
      return false
    }
    return paletteListbox?.handleKeydown(event) ?? false
  }

  function groupLabel(action: PaletteAction, index: number): string | null {
    if (index > 0 && orderedActions[index - 1].category === action.category) return null
    return action.category === 'task' ? 'Task' : action.category === 'navigation' ? 'Navigation' : 'General'
  }
</script>

<PaletteModal ariaLabel="Action palette" testId="action-palette-backdrop" {onClose} onKeydown={handleKeyDown}>
  {#if pendingConfirmation}
    <section class="p-5" aria-labelledby="merge-confirmation-title">
      <h2 id="merge-confirmation-title" class="text-base font-semibold">{pendingConfirmation.label}?</h2>
      <p class="mt-2 text-sm text-base-content/70">GitHub will use this repository's configured commit message.</p>
      <div class="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" type="button" onclick={() => { pendingConfirmation = null }}>Cancel</Button>
        <Button bind:element={confirmButton} variant="primary" size="sm" type="button" onclick={executePendingConfirmation}>Confirm</Button>
      </div>
    </section>
    <PaletteFooter actionLabel="confirm" cancelLabel="cancel" />
  {:else}
  <PaletteListbox
    bind:this={paletteListbox}
    items={orderedActions}
    {selectedIndex}
    onSelectedIndexChange={(index) => { selectedActionId = orderedActions[index]?.id ?? null }}
    onSelect={selectAction}
    getKey={(action) => action.id}
    {groupLabel}
    idPrefix="action-palette"
    listboxLabel="Actions"
    onCancel={onClose}
    listClass="max-h-[400px] overflow-y-auto"
    optionClass={(_action, _index, highlighted) => `flex items-center gap-3 w-full px-4 py-2 text-left text-sm text-base-content transition-colors ${highlighted ? 'bg-base-300' : 'hover:bg-base-300/60'}`}
  >
    {#snippet input(listboxId, activeDescendantId)}
      <PaletteInput {listboxId} {activeDescendantId} bind:value={searchQuery} placeholder="Type an action..." />
    {/snippet}
    {#snippet emptyContent()}
      <div class="px-4 py-6 text-center text-base-content/50 text-sm">No actions match your search</div>
    {/snippet}
    {#snippet item(action)}
      <span class="flex-1">{action.label}</span>
      {#if action.isDefaultMergeMethod}
        <Badge variant="neutral">GitHub default</Badge>
      {/if}
      {#if action.shortcut}
        <kbd class="kbd kbd-xs bg-base-content/5 text-base-content/40 border-base-content/10">{action.shortcut}</kbd>
      {/if}
    {/snippet}
  </PaletteListbox>
  <PaletteFooter actionLabel="execute" trailingKey="⌘K" trailingLabel="toggle" />
  {/if}
</PaletteModal>
