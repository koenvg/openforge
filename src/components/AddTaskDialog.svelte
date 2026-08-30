<script lang="ts">
  import { onMount } from 'svelte'
  import type { Task } from '../lib/types'
  import { createTask, updateTaskInitialPrompt, listGitBranches, repoHasCommits } from '../lib/ipc'
  import { loadTaskLevelDefaults } from '../lib/taskDefaults'
  import { HIERARCHICAL_SETTINGS } from '../lib/hierarchicalSettings'
  import { dedupeBranchesForSelector, matchExistingBranchSeed, type BranchListState, type BranchSelectorOption } from '../lib/branchSelector'
  import type { WorktreeSource } from '../lib/types'
  import { resolveWorktreeAvailability } from '../lib/worktreeAvailability'
  import { getTaskPromptText } from '../lib/taskPrompt'
  import { activeProjectId } from '../lib/stores'
  import Modal from '@openforge-app/plugin-sdk/ui/Modal.svelte'
  import PromptInput from './prompt/PromptInput.svelte'
  import InjectionPointSlot from './plugin/InjectionPointSlot.svelte'
  import CreateTaskEnvironment from './create-task/CreateTaskEnvironment.svelte'
  import CreateTaskProgressiveSettings from './create-task/CreateTaskProgressiveSettings.svelte'
  import CreateTaskPromptAttachments from './create-task/CreateTaskPromptAttachments.svelte'
  import { createTaskDraft, getWorktreeOptions } from './create-task/createTaskDraft'
  import type { InjectionPointLocation } from '@openforge-app/plugin-sdk'

  interface Props {
    mode?: 'create' | 'edit'
    task?: Task | null
    projectPath?: string | null
    projectName?: string | null
    /** Seeds the prompt in create mode — used when a plugin composes a task. */
    promptSeed?: string
    sourceTicketUrlSeed?: string | null
    titleSeed?: string | null
    worktreeSourceSeed?: WorktreeSource | null
    worktreeBranchSeed?: string | null
    onClose?: () => void
    onTaskSaved?: (task?: Task, options?: { started: boolean }) => void | Promise<void>
    onRunAction?: (taskId: string, actionPrompt: string) => Promise<void>
  }

  // Provider choices come from the shared settings registry so the task-level
  // control never drifts from the global/project provider options.
  const aiProviderOptions = HIERARCHICAL_SETTINGS.find((setting) => setting.key === 'ai_provider')?.options ?? []

  let { mode = 'create', task = null, projectPath = null, projectName = null, promptSeed = '', sourceTicketUrlSeed = null, titleSeed = null, worktreeSourceSeed = null, worktreeBranchSeed = null, onClose, onTaskSaved, onRunAction }: Props = $props()
  const dialogTitle = $derived(mode === 'create' ? 'Create task' : 'Edit task')

  let draft = $state(createTaskDraft())
  // False when the selected repo has no commits yet (unborn HEAD): a worktree
  // cannot branch from a repo with no base commit, so the toggle is disabled and
  // the task falls back to running in the project directory.
  let worktreeAllowed = $state(true)
  let error = $state<string | null>(null)
  let taskDefaultsError = $state<string | null>(null)
  let promptDraft = $state('')
  let promptEditor = $state<{ insertText: (text: string) => void } | null>(null)
  let lastInitialPrompt = $state<string | null>(null)
  let isSaving = $state(false)
  let submissionIntent = $state<'backlog' | 'start' | null>(null)
  let promptAttachments = $state<CreateTaskPromptAttachments>()
  let imageMarkerInsertRequest = $state<{ id: number, marker: string } | null>(null)
  let injectableInsertRequest = $state<{ id: number, text: string } | null>(null)
  let nextImageMarkerInsertRequestId = 1
  let nextInjectableInsertRequestId = 1
  let injectionLocation = $derived<InjectionPointLocation>(mode === 'create' ? 'createTaskPrompt' : 'backlogPrompt')
  let lastTitleSeed = $state<string | null>(null)
  let lastSourceTicketSeed = $state<string | null>(null)
  let lastWorktreeSourceSeed = $state<WorktreeSource | null>(null)
  let lastWorktreeBranchSeed = $state<string | null>(null)
  let taskDefaultsLoading = $state(true)
  // Tracked apart from the task defaults so submission never waits on origin.
  let branchList = $state<BranchListState>({ status: 'loading' })
  // Identifies the current branch load so a late reply from a superseded load
  // cannot overwrite the branches of the run that replaced it.
  let branchLoadRun = 0

  const initialPrompt = $derived(mode === 'edit' && task ? getTaskPromptText(task) : promptSeed)
  const promptReady = $derived(promptDraft.trim().length > 0)
  const createReady = $derived((mode !== 'create' || (!taskDefaultsLoading && !taskDefaultsError)) && !isSaving)

  $effect(() => {
    if (initialPrompt === lastInitialPrompt) return
    promptDraft = initialPrompt
    lastInitialPrompt = initialPrompt
  })

  // Seeds are applied both here and from initializeDialog, which replaces the
  // whole draft on mount. Comparing against the last seed means a compose
  // request can re-seed a dialog that never unmounted, without clobbering edits
  // the user has since made.
  function applySeedsToDraft() {
    draft.title = titleSeed ?? ''
    draft.sourceTicketUrl = sourceTicketUrlSeed ?? ''
    lastTitleSeed = titleSeed
    lastSourceTicketSeed = sourceTicketUrlSeed
    lastWorktreeSourceSeed = worktreeSourceSeed
    lastWorktreeBranchSeed = worktreeBranchSeed
  }

  function applyWorktreeSeed(options: BranchSelectorOption[]) {
    if (mode !== 'create' || worktreeSourceSeed !== 'existingBranch' || !worktreeAllowed) return
    draft.useWorktree = true
    draft.worktreeSource = 'existingBranch'
    const seed = worktreeBranchSeed?.trim() ?? ''
    if (!seed) return
    draft.existingBranch = matchExistingBranchSeed(seed, options) ?? seed
  }

  $effect(() => {
    if (
      titleSeed === lastTitleSeed
      && sourceTicketUrlSeed === lastSourceTicketSeed
      && worktreeSourceSeed === lastWorktreeSourceSeed
      && worktreeBranchSeed === lastWorktreeBranchSeed
    ) return
    applySeedsToDraft()
    applyWorktreeSeed(branchList.status === 'ready' ? dedupeBranchesForSelector(branchList.branches) : [])
  })

  onMount(() => {
    void initializeDialog()
    placeCaretAfterSeededPrompt()
  })

  /**
   * The modal focuses the textarea with the caret at position 0. A seeded prompt
   * is context the user writes *after*, so move the caret to the end.
   */
  function placeCaretAfterSeededPrompt(): void {
    if (mode !== 'create' || promptSeed.length === 0) return
    queueMicrotask(() => {
      const textarea = document.querySelector<HTMLTextAreaElement>('[role="dialog"] textarea')
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(textarea.value.length, textarea.value.length)
    })
  }

  async function initializeDialog() {
    draft = createTaskDraft()
    applySeedsToDraft()
    taskDefaultsLoading = mode === 'create'
    worktreeAllowed = true
    taskDefaultsError = null
    error = null
    // Loading from the start: the repo to list is only known once the defaults
    // resolve, and until then the selector must not claim there are no branches.
    branchList = { status: 'loading' }
    branchLoadRun++

    const branchRepoPath = await loadTaskDefaults()
    if (branchRepoPath) void loadGitBranches(branchRepoPath)
    else branchList = { status: 'ready', branches: [] }
  }

  /**
   * Loads everything task creation depends on. Branch listing is deliberately
   * left out: it reaches origin, and a stalled remote would otherwise keep the
   * dialog disabled forever. Returns the repo to list branches for, if any.
   */
  async function loadTaskDefaults(): Promise<string | null> {
    try {
      if (!$activeProjectId) {
        draft.aiProvider = 'claude-code'
        return null
      }

      const defaults = await loadTaskLevelDefaults($activeProjectId)
      Object.assign(draft, {
        taskDisplayTitleUpdatesEnabled: defaults.taskDisplayTitleUpdatesEnabled,
        aiProvider: defaults.aiProvider,
        useWorktree: defaults.useWorktrees,
      })

      if (!projectPath) return null

      let hasCommits = true
      try {
        hasCommits = await repoHasCommits(projectPath)
      } catch (lookupError) {
        console.error('Failed to check whether repo has commits:', lookupError)
      }

      const availability = resolveWorktreeAvailability(hasCommits, defaults.useWorktrees)
      worktreeAllowed = availability.worktreeAllowed
      draft.useWorktree = availability.useWorktree
      applyWorktreeSeed([])

      return projectPath
    } catch (defaultsError) {
      console.error('Failed to load task defaults:', defaultsError)
      taskDefaultsError = 'Could not load task defaults. Retry before creating this task.'
      draft.aiProvider = null
      draft.existingBranch = ''
      worktreeAllowed = true
      return null
    } finally {
      taskDefaultsLoading = false
    }
  }

  async function loadGitBranches(repoPath: string) {
    const run = ++branchLoadRun
    try {
      const branches = await listGitBranches(repoPath)
      if (run !== branchLoadRun) return
      branchList = { status: 'ready', branches }
      const options = dedupeBranchesForSelector(branches)
      if (worktreeSourceSeed === 'existingBranch' && worktreeBranchSeed?.trim()) {
        applyWorktreeSeed(options)
      } else {
        const currentNames = new Set(
          branches.filter((branch) => branch.is_current).map((branch) => branch.name),
        )
        const preferred = options.find((option) => !currentNames.has(option.value)) ?? options[0]
        draft.existingBranch = preferred?.value ?? ''
      }
    } catch (branchError) {
      if (run !== branchLoadRun) return
      console.error('Failed to list git branches:', branchError)
      branchList = { status: 'error', message: String(branchError) }
      if (worktreeSourceSeed === 'existingBranch' && worktreeBranchSeed?.trim()) {
        applyWorktreeSeed([])
      } else {
        draft.existingBranch = ''
      }
    }
  }

  function handlePromptDraftChange(value: string) {
    promptDraft = value
  }

  async function handleStartTaskFromDraft() {
    await handleCreateOrUpdate(promptDraft, true)
  }

  async function handleAddToBacklogFromDraft() {
    await handleCreateOrUpdate(promptDraft)
  }

  function handleImageMarkerInsert(marker: string) {
    imageMarkerInsertRequest = {
      id: nextImageMarkerInsertRequestId,
      marker,
    }
    nextImageMarkerInsertRequestId += 1
  }

  async function handleCreateOrUpdate(prompt: string, autoStart: boolean = false) {
    if (!$activeProjectId) return
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return
    error = null
    if (mode === 'create' && taskDefaultsLoading) {
      error = 'Task defaults are still loading.'
      return
    }
    if (mode === 'create' && taskDefaultsError) {
      error = taskDefaultsError
      return
    }
    const attachmentError = promptAttachments?.getSubmissionError()
    if (attachmentError) {
      error = attachmentError
      return
    }
    if (isSaving) return
    if (mode === 'create' && draft.useWorktree && draft.worktreeSource === 'existingBranch' && draft.existingBranch.trim() === '') {
      error = branchList.status === 'loading'
        ? 'Branches are still loading. Wait for the list before starting from an existing branch.'
        : 'Select an existing branch before creating the task.'
      return
    }

    submissionIntent = mode === 'create' ? (autoStart ? 'start' : 'backlog') : null
    isSaving = true
    try {
      let savedTask: Task
      const taskPrompt = promptAttachments?.formatPrompt(normalizedPrompt) ?? normalizedPrompt

      if (mode === 'edit' && task) {
        await updateTaskInitialPrompt(task.id, taskPrompt)
        savedTask = task
        await onTaskSaved?.()
      } else {

        savedTask = await createTask(
          taskPrompt,
          'backlog',
          $activeProjectId,
          draft.permissionMode,
          {
            ...getWorktreeOptions(draft),
            title: draft.title.trim() || null,
            sourceTicketUrl: draft.sourceTicketUrl.trim() || null,
            taskDisplayTitleUpdatesEnabled: draft.taskDisplayTitleUpdatesEnabled,
            aiProvider: draft.aiProvider,
          }
        )

        if (autoStart && onRunAction) {
          // Report before navigating away: a compose request settles on this
          // callback, and onRunAction hands control to the board.
          await onTaskSaved?.(savedTask, { started: true })
          onClose?.()
          await onRunAction(savedTask.id, '')
          return
        } else {
          await onTaskSaved?.(savedTask, { started: false })
        }
      }
      onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      error = String(e)
    } finally {
      isSaving = false
      submissionIntent = null
    }
  }
