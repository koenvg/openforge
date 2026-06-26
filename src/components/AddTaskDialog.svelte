<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task, PermissionMode, Action, GitBranchInfo, WorktreeSource } from '../lib/types'
  import { createTask, updateTask, getResolvedAiProvider, listGitBranches } from '../lib/ipc'
  import { getTaskPromptText } from '../lib/taskPrompt'
  import { activeProjectId } from '../lib/stores'
  import Modal from './shared/ui/Modal.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import { getEnabledActions, loadActions } from '../lib/actions'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    projectPath?: string | null
    onClose?: () => void
    onTaskSaved?: (task?: Task) => void | Promise<void>
    onRunAction?: (taskId: string, actionPrompt: string, agent: string | null) => Promise<void>
  }

  let { mode = 'create', task = null, projectPath = null, onClose, onTaskSaved, onRunAction }: Props = $props()

  let selectedPermissionMode = $state<PermissionMode>('default')
  let selectedWorktreeSource = $state<WorktreeSource>('newBranchFromMain')
  let selectedExistingBranch = $state('')
  let useWorktree = $state(true)
  let gitBranches = $state<GitBranchInfo[]>([])
  let branchLoadError = $state<string | null>(null)
  let aiProvider = $state<string | null>(null)
  let availableActions = $state<Action[]>([])
  let error = $state<string | null>(null)

  function buildWorktreeOptions(): { worktreeSource: WorktreeSource; worktreeBranch: string | null } {
    if (!useWorktree) {
      return { worktreeSource: 'disabled', worktreeBranch: null }
    }

    if (selectedWorktreeSource === 'existingBranch') {
      return { worktreeSource: selectedWorktreeSource, worktreeBranch: selectedExistingBranch.trim() }
    }

    return { worktreeSource: 'newBranchFromMain', worktreeBranch: null }
  }

  onMount(async () => {
    selectedPermissionMode = 'default'
    try {
      if ($activeProjectId) {
        aiProvider = await getResolvedAiProvider($activeProjectId)

        const allActions = await loadActions($activeProjectId)
        availableActions = getEnabledActions(allActions)

        if (projectPath) {
          try {
            gitBranches = await listGitBranches(projectPath)
            selectedExistingBranch = gitBranches.find((branch) => !branch.is_current)?.name ?? gitBranches[0]?.name ?? ''
          } catch (e) {
            console.error('Failed to list git branches:', e)
            branchLoadError = String(e)
            gitBranches = []
            selectedExistingBranch = ''
          }
        } else {
          gitBranches = []
          selectedExistingBranch = ''
        }
      } else {
        aiProvider = 'claude-code'
        availableActions = []
        gitBranches = []
        selectedExistingBranch = ''
      }
    } catch {
      aiProvider = null
      availableActions = []
      gitBranches = []
      selectedExistingBranch = ''
    }
  })

  async function handleCreateOrUpdate(prompt: string, actionPrompt: string | null = null, autoStart: boolean = false) {
    if (!$activeProjectId) return
    error = null

    try {
      let savedTask: Task

      if (mode === 'edit' && task) {
        await updateTask(task.id, prompt)
        savedTask = task
        await onTaskSaved?.()
      } else {
        if (useWorktree && selectedWorktreeSource === 'existingBranch' && selectedExistingBranch.trim() === '') {
          error = 'Select an existing branch'
          return
        }

        savedTask = await createTask(
          prompt,
          'backlog',
          $activeProjectId,
          selectedPermissionMode,
          buildWorktreeOptions()
        )

        if (autoStart && onRunAction) {
          onClose?.()
          await onRunAction(savedTask.id, actionPrompt || '', null)
          return
        } else {
          await onTaskSaved?.(savedTask)
        }
      }
      onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      error = String(e)
    }
  }
</script>

