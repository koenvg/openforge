<script lang="ts">
  import { onDestroy } from 'svelte'
  import { RefreshCw, Plus, Columns3 } from '@lucide/svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import type { Action } from '@openforge-app/plugin-sdk'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import {
    buildBoard,
    applyCreate,
    applyRename,
    applyRelabel,
    type BoardCard,
    type BoardColumn,
    type BoardModel,
    type RoadmapIssueTaskLink,
  } from '../lib/board'
  import { stepIndex } from '../lib/queue'
  import type { LabelUsage, RefineTicketRequest, RepoLabel, RoadmapBoard, TicketDraft } from '../lib/types'
  import { normalizeLabelColor } from '../lib/labelColors'
  import { loadRoadmapActions, loadRoadmapIssueTaskLinks, startRoadmapIssueAction } from '../lib/roadmapActions'
  import { createRoadmapClient } from '../lib/roadmapClient'
  import { readApiKey } from '../lib/settings/apiKey'
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
  let actions = $state<Action[]>([])
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let busy = $state(false)
  let pendingCreatedCards = $state<BoardCard[]>([])
  // Gates Refine in the create dialog. Re-read whenever the dialog opens rather than
  // once on mount: the key may have been added in settings since this view loaded.
  let hasApiKey = $state(false)

  // The label group the drawer is walking. `issueNumbers` is snapshotted when a card is opened
  // and never recomputed: the drawer mutates its own group (toggling a label, closing an issue),
  // so a live list would renumber under the reader or lose its anchor mid-review.
  interface OpenQueue {
    groupTitle: string
    issueNumbers: number[]
    index: number
  }
  let open = $state<OpenQueue | null>(null)
  let showCreate = $state(false)
  let createLabels = $state<string[]>([])
  let showColumns = $state(false)
  let configLabels = $state<LabelUsage[]>([])
  let configColumnLabels = $state<string[]>([])

  // Every issue currently on the board. The queue is frozen but the board is live, so entries
  // can name issues that have since left — stepIndex uses this to skip them.
  let present = $derived.by<Set<number>>(() => {
    const set = new Set<number>()
    if (board) for (const col of board.columns) for (const c of col.cards) set.add(c.issueNumber)
    return set
  })

  let openIssueNumber = $derived(open ? (open.issueNumbers[open.index] ?? null) : null)

  // The currently open card, derived live from the board so optimistic edits reflect.
  let selectedCard = $derived.by<BoardCard | null>(() => {
    if (openIssueNumber === null || !board) return null
    for (const col of board.columns) {
      const found = col.cards.find((c) => c.issueNumber === openIssueNumber)
      if (found) return found
    }
    return null
  })

  // Freeze the column's order at open. A card carrying two column labels sits in two columns,
  // so the group has to come from the click — the issue number alone can't identify it.
  function openFrom(card: BoardCard, column: BoardColumn) {
    open = {
      groupTitle: column.title,
      issueNumbers: column.cards.map((c) => c.issueNumber),
      index: column.cards.findIndex((c) => c.issueNumber === card.issueNumber),
    }
  }

  function go(dir: 1 | -1) {
    if (!open) return
    const i = stepIndex(open.issueNumbers, open.index, dir, present)
    open = i === null ? null : { ...open, index: i } // null → nothing left to review
  }

  // A closed issue leaves the board, which would null the open card and unmount the drawer.
  // Step past it first so a review sweep keeps its place. The closed number is excluded
  // explicitly because it advances before the board refresh has dropped it from `present`.
  function advancePastClosed(closed: number) {
    if (!open) return
    const remaining = new Set(present)
    remaining.delete(closed)
    const i = stepIndex(open.issueNumbers, open.index, 1, remaining)
    open = i === null ? null : { ...open, index: i } // null → nothing left to review
  }

  // BoardModel.repo is the owner/name slug built from roadmap_get_board's raw RepoRef in modelFromBoard().
  let repoSlug = $derived(board ? board.repo : '')

  // Track the previous projectId to guard the load effect (a board refresh can
  // pass a new prop object with the same logical projectId).
  let lastProjectId = $state<string | null | undefined>(undefined)
  let actionLoadRequest = 0

  function modelFromBoard(raw: RoadmapBoard, taskLinks: Record<number, RoadmapIssueTaskLink> = {}): BoardModel {
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
      taskLinks,
    })
  }

  function withPendingCreatedCards(model: BoardModel, raw: RoadmapBoard): BoardModel {
    const loadedIssueNumbers = new Set(raw.issues.map((issue) => issue.number))
    pendingCreatedCards = pendingCreatedCards.filter((card) => !loadedIssueNumbers.has(card.issueNumber))
    return pendingCreatedCards.reduce((current, card) => applyCreate(current, card), model)
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
      const taskLinks = await loadRoadmapIssueTaskLinks(api, projectId)
      repoLabels = raw.labels
      board = withPendingCreatedCards(modelFromBoard(raw, taskLinks), raw)
    } catch (e) {
      board = null
      error = String(e instanceof Error ? e.message : e)
    } finally {
      isLoading = false
    }
  }

  async function loadActionsForProject(pid: string | null) {
    const requestId = ++actionLoadRequest
    if (!pid) {
      actions = []
      return
    }
    try {
      const loaded = await loadRoadmapActions(api, pid)
      if (requestId === actionLoadRequest) actions = loaded
    } catch {
      if (requestId === actionLoadRequest) actions = []
    }
  }

  // Reload when the active project changes (also handles initial load). Guarded
  // by explicit previous-value comparison so a store refresh that re-passes the
  // same projectId does not retrigger a load.
  $effect(() => {
    const pid = projectId
    if (pid !== lastProjectId) {
      lastProjectId = pid
      open = null
      showCreate = false
      createLabels = []
      pendingCreatedCards = []
      showColumns = false
      void loadBoard()
      void loadActionsForProject(pid)
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

  // Returns whether `fn` completed without throwing, so callers that navigate on success
  // (Save & continue, close-and-advance) don't move off an edit that never reached GitHub.
  async function withBusy(fn: () => Promise<void>): Promise<boolean> {
    error = null
    busy = true
    try {
      await fn()
      return true
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
      return false
    } finally {
      busy = false
    }
  }

  async function setValue(value: number | null) {
    if (openIssueNumber === null || !projectId || !board) return
    const issueNumber = openIssueNumber
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

  async function saveText(title: string, body: string): Promise<boolean> {
    if (openIssueNumber === null || !projectId || !board) return false
    const issueNumber = openIssueNumber
    if (title) board = applyRename(board, issueNumber, title)
    return withBusy(async () => {
      await client.editIssue({ projectId, number: issueNumber, title, body })
      await loadBoard()
    })
  }

  async function toggleLabel(name: string, currentlyOn: boolean) {
    if (openIssueNumber === null || !projectId || !board) return
    const issueNumber = openIssueNumber
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
    if (openIssueNumber === null || !projectId) return
    const issueNumber = openIssueNumber
    const ok = await withBusy(async () => {
      await client.editIssue({ projectId, number: issueNumber, state: 'closed' })
    })
    // A failed close must not move the reader off the issue.
    if (!ok) return
    // Advance before the refresh so the drawer never unmounts on the now-missing card.
    advancePastClosed(issueNumber)
    await loadBoard()
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
        taskLink: null,
      }
      pendingCreatedCards = [
        ...pendingCreatedCards.filter((card) => card.issueNumber !== newCard.issueNumber),
        newCard,
      ]
      if (board) board = applyCreate(board, newCard)
      showCreate = false
      createLabels = []
      // Do not immediately refetch: GitHub's issue list is eventually consistent.
      // Keep the optimistic card visible; a later refresh reconciles it through
      // pendingCreatedCards once the listing includes the new issue.
    })
  }

  // repo and repoLabels ground the draft in this project's terminology. Both are already
  // loaded on the board behind this dialog, so they ride along rather than being
  // re-fetched backend-side.
  async function refineTicketDraft(
    request: Omit<RefineTicketRequest, 'projectId' | 'repo' | 'repoLabels'>,
  ): Promise<TicketDraft> {
    if (!projectId) throw new Error('Select a project before refining a ticket.')
    try {
      return await client.refineTicket({
        projectId,
        repo: repoSlug,
        repoLabels: repoLabels.map((label) => label.name),
        ...request,
      })
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
      throw e
    }
  }

  function openCreate(labels: string[] = []) {
    createLabels = [...labels]
    showCreate = true
    void readApiKey(api.storage).then((key) => {
      hasApiKey = Boolean(key)
    })
  }

  function closeCreate() {
    showCreate = false
    createLabels = []
  }
  function openTask(taskId: string) {
    if (!projectId) return
    void api.navigation.navigate({ projectId, viewId: 'board', taskId })
  }

  async function runIssueAction(card: BoardCard, actionPrompt: string) {
    if (!projectId || !repoSlug) return
    await withBusy(async () => {
      await startRoadmapIssueAction(api, {
        projectId,
        repo: repoSlug,
        card,
        actionPrompt,
      })
      await loadBoard()
    })
  }

  function patchLabelColor(name: string, color: string) {
    repoLabels = repoLabels.map((label) => (label.name === name ? { ...label, color } : label))
    configLabels = configLabels.map((label) => (label.name === name ? { ...label, color } : label))
    if (board) {
      board = {
        ...board,
        columns: board.columns.map((column) =>
          column.label === name ? { ...column, color } : column,
        ),
      }
    }
  }

  async function recolorLabel(name: string, rawColor: string) {
    if (!projectId) return
    const color = normalizeLabelColor(rawColor)
    if (!color) {
      error = 'Label color must be a six-digit hex color.'
      return
    }

    const previousBoard = board
    const previousRepoLabels = repoLabels
    const previousConfigLabels = configLabels
    patchLabelColor(name, color)
    busy = true
    try {
      await client.updateLabelColor({ projectId, name, color })
      await loadBoard()
    } catch (e) {
      board = previousBoard
      repoLabels = previousRepoLabels
      configLabels = previousConfigLabels
      error = String(e instanceof Error ? e.message : e)
      throw e
    } finally {
      busy = false
    }
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
    open = null
  })
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PluginPageHeader
    title={projectName || 'Roadmap'}
    subtitle={repoSlug || 'Roadmap board'}
  >
    {#snippet actions()}
      <div class="flex items-center gap-2 shrink-0">
        <button class="btn btn-sm" onclick={() => openCreate()} disabled={!board || busy}>
          <Plus size={14} /> Create
        </button>
        <button class="btn btn-sm" onclick={openColumns} disabled={!board || busy}>
          <Columns3 size={14} /> Columns
        </button>
        <button class="btn btn-sm" onclick={() => loadBoard()} disabled={isLoading || !projectId}>
          <RefreshCw size={14} class={isLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
    {/snippet}
  </PluginPageHeader>

  <div class="flex-1 overflow-hidden">
    <PluginViewState
      loading={isLoading && !board}
      loadingLabel="Loading board…"
      error={projectId && error && !board ? error : null}
      errorTitle="No GitHub board for this project."
      empty={!projectId}
      emptyTitle="Select a project to view its roadmap."
    >
      {#if board}
        <Board
          columns={board.columns}
          repo={repoSlug}
          {actions}
          {busy}
          onCardClick={openFrom}
          onOpenUrl={openUrl}
          onCopyLink={copyLink}
          onRecolor={(name, color) => {
            void recolorLabel(name, color).catch(() => undefined)
          }}
          onRunAction={(card, actionPrompt) => {
            void runIssueAction(card, actionPrompt)
          }}
          onAddCard={(label) => openCreate(label ? [label] : [])}
        />
      {/if}
    </PluginViewState>
  </div>
</div>

{#if open && selectedCard && board}
  <CardDrawer
    card={selectedCard}
    repo={repoSlug}
    allLabels={repoLabels}
    {busy}
    index={open.index}
    total={open.issueNumbers.length}
    groupTitle={open.groupTitle}
    onPrev={() => go(-1)}
    onNext={() => go(1)}
    onClose={() => (open = null)}
    onOpenUrl={openUrl}
    onCopyLink={copyLink}
    onSaveText={saveText}
    onSetValue={setValue}
    onToggleLabel={toggleLabel}
    onCloseIssue={closeIssue}
    onOpenTask={openTask}
  />
{/if}

{#if showCreate && board}
  <CreateDialog
    labelOptions={repoLabels}
    initialLabels={createLabels}
    {busy}
    {hasApiKey}
    onClose={closeCreate}
    onCreate={createIssue}
    onRefine={refineTicketDraft}
    onOpenUrl={openUrl}
  />
{/if}

{#if showColumns && board}
  <ColumnSettingsModal
    repo={repoSlug}
    labels={configLabels}
    initialColumnLabels={configColumnLabels}
    {busy}
    {error}
    onClose={() => {
      showColumns = false
      error = null
    }}
    onSave={saveColumns}
    onRecolor={recolorLabel}
  />
{/if}
