<script lang="ts">
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Checkbox from '@openforge-app/plugin-sdk/ui/Checkbox.svelte'
  import ResizablePanel from '@openforge-app/plugin-sdk/ui/ResizablePanel.svelte'
  import type { SelfReviewChangedFilesPane } from './selfReviewChangedFilesPane.svelte'
  import ResizableBottomPanel from '../shared/ui/ResizableBottomPanel.svelte'
  import FileTree from '../review/shared/FileTree.svelte'

  interface Props {
    pane: SelfReviewChangedFilesPane
  }

  let { pane }: Props = $props()
  let commits = $derived(pane.scope.commits)
  let selectedCommitSha = $derived(pane.scope.selectedCommitSha)
  let includeCommitted = $derived(pane.scope.includeCommitted)
  let includeUncommitted = $derived(pane.scope.includeUncommitted)
  let committedLocked = $derived(pane.scope.committedLocked)
  let uncommittedLocked = $derived(pane.scope.uncommittedLocked)
  let lockedScopeTooltip = $derived(pane.scope.lockedScopeTooltip)
  let onIncludeCommittedChange = $derived(pane.scope.onIncludeCommittedChange)
  let onIncludeUncommittedChange = $derived(pane.scope.onIncludeUncommittedChange)
  let onSelectCommit = $derived(pane.scope.onSelectCommit)

  let fileTree = $state<FileTree>()

  export function focusTree(): void {
    fileTree?.focusTree()
  }
</script>

<ResizablePanel storageKey="self-review-file-tree" defaultWidth={320} minWidth={240} maxWidth={520} side="left" label="Changed files">
  <section class="flex h-full flex-col border-r border-base-300 bg-base-100" aria-label="Changed files panel">
    <div class="flex-1 overflow-hidden">
      <FileTree
        bind:this={fileTree}
        files={pane.fileTree.files}
        onSelectFile={pane.fileTree.onSelectFile}
        onCollapse={pane.fileTree.onCollapse}
        onRequestFocusDiff={pane.fileTree.onRequestFocusDiff}
        reviewedFileShas={pane.fileTree.reviewedFileShas}
        getFileReviewIdentity={pane.fileTree.getFileReviewIdentity}
        onToggleFileReviewed={pane.fileTree.onToggleFileReviewed}
        includeNonApplicationFiles={pane.fileTree.includeNonApplicationFiles}
        nonApplicationFileCount={pane.fileTree.nonApplicationFileCount}
        onToggleNonApplicationFiles={pane.fileTree.onToggleNonApplicationFiles}
      />
    </div>
    <ResizableBottomPanel
      storageKey="self-review-commit-history"
      defaultHeight={220}
      minHeight={180}
      maxHeight={400}
      fillParent={false}
      panelTestId="self-review-commit-history-panel"
      handleTestId="self-review-commit-history-handle"
    >
      <div class="h-full flex flex-col border-t border-base-300 bg-base-200/70">
        <div class="flex min-h-10 items-center justify-between border-b border-base-300 bg-base-100 px-3 text-[13px] font-semibold text-base-content">
          <span>Scope</span>
          <span class="font-mono font-normal text-primary">merge-base...HEAD</span>
        </div>
        <div class="px-2 py-1.5 border-b border-base-300 bg-base-100/50">
          {#if selectedCommitSha === null}
            <div class="flex flex-col gap-1">
              <label
                class="flex min-h-10 items-center gap-2 {committedLocked ? 'cursor-not-allowed tooltip tooltip-right' : 'cursor-pointer'}"
                data-tip={committedLocked ? lockedScopeTooltip : null}
              >
                <Checkbox
                  aria-label="Include committed changes"
                  checked={includeCommitted}
                  disabled={committedLocked}
                  onchange={(event) => onIncludeCommittedChange(event.currentTarget.checked)}
                />
                <span class="text-[13px] text-base-content/75">Committed</span>
              </label>
              <label
                class="flex min-h-10 items-center gap-2 {uncommittedLocked ? 'cursor-not-allowed tooltip tooltip-right' : 'cursor-pointer'}"
                data-tip={uncommittedLocked ? lockedScopeTooltip : null}
              >
                <Checkbox
                  aria-label="Include uncommitted changes"
                  checked={includeUncommitted}
                  disabled={uncommittedLocked}
                  onchange={(event) => onIncludeUncommittedChange(event.currentTarget.checked)}
                />
                <span class="text-[13px] text-base-content/75">Uncommitted</span>
              </label>
            </div>
          {:else}
            <Button
              variant="ghost"
              size="sm"
              class="justify-start"
              onclick={() => onSelectCommit(null)}
            >
              Show all changes
            </Button>
          {/if}
        </div>
        <div class="flex-1 overflow-y-auto py-1">
          <button
            class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {selectedCommitSha === null ? 'bg-primary/5 text-primary' : 'text-base-content'}"
            onclick={() => onSelectCommit(null)}
          >
            <div class="text-[13px] font-semibold leading-snug">All changes</div>
            <div class="font-mono text-[13px] opacity-60">merge-base...HEAD</div>
          </button>
          {#each commits as commit (commit.sha)}
            <button
              class="flex flex-col w-full text-left px-3 py-2.5 gap-1 border-b border-base-200 last:border-b-0 hover:bg-base-300/50 transition-colors {selectedCommitSha === commit.sha ? 'bg-primary/5 text-primary' : 'text-base-content'}"
              onclick={() => onSelectCommit(commit.sha)}
              title={commit.message}
            >
              <div class="font-mono text-[13px] font-medium opacity-70">{commit.short_sha}</div>
              <div class="w-full truncate text-[13px] font-medium leading-snug">{commit.message}</div>
            </button>
          {/each}
        </div>
      </div>
    </ResizableBottomPanel>
  </section>
</ResizablePanel>
