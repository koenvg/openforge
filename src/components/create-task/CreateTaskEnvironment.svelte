<script lang="ts">
  import { FolderGit2, GitBranch, ShieldCheck } from '@lucide/svelte'
  import {
    dedupeBranchesForSelector,
    type BranchListState,
    type BranchLocation,
  } from '../../lib/branchSelector'
  import SearchableSelect from '../shared/ui/SearchableSelect.svelte'
  import {
    getEnvironmentSummaryLabel,
    getPermissionModeSummary,
    type CreateTaskDraft,
  } from './createTaskDraft'

  interface ProviderOption {
    value: string
    label: string
  }

  interface Props {
    draft: CreateTaskDraft
    worktreeAllowed: boolean
    branchList: BranchListState
    aiProviderOptions: readonly ProviderOption[]
  }

  let {
    draft = $bindable(),
    worktreeAllowed,
    branchList,
    aiProviderOptions,
  }: Props = $props()

  let environmentExpanded = $state(false)
  const branchSelectorOptions = $derived(
    branchList.status === 'ready' ? dedupeBranchesForSelector(branchList.branches) : [],
  )
  const permissionModeSummary = $derived(getPermissionModeSummary(draft.permissionMode))
  const environmentSummaryLabel = $derived(getEnvironmentSummaryLabel(draft))

  const branchLocationBadge: Record<BranchLocation, { text: string; class: string }> = {
    local: { text: 'local', class: 'badge-ghost' },
    remote: { text: 'remote', class: 'badge-info' },
    both: { text: 'local+remote', class: 'badge-success' },
  }
</script>

