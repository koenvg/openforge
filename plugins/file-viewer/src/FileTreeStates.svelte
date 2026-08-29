<script lang="ts">
  import ProjectFileTree from '@openforge-app/plugin-sdk/ui/ProjectFileTree.svelte'
  import type { FileTreeStatesActions, FileTreeStatesModel } from './lib/fileBrowserView'

  interface Props {
    model: FileTreeStatesModel
    actions: FileTreeStatesActions
  }

  let { model, actions }: Props = $props()
</script>

{#if model.directoryError !== null}
  <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
    <div class="space-y-2">
      <div>
        <p class="font-medium text-base-content break-all">Unable to load directory {model.directoryError.path}</p>
        <p class="mt-1 text-error break-words">{model.directoryError.message}</p>
      </div>
      <button
        class="btn btn-xs btn-outline"
        type="button"
        onclick={() => actions.onRetryDirectoryLoad(model.directoryError?.path ?? '')}
      >
        Retry loading {model.directoryError.path} directory
      </button>
    </div>
  </div>
{/if}
{#if model.failedRevealPath !== null}
  <div class="border-b border-base-300 bg-base-100 p-3 text-xs">
    <div class="space-y-2">
      <p class="font-medium text-base-content break-all">Unable to reveal {model.failedRevealPath}</p>
      <button
        class="btn btn-xs btn-outline"
        type="button"
        onclick={() => actions.onRetryRevealPath(model.failedRevealPath ?? '')}
      >
        Retry revealing {model.failedRevealPath}
      </button>
    </div>
  </div>
{/if}
<div class="min-h-0 flex-1">
  {#if model.search.active}
    {#if model.search.error !== null}
      <div class="p-3 text-xs">
        <div class="space-y-2">
          <div>
            <p class="font-medium text-base-content">File search failed</p>
            <p class="mt-1 text-error break-words">{model.search.error}</p>
          </div>
          <button class="btn btn-xs btn-outline" type="button" onclick={actions.onRetrySearch}>
            Retry file search
          </button>
        </div>
      </div>
    {:else if model.search.entries.length > 0}
      <div class="flex h-full min-h-0 flex-col">
        <div class="min-h-0 flex-1">
          <ProjectFileTree
            entries={model.search.entries}
            expandedDirs={model.search.expandedDirs}
            selectedPath={model.selectedPath}
            onToggleDir={() => {}}
            onSelectFile={actions.onSelectFile}
          />
        </div>
        {#if model.search.limitReached}
          <div class="border-t border-base-300 px-3 py-1.5 text-center text-[0.7rem] text-base-content/50">
            Showing top {model.search.limit} results
          </div>
        {/if}
      </div>
    {:else if model.search.loading}
      <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
        Searching…
      </div>
    {:else}
      <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
        No files match your search
      </div>
    {/if}
  {:else if model.rootEntries.length === 0}
    <div class="flex items-center justify-center h-full text-base-content/50 text-xs p-4 text-center">
      This project folder is empty
    </div>
  {:else}
    <ProjectFileTree
      entries={model.flatEntries}
      expandedDirs={model.expandedPaths}
      selectedPath={model.selectedPath}
      onToggleDir={actions.onToggleDir}
      onSelectFile={actions.onSelectFile}
      initialScrollTop={model.treeScrollTop}
      onScrollTopChange={actions.onTreeScrollTopChange}
      focusSelectedRequest={model.treeFocusRequest}
    />
  {/if}
</div>