<Modal onClose={onClose} maxWidth="640px" overflowVisible initialFocus="textarea">
  {#snippet header()}
    <h2 class="text-[0.95rem] font-semibold text-base-content m-0">{mode === 'create' ? 'Create Task' : 'Edit Task'}</h2>
  {/snippet}

  <div class="p-4 overflow-visible">
    {#if error}
      <div class="text-error text-sm mb-4">{error}</div>
    {/if}
    <PromptInput
      projectId={$activeProjectId || ''}
      value={mode === 'edit' && task ? getTaskPromptText(task) : ''}
      autofocus={false}
      actions={mode === 'edit' ? [] : availableActions}
      commandTrigger={aiProvider === 'codex' ? 'dollar' : 'slash'}
      onSubmit={(prompt) => handleCreateOrUpdate(prompt)}
      onStartTask={mode === 'edit' ? undefined : (prompt) => handleCreateOrUpdate(prompt, '', true)}
      onRunAction={mode === 'edit' ? undefined : (prompt, actionPrompt) => handleCreateOrUpdate(prompt, actionPrompt, true)}
      onCancel={() => onClose?.()}
    >
      {#snippet extras()}
        {#if mode === 'create' && aiProvider === 'claude-code'}
          <div class="flex items-center gap-2">
            <span class="text-xs text-base-content/50 font-medium shrink-0">Mode</span>
            <select
              class="select select-bordered select-xs flex-1"
              bind:value={selectedPermissionMode}
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
        {#if mode === 'create'}
          <div class="grid grid-cols-[4.75rem_minmax(0,1fr)] items-start gap-x-3 gap-y-2">
            <span class="pt-1.5 text-xs font-medium text-base-content/50">Workspace</span>

            <div class="min-w-0 space-y-2">
              <div class="flex min-h-7 items-center justify-between gap-3">
                <label class="flex min-w-0 items-center gap-2 text-xs font-medium text-base-content/80">
                  <input
                    type="checkbox"
                    class="toggle toggle-primary toggle-xs"
                    aria-label="Worktree"
                    bind:checked={useWorktree}
                  />
                  <span>Worktree</span>
                </label>

                {#if !useWorktree}
                  <span class="badge badge-ghost badge-xs shrink-0">Project directory</span>
                {/if}
              </div>

              {#if useWorktree}
                <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
                  <span class="text-xs font-medium text-base-content/50">Base</span>
                  <div
                    role="radiogroup"
                    aria-label="Worktree source"
                    class="join grid min-w-0 grid-cols-2"
                  >
                    <label
                      class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                      class:btn-primary={selectedWorktreeSource === 'newBranchFromMain'}
                      class:btn-ghost={selectedWorktreeSource !== 'newBranchFromMain'}
                      class:border-base-300={selectedWorktreeSource !== 'newBranchFromMain'}
                      class:bg-base-100={selectedWorktreeSource !== 'newBranchFromMain'}
                    >
                      <input
                        type="radio"
                        class="sr-only"
                        aria-label="New branch from latest main"
                        bind:group={selectedWorktreeSource}
                        value="newBranchFromMain"
                      />
                      <span>Latest main</span>
                    </label>
                    <label
                      class="btn join-item btn-xs h-8 min-h-8 flex-1 text-xs focus-within:ring-2 focus-within:ring-primary"
                      class:btn-primary={selectedWorktreeSource === 'existingBranch'}
                      class:btn-ghost={selectedWorktreeSource !== 'existingBranch'}
                      class:border-base-300={selectedWorktreeSource !== 'existingBranch'}
                      class:bg-base-100={selectedWorktreeSource !== 'existingBranch'}
                    >
                      <input
                        type="radio"
                        class="sr-only"
                        aria-label="Existing branch"
                        bind:group={selectedWorktreeSource}
                        value="existingBranch"
                      />
                      <span>Existing branch</span>
                    </label>
                  </div>
                </div>

                {#if selectedWorktreeSource === 'existingBranch'}
                  <div class="grid grid-cols-[3.5rem_minmax(0,1fr)] items-center gap-2">
                    <span class="text-xs font-medium text-base-content/50">Branch</span>
                    <select
                      aria-label="Branch"
                      class="select select-bordered select-xs min-w-0 flex-1"
                      bind:value={selectedExistingBranch}
                      disabled={gitBranches.length === 0}
                    >
                      {#if gitBranches.length === 0}
                        <option value="">No branches available</option>
                      {:else}
                        {#each gitBranches as branch}
                          <option value={branch.name}>{branch.name}{branch.is_remote ? ' (remote)' : ''}</option>
                        {/each}
                      {/if}
                    </select>
                  </div>
                  {#if branchLoadError}
                    <span class="mt-1 block text-xs text-error">{branchLoadError}</span>
                  {/if}
                {/if}
              {/if}
            </div>
          </div>
        {/if}
      {/snippet}
    </PromptInput>
  </div>
</Modal>
