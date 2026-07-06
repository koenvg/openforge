<script lang="ts">
  interface Props {
    excludedRepos: Set<string>
    showFilterDropdown: boolean
    newRepoInput: string
    suggestedRepos: string[]
    onToggleDropdown: () => void
    onCloseDropdown: () => void
    onNewRepoInputChange: (value: string) => void
    onAddExcludedRepo: (repo: string) => void
    onRemoveExcludedRepo: (repo: string) => void
  }

  let {
    excludedRepos,
    showFilterDropdown,
    newRepoInput,
    suggestedRepos,
    onToggleDropdown,
    onCloseDropdown,
    onNewRepoInputChange,
    onAddExcludedRepo,
    onRemoveExcludedRepo,
  }: Props = $props()
</script>

<div class="relative">
  <button
    class="btn btn-ghost btn-sm gap-1 {excludedRepos.size > 0 ? 'text-warning' : 'text-base-content/50'}"
    title="Filter repositories"
    aria-label="Filter repositories"
    aria-haspopup="dialog"
    aria-expanded={showFilterDropdown}
    onclick={onToggleDropdown}
  >
    {#if excludedRepos.size > 0}
      <span class="badge badge-warning badge-xs">{excludedRepos.size}</span>
    {/if}
    Filter
  </button>
  {#if showFilterDropdown}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div role="presentation" class="fixed inset-0 z-40" onclick={onCloseDropdown}></div>
    <div class="absolute right-0 top-full mt-1 z-50 bg-base-100 border border-base-300 rounded-lg shadow-lg w-[320px] p-3" role="dialog" aria-label="Excluded repositories filter">
      <div class="text-xs font-semibold text-base-content/50 mb-2">Excluded Repositories</div>

      <form class="flex gap-1.5 mb-3" onsubmit={(event) => { event.preventDefault(); onAddExcludedRepo(newRepoInput) }}>
        <input
          type="text"
          class="input input-bordered input-xs flex-1"
          aria-label="Repository to exclude"
          placeholder="owner/repo"
          value={newRepoInput}
          oninput={(event) => onNewRepoInputChange(event.currentTarget.value)}
        />
        <button type="submit" class="btn btn-primary btn-xs" disabled={!newRepoInput.trim()}>Add</button>
      </form>

      {#if excludedRepos.size > 0}
        <div class="flex flex-col gap-1 mb-3 max-h-[160px] overflow-y-auto">
          {#each [...excludedRepos].sort() as repo}
            <div class="flex items-center justify-between px-2 py-1 rounded bg-base-200 text-sm">
              <span class="text-base-content truncate">{repo}</span>
              <button
                class="btn btn-ghost btn-xs text-base-content/40 hover:text-error"
                onclick={() => onRemoveExcludedRepo(repo)}
                title="Remove from exclusion list"
                aria-label="Remove {repo} from excluded repositories"
              ><span aria-hidden="true">✕</span></button>
            </div>
          {/each}
        </div>
      {:else}
        <div class="text-xs text-base-content/40 px-1 mb-3">No repositories excluded</div>
      {/if}

      {#if suggestedRepos.length > 0}
        <div class="border-t border-base-300 pt-2">
          <div class="text-xs text-base-content/40 mb-1.5">Quick add from open PRs</div>
          <div class="flex flex-wrap gap-1">
            {#each suggestedRepos as repo}
              <button
                class="btn btn-ghost btn-xs text-base-content/60"
                aria-label="Exclude {repo} from pull request lists"
                onclick={() => onAddExcludedRepo(repo)}
              >+ {repo}</button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}
</div>