</script>

<Modal
  onClose={onClose}
  maxWidth="720px"
  overflowVisible
  initialFocus="textarea"
  ariaLabel={dialogTitle}
  boxClass="rounded-xl border border-base-300"
>
  {#snippet header()}
    <div class="flex min-w-0 flex-1 items-center justify-between gap-4 pr-3">
      <h2 class="m-0 text-2xl font-semibold tracking-[-0.02em] text-base-content">{dialogTitle}</h2>
      {#if mode === 'create'}
        <div class="min-w-0 text-right">
          <span class="block max-w-56 truncate text-sm font-medium text-base-content">{projectName ?? 'Current project'}</span>
        </div>
      {/if}
    </div>
  {/snippet}

  <div class="max-h-[calc(90vh-4rem)] overflow-y-auto p-6">
    {#if taskDefaultsError}
      <div class="mb-4 flex items-center justify-between gap-3 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-sm text-error" role="alert">
        <span>{taskDefaultsError}</span>
        <button class="btn btn-sm btn-error btn-outline shrink-0" type="button" onclick={() => void initializeDialog()}>
          Retry loading defaults
        </button>
      </div>
    {:else if error}
      <div class="mb-4 rounded-lg border border-error/25 bg-error/10 px-3 py-2 text-sm text-error" role="alert">{error}</div>
    {/if}

    <InjectionPointSlot
      location={injectionLocation}
      projectId={$activeProjectId}
      taskId={mode === 'edit' && task ? task.id : null}
      onInsert={(text) => {
        injectableInsertRequest = { id: nextInjectableInsertRequestId, text }
        nextInjectableInsertRequestId += 1
      }}
    />
    <label class="mb-2 block text-sm font-semibold text-base-content" for="create-task-prompt">What should the agent do?</label>
    <div class="relative overflow-visible rounded-xl border border-base-300 bg-base-100 transition-colors focus-within:border-primary">
      <PromptInput
        bind:this={promptEditor}
        projectId={$activeProjectId || ''}
        value={initialPrompt}
        textareaId="create-task-prompt"
        ariaLabel="What should the agent do?"
        rows={8}
        textareaClass="p-4 pb-9 text-sm leading-relaxed"
        textareaStyle="height: 12rem; max-height: 12rem; overflow-y: auto; outline: none;"
        maxLength={10000}
        placeholder="Describe the outcome you want…"
        autofocus={false}
        commandTrigger={draft.aiProvider === 'codex' ? 'dollar' : 'slash'}
        onTextChange={(prompt) => promptAttachments?.syncWithPrompt(prompt)}
        onPasteImage={(blob) => promptAttachments?.attachImage(blob) ?? Promise.resolve(null)}
        onImageMarkerClick={(marker) => promptAttachments?.openPreview(marker)}
        imageMarkerInsertRequest={imageMarkerInsertRequest}
        injectableInsertRequest={injectableInsertRequest}
        onSubmit={(prompt) => mode === 'create' ? handleCreateOrUpdate(prompt, true) : handleCreateOrUpdate(prompt)}
        onValueChange={handlePromptDraftChange}
        onCancel={() => onClose?.()}
      />
      <span class="pointer-events-none absolute bottom-3 right-4 text-xs tabular-nums text-base-content/45">{promptDraft.length.toLocaleString()} / 10,000</span>
    </div>
    <p class="mt-2 text-xs text-base-content/55">Be specific about the goal, constraints, and relevant context.</p>

    <div class="flex flex-col gap-2 pb-4">
      <CreateTaskPromptAttachments
        bind:this={promptAttachments}
        {mode}
        {task}
        onMarkerInsert={handleImageMarkerInsert}
        onMarkerInsertReset={() => { imageMarkerInsertRequest = null }}
        onTranscription={(text) => promptEditor?.insertText(text)}
      />
      {#if mode === 'create'}
        <CreateTaskEnvironment
          bind:draft
          {worktreeAllowed}
          {branchList}
          {aiProviderOptions}
        />
        <CreateTaskProgressiveSettings bind:draft />
      {/if}
    </div>
  </div>

  <footer class="flex items-center justify-between gap-4 border-t border-base-300 bg-base-100 px-6 py-4">
    <div class="flex min-w-0 items-center gap-3">
      <button type="button" class="btn btn-ghost h-10 min-h-10 gap-2 px-0 hover:bg-transparent" aria-label="Close" onclick={() => onClose?.()}>
        <kbd class="kbd kbd-sm border-base-300 bg-base-100">Esc</kbd>
        Close
      </button>
      {#if mode === 'create' && taskDefaultsLoading}
        <span class="truncate text-xs text-base-content/55">Loading task defaults…</span>
      {/if}
    </div>

    <div class="flex shrink-0 items-center gap-2">
      {#if mode === 'create'}
        <button
          class="btn btn-outline h-10 min-h-10 px-4"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={handleAddToBacklogFromDraft}
        >{submissionIntent === 'backlog' ? 'Adding…' : 'Add to backlog'}</button>
        <button
          class="btn btn-primary h-10 min-h-10 min-w-36 px-5"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={handleStartTaskFromDraft}
          title="Command+Enter"
        >
          {submissionIntent === 'start' ? 'Starting…' : 'Start Task'}
          {#if submissionIntent !== 'start'}
            <kbd class="kbd kbd-xs ml-1 border-primary-content/30 bg-primary-content text-primary">⌘↵</kbd>
          {/if}
        </button>
      {:else}
        <span class="text-xs text-base-content opacity-70">⌘Enter to submit</span>
        <button
          class="btn btn-primary btn-sm"
          type="button"
          disabled={!promptReady || !createReady}
          onclick={() => handleCreateOrUpdate(promptDraft)}
        >{isSaving ? 'Saving…' : 'Submit'}</button>
      {/if}
    </div>
  </footer>
</Modal>
