<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import IconButton from '@openforge-app/plugin-sdk/ui/IconButton.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
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
  <Button
    variant="ghost"
    size="sm"
    class="gap-1 {excludedRepos.size > 0 ? 'text-warning' : 'text-base-content/50'}"
    title="Filter repositories"
    aria-label="Filter repositories"
    aria-haspopup="dialog"
    aria-expanded={showFilterDropdown}
    onclick={onToggleDropdown}
  >
    {#if excludedRepos.size > 0}
      <Badge variant="warning">{excludedRepos.size}</Badge>
    {/if}
    Filter
  </Button>
  {#if showFilterDropdown}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div role="presentation" class="fixed inset-0 z-40" onclick={onCloseDropdown}></div>
    <Panel
      variant="raised"
      class="absolute right-0 top-full z-50 mt-1 w-[320px]"
      role="dialog"
      aria-label="Excluded repositories filter"
    >
      <div class="mb-2 text-xs font-semibold text-base-content/50">Excluded Repositories</div>

      <form class="mb-3 flex items-end gap-1.5" onsubmit={(event) => { event.preventDefault(); onAddExcludedRepo(newRepoInput) }}>
        <div class="min-w-0 flex-1">
          <TextField
            label="Repository to exclude"
            placeholder="owner/repo"
            value={newRepoInput}
            onValueChange={onNewRepoInputChange}
          />
        </div>
        <Button type="submit" size="xs" disabled={!newRepoInput.trim()}>Add</Button>
      </form>

      {#if excludedRepos.size > 0}
        <div class="mb-3 flex max-h-[160px] flex-col gap-1 overflow-y-auto">
          {#each [...excludedRepos].sort() as repo}
            <div class="flex items-center justify-between bg-base-200 px-2 py-1 text-sm">
              <span class="truncate text-base-content">{repo}</span>
              <IconButton
                variant="ghost"
                size="xs"
                class="text-base-content/40 hover:text-error"
                label={`Remove ${repo} from excluded repositories`}
                title="Remove from exclusion list"
                onclick={() => onRemoveExcludedRepo(repo)}
              ><span aria-hidden="true">✕</span></IconButton>
            </div>
          {/each}
        </div>
      {:else}
        <div class="mb-3 px-1 text-xs text-base-content/40">No repositories excluded</div>
      {/if}

      {#if suggestedRepos.length > 0}
        <div class="border-t border-base-300 pt-2">
          <div class="mb-1.5 text-xs text-base-content/40">Quick add from open PRs</div>
          <div class="flex flex-wrap gap-1">
            {#each suggestedRepos as repo}
              <Button
                variant="ghost"
                size="xs"
                class="text-base-content/60"
                aria-label={`Exclude ${repo} from pull request lists`}
                onclick={() => onAddExcludedRepo(repo)}
              >+ {repo}</Button>
            {/each}
          </div>
        </div>
      {/if}
    </Panel>
  {/if}
</div>