<section class="space-y-3 rounded-xl border border-base-300 bg-base-100 p-4" aria-labelledby="create-task-environment-heading">
  <div class="flex items-center justify-between gap-3">
    <h3 id="create-task-environment-heading" class="text-sm font-semibold text-base-content">Environment</h3>
    <button
      type="button"
      class="btn btn-ghost btn-sm"
      aria-expanded={environmentExpanded}
      aria-label={environmentExpanded ? 'Finish editing environment' : 'Edit environment'}
      aria-controls="create-task-environment"
      onclick={() => { environmentExpanded = !environmentExpanded }}
    >{environmentExpanded ? 'Done' : 'Edit'}<span class="sr-only"> environment</span></button>
  </div>

  <div class="grid gap-3 sm:grid-cols-3" role="group" aria-label={environmentSummaryLabel}>
    <div class="flex min-w-0 items-start gap-3">
      <FolderGit2 size={18} class="mt-0.5 shrink-0 text-base-content/65" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">{draft.useWorktree ? 'Worktree' : 'Project directory'}</span>
        <span class="block truncate text-xs text-base-content/50">
          {draft.useWorktree && draft.worktreeSource === 'existingBranch' ? (draft.existingBranch || 'Choose branch') : 'latest main'}
        </span>
      </div>
    </div>
    <div class="flex min-w-0 items-start gap-3">
      <GitBranch size={18} class="mt-0.5 shrink-0 text-base-content/65" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">Base: {draft.worktreeSource === 'existingBranch' ? (draft.existingBranch || 'branch') : 'main'}</span>
        <span class="block text-xs text-base-content/50">Latest available</span>
      </div>
    </div>
    <div class="flex min-w-0 items-start gap-3">
      <ShieldCheck size={18} class="mt-0.5 shrink-0 text-base-content/65" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">Permissions</span>
        <span class="block truncate text-xs text-base-content/50">{permissionModeSummary}</span>
      </div>
    </div>
  </div>

  {#if environmentExpanded}
    <div id="create-task-environment" class="space-y-3 rounded-lg border border-base-300 bg-base-200/50 p-3">
      <div class="flex items-center gap-2">
        <label for="create-task-ai-provider" class="shrink-0 text-xs font-medium text-base-content/50">Provider</label>
        <select
          id="create-task-ai-provider"
          class="select select-bordered select-sm flex-1"
          value={draft.aiProvider ?? 'claude-code'}
          onchange={(event) => { draft.aiProvider = event.currentTarget.value }}
        >
          {#each aiProviderOptions as option (option.value)}
            <option value={option.value}>{option.label}</option>
          {/each}
        </select>
      </div>

      {#if draft.aiProvider === 'claude-code' || draft.aiProvider === 'grok'}
        <div class="flex items-center gap-2">
          <label for="create-task-permission-mode" class="shrink-0 text-xs font-medium text-base-content/50">Mode</label>
          <select
            id="create-task-permission-mode"
            class="select select-bordered select-xs flex-1"
            bind:value={draft.permissionMode}
          >
            <option value="default">Default</option>
            <option value="auto">Autorun</option>
            <option value="acceptEdits">Accept Edits</option>
            <option value="plan">Plan</option>
            <option value="bypassPermissions">Bypass Permissions</option>
            <option value="dontAsk">Don't Ask (dangerous)</option>
          </select>
        </div>
      {/if}

      <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <span class="pt-1.5 text-xs font-medium text-base-content/50">Workspace</span>
        <div class="min-w-0 space-y-2">
          <div class="flex min-h-7 items-center justify-between gap-3">
            <label class="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/80">
              <input
                type="checkbox"
                class="toggle toggle-primary toggle-xs"
                aria-label="Worktree"
                bind:checked={draft.useWorktree}
                disabled={!worktreeAllowed}
              />
              <span>Worktree</span>
            </label>
            {#if !draft.useWorktree}
              <span class="badge badge-ghost badge-xs shrink-0">Project directory</span>
            {/if}
          </div>

          {#if !worktreeAllowed}
            <p class="text-xs text-base-content/50">
              No commits yet — worktrees need an initial commit. This task will run in the project directory.
            </p>
          {/if}

          {#if draft.useWorktree}
            <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
              <span class="text-xs font-medium text-base-content/50">Base</span>
              <div role="radiogroup" aria-label="Worktree source" class="join grid min-w-0 grid-cols-2">
                <label
                  class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                  class:btn-primary={draft.worktreeSource === 'newBranchFromMain'}
                  class:btn-ghost={draft.worktreeSource !== 'newBranchFromMain'}
                  class:border-base-300={draft.worktreeSource !== 'newBranchFromMain'}
                  class:bg-base-100={draft.worktreeSource !== 'newBranchFromMain'}
                >
                  <input
                    type="radio"
                    class="sr-only"
                    aria-label="New branch from latest main"
                    bind:group={draft.worktreeSource}
                    value="newBranchFromMain"
                  />
                  <span>Latest main</span>
                </label>
                <label
                  class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                  class:btn-primary={draft.worktreeSource === 'existingBranch'}
                  class:btn-ghost={draft.worktreeSource !== 'existingBranch'}
                  class:border-base-300={draft.worktreeSource !== 'existingBranch'}
                  class:bg-base-100={draft.worktreeSource !== 'existingBranch'}
                >
                  <input
                    type="radio"
                    class="sr-only"
                    aria-label="Existing branch"
                    bind:group={draft.worktreeSource}
                    value="existingBranch"
                  />
                  <span>Existing branch</span>
                </label>
              </div>
            </div>

            {#if draft.worktreeSource === 'existingBranch'}
              <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
                <span class="text-xs font-medium text-base-content/50">Branch</span>
                {#if branchSelectorOptions.length === 0}
                  <div class="select select-bordered select-xs flex min-w-0 flex-1 items-center text-base-content/40" aria-label="Branch">
                    {branchList.status === 'loading' ? 'Loading branches…' : 'No branches available'}
                  </div>
                {:else}
                  <div class="min-w-0">
                    <SearchableSelect
                      ariaLabel="Branch"
                      size="xs"
                      placeholder="Search branches…"
                      options={branchSelectorOptions.map((option) => ({
                        value: option.value,
                        label: option.label,
                        badge: branchLocationBadge[option.location].text,
                        badgeClass: branchLocationBadge[option.location].class,
                      }))}
                      value={draft.existingBranch}
                      onSelect={(value) => { draft.existingBranch = value }}
                    />
                  </div>
                {/if}
              </div>
              {#if branchList.status === 'error'}
                <span class="mt-1 block text-xs text-error">{branchList.message}</span>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    </div>
  {/if}
</section>
