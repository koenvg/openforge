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
    type BoardModel,
  } from '../lib/board'
  import type { LabelUsage, RefineTicketRequest, RepoLabel, RoadmapBoard, TicketDraft } from '../lib/types'
  import { normalizeLabelColor } from '../lib/labelColors'
  import { loadRoadmapActions, startRoadmapIssueAction } from '../lib/roadmapActions'
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
  let actions = $state<Action[]>([])
  let isLoading = $state(false)
  let error = $state<string | null>(null)
  let busy = $state(false)

  // Modal / drawer state.
  let selectedIssueNumber = $state<number | null>(null)
  let showCreate = $state(false)
  let createLabels = $state<string[]>([])
  // Whether cloud Refine is available (an Anthropic API key is configured).
  // Defaults to false so Refine stays disabled until availability is confirmed.
  let aiAvailable = $state(false)
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
  let actionLoadRequest = 0
  let availabilityRequest = 0

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
      selectedIssueNumber = null
      showCreate = false
      createLabels = []
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

  async function withBusy(fn: () => Promise<void>) {
    error = null
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
      createLabels = []
      await loadBoard()
    })
  }

  async function refineTicketDraft(request: Omit<RefineTicketRequest, 'projectId'>): Promise<TicketDraft> {
    if (!projectId) throw new Error('Select a project before refining a ticket.')
    try {
      return await client.refineTicket({ projectId, ...request })
    } catch (e) {
      error = String(e instanceof Error ? e.message : e)
      throw e
    }
  }

  function openCreate(labels: string[] = []) {
    createLabels = [...labels]
    aiAvailable = false
    showCreate = true
    // Refresh availability each time the dialog opens so a key added in Settings
    // is reflected without reloading the board. Guard against a stale response
    // from an earlier open overwriting a newer one; on failure leave Refine off.
    const requestId = ++availabilityRequest
    void client
      .refineAvailable()
      .then((available) => {
        if (requestId === availabilityRequest) aiAvailable = available
      })
      .catch(() => {
        if (requestId === availabilityRequest) aiAvailable = false
      })
  }

  function closeCreate() {
    showCreate = false
    createLabels = []
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
    selectedIssueNumber = null
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
          onCardClick={(c) => (selectedIssueNumber = c.issueNumber)}
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
    initialLabels={createLabels}
    {busy}
    {aiAvailable}
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
