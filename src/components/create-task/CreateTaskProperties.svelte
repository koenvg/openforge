<script lang="ts">
  import Badge from '@openforge-app/plugin-sdk/ui/Badge.svelte'
  import Select from '@openforge-app/plugin-sdk/ui/Select.svelte'
  import Switch from '@openforge-app/plugin-sdk/ui/Switch.svelte'
  import TextField from '@openforge-app/plugin-sdk/ui/TextField.svelte'
  import SearchableSelect from '@openforge-app/plugin-sdk/ui/SearchableSelect.svelte'
  import {
    dedupeBranchesForSelector,
    type BranchListState,
    type BranchLocation,
  } from '../../lib/branchSelector'
  import {
    getEnvironmentSummaryLabel,
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

  const branchSelectorOptions = $derived(
    branchList.status === 'ready' ? dedupeBranchesForSelector(branchList.branches) : [],
  )
  const environmentSummaryLabel = $derived(getEnvironmentSummaryLabel(draft))

  // Title is a single either/or: the agent names the task, or the user does.
  // "AI-generated" is the auto-update flag; "custom" means a user-provided title.
  const titleMode = $derived(draft.taskDisplayTitleUpdatesEnabled ? 'ai' : 'custom')

  function selectTitleMode(mode: 'custom' | 'ai'): void {
    if (mode === 'ai') {
      draft.taskDisplayTitleUpdatesEnabled = true
      draft.title = ''
    } else {
      draft.taskDisplayTitleUpdatesEnabled = false
    }
  }

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

<aside class="create-task-properties" aria-labelledby="create-task-properties-heading">
  <h3 id="create-task-properties-heading" class="text-sm font-semibold text-[var(--of-text)]">Properties</h3>

  <div class="prop-section">
    <div class="prop-field">
      <span class="prop-label">Title</span>
      <div role="radiogroup" aria-label="Title mode" class="grid min-w-0 grid-cols-2">
        <label class="segmented-option" data-selected={titleMode === 'custom' ? '' : undefined}>
          <input
            type="radio"
            class="sr-only"
            aria-label="Custom title"
            name="create-task-title-mode"
            value="custom"
            checked={titleMode === 'custom'}
            onchange={() => selectTitleMode('custom')}
          />
          <span>Custom</span>
        </label>
        <label class="segmented-option" data-selected={titleMode === 'ai' ? '' : undefined}>
          <input
            type="radio"
            class="sr-only"
            aria-label="AI-generated title"
            name="create-task-title-mode"
            value="ai"
            checked={titleMode === 'ai'}
            onchange={() => selectTitleMode('ai')}
          />
          <span>AI-generated</span>
        </label>
      </div>
      {#if titleMode === 'custom'}
        <TextField
          aria-label="Task title"
          placeholder="Name this task"
          bind:value={draft.title}
        />
      {:else}
        <p class="prop-hint">The agent names this task and keeps it updated as work progresses.</p>
      {/if}
    </div>
  </div>

  <hr class="prop-divider" aria-hidden="true" />

  <div class="prop-section" role="group" aria-label={environmentSummaryLabel}>
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

    <div class="prop-field">
      <span class="prop-label">Workspace</span>
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
        <p class="prop-hint">
          No commits yet — worktrees need an initial commit. This task will run in the project directory.
        </p>
      {/if}
    </div>

    {#if draft.useWorktree}
      <div class="prop-field">
        <span class="prop-label">Base</span>
        <div role="radiogroup" aria-label="Worktree source" class="grid min-w-0 grid-cols-2">
          <label
            class="segmented-option"
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
            class="segmented-option"
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
        <div class="prop-field">
          <span class="prop-label">Branch</span>
          {#if branchSelectorOptions.length === 0}
            <div class="branch-placeholder" aria-label="Branch">
              {branchList.status === 'loading' ? 'Loading branches…' : 'No branches available'}
            </div>
          {:else}
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
          {/if}
          {#if branchList.status === 'error'}
            <span class="prop-error">{branchList.message}</span>
          {/if}
        </div>
      {/if}
    {/if}
  </div>

</aside>

<style>
  .create-task-properties {
    display: flex;
    flex-direction: column;
    gap: var(--of-space6);
    padding: var(--of-space6);
    border: var(--of-border-width) solid var(--of-border);
    border-radius: var(--of-radius-container);
    background: var(--of-surface);
    color: var(--of-text);
  }

  .prop-section {
    display: flex;
    flex-direction: column;
    gap: var(--of-space5);
  }

  .prop-field {
    display: flex;
    flex-direction: column;
    gap: var(--of-space3);
  }

  .prop-label {
    font-size: var(--of-text-xs);
    font-weight: var(--of-weight-medium);
    color: var(--of-text-muted);
  }

  .prop-hint {
    margin: 0;
    font-size: var(--of-text-xs);
    color: var(--of-text-muted);
  }

  .prop-error {
    font-size: var(--of-text-xs);
    color: var(--of-danger);
  }

  .prop-divider {
    height: var(--of-border-width);
    border: 0;
    margin: 0;
    background: var(--of-border);
  }

  .segmented-option {
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

  .segmented-option:first-child {
    border-radius: var(--of-radius-control) 0 0 var(--of-radius-control);
  }

  .segmented-option:last-child {
    margin-left: calc(var(--of-border-width) * -1);
    border-radius: 0 var(--of-radius-control) var(--of-radius-control) 0;
  }

  .segmented-option:hover {
    background: var(--of-control-hover);
  }

  .segmented-option[data-selected] {
    z-index: 1;
    border-color: var(--of-accent);
    background: var(--of-accent);
    color: var(--of-on-accent);
  }

  .segmented-option:has(input:focus-visible) {
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
