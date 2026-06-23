<script lang="ts">
  import { onDestroy } from 'svelte'
  import { RefreshCw, Plus, Columns3 } from '@lucide/svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge/plugin-sdk/frontend'
  import {
    buildBoard,
    applyCreate,
    applyRename,
    applyRelabel,
    type BoardCard,
    type BoardModel,
  } from '../lib/board'
  import type { LabelUsage, RepoLabel, RoadmapBoard } from '../lib/types'
  import { createRoadmapClient } from '../lib/roadmapClient'
  import Board from './Board.svelte'
  import CardDrawer from './CardDrawer.svelte'
  import CreateDialog from './CreateDialog.svelte'
  import ColumnSettingsModal from './ColumnSettingsModal.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context?: OpenForgeContextSnapshot
    projectName?: string
    projectPath?: string
    projectId?: string | null
  }

  let { api, context: _context, projectName = '', projectPath: _projectPath = '', projectId = null }: Props =
    $props()

  // `api` is a stable prop; build the client once. (Intentional initial capture.)
  // svelte-ignore state_referenced_locally
  const client = createRoadmapClient(api)

  let board = $state<BoardModel | null>(null)
  let repoLabels = $state<RepoLabel[]>([])
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let busy = $state(false)

  // Modal / drawer state.
  let selectedIssueNumber = $state<number | null>(null)
  let showCreate = $state(false)
  let showColumns = $state(false)
  let configLabels = $state<LabelUsage[]>([])
  let configColumnLabels = $state<string[]>([])

  // The currently open card, derived live from the board so optimistic edits reflect.
  let selectedCard = $derived.by<BoardCard | null>(() => {
    if (selectedIssueNumber === null || !board) return null
    for (const col of board.columns) {
      const found = col.cards.find((c) => c.issueNumber === selectedIssueNumber)
      if (found) return found
    }
    return null
  })

  let repoSlug = $derived(board ? `${board.repo.owner}/${board.repo.name}` : '')

  // Track the previous projectId to guard the load effect (a board refresh can
  // pass a new prop object with the same logical projectId).
  let lastProjectId = $state<string | null | undefined>(undefined)

  function modelFromBoard(raw: RoadmapBoard): BoardModel {
    const values: Record<number, number> = {}
    for (const [key, value] of Object.entries(raw.values)) {
      values[Number(key)] = value
    }
    const labelColors: Record<string, string> = {}
    for (const label of raw.labels) labelColors[label.name] = label.color
    return buildBoard({
      repo: `${raw.repo.owner}/${raw.repo.name}`,
      issues: raw.issues.map((i) => ({
        number: i.number,
        title: i.title,
        body: i.body,
        labels: i.labels.map((l) => l.name),
      })),
      columnLabels: raw.columnLabels,
      labelColors,
      values,
    })
  }

  async function loadBoard() {
    if (!projectId) {
      board = null
      return
    }
    isLoading = true
    error = null
    try {
      const raw = await client.getBoard(projectId)
      repoLabels = raw.labels
      board = modelFromBoard(raw)
    } catch (e) {
      board = null
      error = String(e instanceof Error ? e.message : e)
    } finally {
      isLoading = false
    }
  }

  // Reload when the active project changes (also handles initial load). Guarded
  // by explicit previous-value comparison so a store refresh that re-passes the
  // same projectId does not retrigger a load.
  $effect(() => {
    const pid = projectId
    if (pid !== lastProjectId) {
      lastProjectId = pid
      selectedIssueNumber = null
      showCreate = false
      showColumns = false
      void loadBoard()
    }
  })

  function openUrl(url: string) {
    void api.system.openUrl(url)
  }

  async function copyLink(issueNumber: number) {
    if (!repoSlug) return
    const url = `https://github.com/${repoSlug}/issues/${issueNumber}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      // Clipboard may be unavailable; fall back to opening the link.
      openUrl(url)
    }
  }

  async function withBusy(fn: () => Promise<void>) {
    busy = true
    try {
      await fn()
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
    } finally {
      busy = false
    }
  }

  async function setValue(value: number | null) {
    if (selectedIssueNumber === null || !projectId || !board) return
    const issueNumber = selectedIssueNumber
    // Optimistic: patch the local card value, then persist.
    board = {
      ...board,
      columns: board.columns.map((col) => ({
        ...col,
        cards: col.cards.map((c) => (c.issueNumber === issueNumber ? { ...c, value } : c)),
      })),
    }
    await withBusy(async () => {
      await client.setValue({ projectId, issueNumber, value })
    })
  }

  async function saveText(title: string, body: string) {
    if (selectedIssueNumber === null || !projectId || !board) return
    const issueNumber = selectedIssueNumber
    if (title) board = applyRename(board, issueNumber, title)
    await withBusy(async () => {
      await client.editIssue({ projectId, number: issueNumber, title, body })
      await loadBoard()
    })
  }

  async function toggleLabel(name: string, currentlyOn: boolean) {
    if (selectedIssueNumber === null || !projectId || !board) return
    const issueNumber = selectedIssueNumber
    // Optimistically re-place the card (removing or adding the toggled label).
    board = currentlyOn
      ? applyRelabel(board, issueNumber, name, '')
      : applyRelabel(board, issueNumber, '', name)
    await withBusy(async () => {
      await client.editIssue({
        projectId,
        number: issueNumber,
        addLabels: currentlyOn ? [] : [name],
        removeLabels: currentlyOn ? [name] : [],
      })
      await loadBoard()
    })
  }

  async function closeIssue() {
    if (selectedIssueNumber === null || !projectId) return
    const issueNumber = selectedIssueNumber
    await withBusy(async () => {
      await client.editIssue({ projectId, number: issueNumber, state: 'closed' })
      selectedIssueNumber = null
      await loadBoard()
    })
  }

  async function createIssue(title: string, body: string, labels: string[]) {
    if (!projectId || !board) return
    await withBusy(async () => {
      const issue = await client.createIssue({ projectId, title, body, labels })
      const newCard: BoardCard = {
        issueNumber: issue.number,
        title: issue.title,
        body: issue.body,
        labels: issue.labels.map((l) => l.name),
        value: null,
      }
      if (board) board = applyCreate(board, newCard)
      showCreate = false
      await loadBoard()
    })
  }

  async function openColumns() {
    if (!projectId) return
    error = null
    try {
      const config = await client.getConfig(projectId)
      configLabels = config.labels
      configColumnLabels = config.columnLabels
      showColumns = true
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
    }
  }

  async function saveColumns(labels: string[]) {
    if (!projectId) return
    await withBusy(async () => {
      await client.setColumnLabels({ projectId, labels })
      showColumns = false
      await loadBoard()
    })
  }

  onDestroy(() => {
    selectedIssueNumber = null
  })
</script>

<div class="flex flex-col h-full overflow-hidden">
  <div class="flex items-center justify-between px-6 py-3 border-b border-base-300 shrink-0" style="background-color: var(--project-bg-alt, oklch(var(--b2)))">
    <div class="min-w-0">
      <h2 class="text-[22px] font-semibold text-base-content tracking-tight m-0 truncate">
        {projectName || 'Roadmap'}
      </h2>
      <p class="text-[13px] text-secondary mt-0.5 m-0 truncate">
        {#if repoSlug}{repoSlug}{:else}Roadmap board{/if}
      </p>
    </div>
    <div class="flex items-center gap-2 shrink-0">
      <button class="btn btn-sm" onclick={() => (showCreate = true)} disabled={!board || busy}>
        <Plus size={14} /> Create
      </button>
      <button class="btn btn-sm" onclick={openColumns} disabled={!board || busy}>
        <Columns3 size={14} /> Columns
      </button>
      <button class="btn btn-sm" onclick={() => loadBoard()} disabled={isLoading || !projectId}>
        <RefreshCw size={14} class={isLoading ? 'animate-spin' : ''} /> Refresh
      </button>
    </div>
  </div>

  <div class="flex-1 overflow-hidden">
    {#if !projectId}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm text-center p-6">
        <p class="m-0">Select a project to view its roadmap.</p>
      </div>
    {:else if isLoading && !board}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/50 text-sm">
        <span class="loading loading-spinner loading-md text-primary"></span>
        <span>Loading board…</span>
      </div>
    {:else if error && !board}
      <div class="flex flex-col items-center justify-center h-full gap-3 text-base-content/60 text-sm text-center p-6 max-w-md mx-auto">
        <span class="text-3xl">⚠</span>
        <p class="m-0">No GitHub board for this project.</p>
        <p class="text-xs text-base-content/40 m-0">{error}</p>
      </div>
    {:else if board}
      <Board
        columns={board.columns}
        repo={repoSlug}
        onCardClick={(c) => (selectedIssueNumber = c.issueNumber)}
        onOpenUrl={openUrl}
        onCopyLink={copyLink}
      />
    {/if}
  </div>
</div>

{#if selectedCard && board}
  <CardDrawer
    card={selectedCard}
    repo={repoSlug}
    allLabels={repoLabels}
    {busy}
    onClose={() => (selectedIssueNumber = null)}
    onOpenUrl={openUrl}
    onCopyLink={copyLink}
    onSaveText={saveText}
    onSetValue={setValue}
    onToggleLabel={toggleLabel}
    onCloseIssue={closeIssue}
  />
{/if}

{#if showCreate && board}
  <CreateDialog
    labelOptions={repoLabels}
    {busy}
    onClose={() => (showCreate = false)}
    onCreate={createIssue}
    onOpenUrl={openUrl}
  />
{/if}

{#if showColumns && board}
  <ColumnSettingsModal
    repo={repoSlug}
    labels={configLabels}
    initialColumnLabels={configColumnLabels}
    {busy}
    onClose={() => (showColumns = false)}
    onSave={saveColumns}
  />
{/if}
