<script lang="ts">
  import { onDestroy } from 'svelte'
  import { RefreshCw, Plus, Columns3 } from '@lucide/svelte'
  import type { FrontendOpenForgeAPI, OpenForgeContextSnapshot } from '@openforge-app/plugin-sdk/frontend'
  import PluginPageHeader from '@openforge-app/plugin-sdk/ui/PluginPageHeader.svelte'
  import PluginViewState from '@openforge-app/plugin-sdk/ui/PluginViewState.svelte'
  import Board from './Board.svelte'
  import CardDrawer from './CardDrawer.svelte'
  import CreateDialog from './CreateDialog.svelte'
  import ColumnSettingsModal from './ColumnSettingsModal.svelte'
  import { useRoadmapBoard } from './useRoadmapBoard.svelte'
  import { useRoadmapColumnSettings } from './useRoadmapColumnSettings.svelte'
  import { useRoadmapCreateDialog } from './useRoadmapCreateDialog.svelte'
  import { useRoadmapDrawer } from './useRoadmapDrawer.svelte'

  interface Props {
    api: FrontendOpenForgeAPI
    context?: OpenForgeContextSnapshot
    projectName?: string
    projectPath?: string
    projectId?: string | null
  }

  let { api, context: _context, projectName = '', projectPath: _projectPath = '', projectId = null }: Props =
    $props()

  // `api` is stable for the plugin view lifetime; capture it once in the controller.
  // svelte-ignore state_referenced_locally
  const roadmap = useRoadmapBoard(api)
  const drawer = useRoadmapDrawer(() => roadmap.board)
  // svelte-ignore state_referenced_locally
  const createDialog = useRoadmapCreateDialog(api, roadmap)
  const columnSettings = useRoadmapColumnSettings(roadmap)

  // Reset view-local state only when the logical project changes. This intentionally
  // has no effect cleanup: prop identity churn for the same project must not close resources.
  $effect(() => {
    const pid = projectId
    if (roadmap.activateProject(pid)) {
      drawer.close()
      createDialog.close()
      columnSettings.close()
    }
  })

  function openUrl(url: string): void {
    void api.system.openUrl(url)
  }

  async function copyLink(issueNumber: number): Promise<void> {
    if (!roadmap.repoSlug) return
    const url = `https://github.com/${roadmap.repoSlug}/issues/${issueNumber}`
    try {
      await navigator.clipboard.writeText(url)
    } catch {
      openUrl(url)
    }
  }

  async function setValue(value: number | null): Promise<void> {
    if (drawer.openIssueNumber === null) return
    await roadmap.setValue(drawer.openIssueNumber, value)
  }

  async function saveText(title: string, body: string): Promise<boolean> {
    if (drawer.openIssueNumber === null) return false
    return roadmap.saveText(drawer.openIssueNumber, title, body)
  }

  async function toggleLabel(name: string, currentlyOn: boolean): Promise<void> {
    if (drawer.openIssueNumber === null) return
    await roadmap.toggleLabel(drawer.openIssueNumber, name, currentlyOn)
  }

  async function closeIssue(): Promise<void> {
    const issueNumber = drawer.openIssueNumber
    if (issueNumber === null) return
    const closed = await roadmap.closeIssue(issueNumber)
    if (!closed) return

    // Advance before refreshing so the drawer does not unmount on the missing card.
    drawer.advancePastClosed(issueNumber)
    await roadmap.loadBoard()
  }


  function openTask(taskId: string): void {
    if (!projectId) return
    void api.navigation.navigate({ projectId, viewId: 'board', taskId })
  }

  onDestroy(() => {
    drawer.close()
  })
</script>

<div class="flex flex-col h-full overflow-hidden">
  <PluginPageHeader
    title={projectName || 'Roadmap'}
    subtitle={roadmap.repoSlug || 'Roadmap board'}
  >
    {#snippet actions()}
      <div class="flex items-center gap-2 shrink-0">
        <button class="btn btn-sm" onclick={() => createDialog.show()} disabled={!roadmap.board || roadmap.busy}>
          <Plus size={14} /> Create
        </button>
        <button class="btn btn-sm" onclick={columnSettings.show} disabled={!roadmap.board || roadmap.busy}>
          <Columns3 size={14} /> Columns
        </button>
        <button class="btn btn-sm" onclick={() => roadmap.loadBoard()} disabled={roadmap.isLoading || !projectId}>
          <RefreshCw size={14} class={roadmap.isLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>
    {/snippet}
  </PluginPageHeader>

  <div class="flex-1 overflow-hidden">
    <PluginViewState
      loading={roadmap.isLoading && !roadmap.board}
      loadingLabel="Loading board…"
      error={projectId && roadmap.error && !roadmap.board ? roadmap.error : null}
      errorTitle="No GitHub board for this project."
      empty={!projectId}
      emptyTitle="Select a project to view its roadmap."
    >
      {#if roadmap.board}
        <Board
          columns={roadmap.board.columns}
          repo={roadmap.repoSlug}
          busy={roadmap.busy}
          onCardClick={drawer.openFrom}
          onOpenUrl={openUrl}
          onCopyLink={copyLink}
          onRecolor={(name, color) => {
            void roadmap.recolorLabel(name, color).catch(() => undefined)
          }}
          onStart={(card) => {
            void roadmap.runIssueAction(card)
          }}
          onAddCard={(label) => createDialog.show(label ? [label] : [])}
        />
      {/if}
    </PluginViewState>
  </div>
</div>

{#if drawer.open && drawer.selectedCard && roadmap.board}
  <CardDrawer
    card={drawer.selectedCard}
    repo={roadmap.repoSlug}
    allLabels={roadmap.repoLabels}
    busy={roadmap.busy}
    index={drawer.open.index}
    total={drawer.open.issueNumbers.length}
    groupTitle={drawer.open.groupTitle}
    onPrev={() => drawer.go(-1)}
    onNext={() => drawer.go(1)}
    onClose={drawer.close}
    onOpenUrl={openUrl}
    onCopyLink={copyLink}
    onSaveText={saveText}
    onSetValue={setValue}
    onToggleLabel={toggleLabel}
    onCloseIssue={closeIssue}
    onOpenTask={openTask}
  />
{/if}

{#if createDialog.open && roadmap.board}
  <CreateDialog
    labelOptions={roadmap.repoLabels}
    initialLabels={createDialog.initialLabels}
    busy={roadmap.busy}
    hasApiKey={createDialog.hasApiKey}
    onClose={createDialog.close}
    onCreate={createDialog.createIssue}
    onRefine={createDialog.refineTicketDraft}
    onOpenUrl={openUrl}
  />
{/if}

{#if columnSettings.open && roadmap.board}
  <ColumnSettingsModal
    repo={roadmap.repoSlug}
    labels={columnSettings.labels}
    initialColumnLabels={columnSettings.columnLabels}
    busy={roadmap.busy}
    error={roadmap.error}
    onClose={columnSettings.close}
    onSave={columnSettings.save}
    onRecolor={roadmap.recolorLabel}
  />
{/if}
