<script lang="ts">
  import { FolderGit2, GitBranch, ShieldCheck } from '@lucide/svelte'
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Button from '@openforge-app/plugin-sdk/ui/Button.svelte'
  import Panel from '@openforge-app/plugin-sdk/ui/Panel.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import {
    dedupeBranchesForSelector,
    type BranchListState,
    type BranchLocation,
  } from '../../lib/branchSelector'
  import SearchableSelect from '@openforge-app/plugin-sdk/ui/SearchableSelect.svelte'
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

  const branchLocationBadge: Record<BranchLocation, { text: string; variant: 'neutral' | 'info' | 'success' }> = {
    local: { text: 'local', variant: 'neutral' },
    remote: { text: 'remote', variant: 'info' },
    both: { text: 'local+remote', variant: 'success' },
  }

  const permissionModeOptions = [
    { value: 'default', label: 'Default' },
    { value: 'auto', label: 'Autorun' },
    { value: 'acceptEdits', label: 'Accept Edits' },
    { value: 'plan', label: 'Plan' },
    { value: 'bypassPermissions', label: 'Bypass Permissions' },
    { value: 'dontAsk', label: "Don't Ask (dangerous)" },
  ] as const
</script>

<Panel aria-labelledby="create-task-environment-heading">
  <div class="space-y-3">
  <div class="flex items-center justify-between gap-3">
    <h3 id="create-task-environment-heading" class="text-sm font-semibold text-[var(--of-text)]">Environment</h3>
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-expanded={environmentExpanded}
      aria-label={environmentExpanded ? 'Finish editing environment' : 'Edit environment'}
      aria-controls="create-task-environment"
      onclick={() => { environmentExpanded = !environmentExpanded }}
    >{environmentExpanded ? 'Done' : 'Edit'}<span class="sr-only"> environment</span></Button>
  </div>

  <div class="grid gap-3 sm:grid-cols-3" role="group" aria-label={environmentSummaryLabel}>
    <div class="flex min-w-0 items-start gap-3">
      <FolderGit2 size={18} class="mt-0.5 shrink-0 text-[var(--of-icon-muted)]" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">{draft.useWorktree ? 'Worktree' : 'Project directory'}</span>
        <span class="block truncate text-xs text-[var(--of-text-muted)]">
          {draft.useWorktree && draft.worktreeSource === 'existingBranch' ? (draft.existingBranch || 'Choose branch') : 'latest main'}
        </span>
      </div>
    </div>
    <div class="flex min-w-0 items-start gap-3">
      <GitBranch size={18} class="mt-0.5 shrink-0 text-[var(--of-icon-muted)]" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">Base: {draft.worktreeSource === 'existingBranch' ? (draft.existingBranch || 'branch') : 'main'}</span>
        <span class="block text-xs text-[var(--of-text-muted)]">Latest available</span>
      </div>
    </div>
    <div class="flex min-w-0 items-start gap-3">
      <ShieldCheck size={18} class="mt-0.5 shrink-0 text-[var(--of-icon-muted)]" aria-hidden="true" />
      <div class="min-w-0">
        <span class="block truncate text-sm font-medium">Permissions</span>
        <span class="block truncate text-xs text-[var(--of-text-muted)]">{permissionModeSummary}</span>
      </div>
    </div>
  </div>

  {#if environmentExpanded}
    <Panel id="create-task-environment" variant="subtle">
      <div class="space-y-3">
        <Select
          id="create-task-ai-provider"
          label="Provider"
          options={aiProviderOptions}
          value={draft.aiProvider ?? 'claude-code'}
          onValueChange={(value) => { draft.aiProvider = value }}
        />

      {#if draft.aiProvider === 'claude-code' || draft.aiProvider === 'grok'}
        <Select
          id="create-task-permission-mode"
          label="Mode"
          options={permissionModeOptions}
          value={draft.permissionMode}
          onValueChange={(value) => { draft.permissionMode = value as CreateTaskDraft['permissionMode'] }}
        />
      {/if}

      <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
        <span class="pt-1.5 text-xs font-medium text-[var(--of-text-muted)]">Workspace</span>
        <div class="min-w-0 space-y-2">
          <div class="flex min-h-7 items-center justify-between gap-3">
            <Switch
              label="Worktree"
              bind:checked={draft.useWorktree}
              disabled={!worktreeAllowed}
            />
            {#if !draft.useWorktree}
              <Badge class="shrink-0">Project directory</Badge>
            {/if}
          </div>

          {#if !worktreeAllowed}
            <p class="text-xs text-[var(--of-text-muted)]">
              No commits yet — worktrees need an initial commit. This task will run in the project directory.
            </p>
          {/if}

          {#if draft.useWorktree}
            <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
              <span class="text-xs font-medium text-[var(--of-text-muted)]">Base</span>
              <div role="radiogroup" aria-label="Worktree source" class="grid min-w-0 grid-cols-2">
                <label
                  class="worktree-source-option"
                  data-selected={draft.worktreeSource === 'newBranchFromMain' ? '' : undefined}
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
                  class="worktree-source-option"
                  data-selected={draft.worktreeSource === 'existingBranch' ? '' : undefined}
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
                <span class="text-xs font-medium text-[var(--of-text-muted)]">Branch</span>
                {#if branchSelectorOptions.length === 0}
                  <div class="branch-placeholder" aria-label="Branch">
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
                        badgeVariant: branchLocationBadge[option.location].variant,
                      }))}
                      value={draft.existingBranch}
                      onSelect={(value) => { draft.existingBranch = value }}
                    />
                  </div>
                {/if}
              </div>
              {#if branchList.status === 'error'}
                <span class="mt-1 block text-xs text-[var(--of-danger)]">{branchList.message}</span>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
      </div>
    </Panel>
  {/if}
  </div>
</Panel>

<style>
  .worktree-source-option {
    display: inline-flex;
    min-height: var(--of-control-height-compact);
    align-items: center;
    justify-content: center;
    padding-inline: var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    background: var(--of-control);
    color: var(--of-control-text);
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-medium);
    cursor: pointer;
  }

  .worktree-source-option:first-child {
    border-radius: var(--of-radius-control) 0 0 var(--of-radius-control);
  }

  .worktree-source-option:last-child {
    margin-left: calc(var(--of-border-width) * -1);
    border-radius: 0 var(--of-radius-control) var(--of-radius-control) 0;
  }

  .worktree-source-option:hover {
    background: var(--of-control-hover);
  }

  .worktree-source-option[data-selected] {
    z-index: 1;
    border-color: var(--of-accent);
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  .worktree-source-option:has(input:focus-visible) {
    outline: var(--of-focus-width) solid var(--of-focus-ring);
    outline-offset: var(--of-space1);
  }

  .branch-placeholder {
    display: flex;
    min-width: 0;
    min-height: var(--of-control-height-compact);
    align-items: center;
    padding-inline: var(--of-space3);
    border: var(--of-border-width) solid var(--of-border-interactive);
    border-radius: var(--of-radius-control);
    background: var(--of-control-disabled);
    color: var(--of-control-text-disabled);
    font-size: var(--of-text-xs);
  }
</style>
