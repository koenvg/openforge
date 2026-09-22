import type { TaskDetail, WorktreeSource } from '../../lib/types'
import { dedupeBranchesForSelector, matchExistingBranchSeed, type BranchListState, type BranchSelectorOption } from '../../lib/branchSelector'
import { resolveWorktreeAvailability } from '../../lib/worktreeAvailability'
import { getTaskPromptText } from '../../lib/taskPrompt'
import { clearCreateTaskDraft, readCreateTaskDraft, writeCreateTaskDraft, type RetainedCreateTaskDraft } from '../../lib/createTaskDraftStore'
import { createTaskDraft, getWorktreeOptions } from './createTaskDraft'
import { createTaskCreationAttachments } from './taskCreationAttachments.svelte'
import type { TaskCreationAdapter } from './taskCreationAdapter'

export interface TaskCreationContext {
  projectId: string | null
  mode?: 'create' | 'edit'
  task?: TaskDetail | null
  projectPath?: string | null
  promptSeed?: string
  titleSeed?: string | null
  worktreeSourceSeed?: WorktreeSource | null
  worktreeBranchSeed?: string | null
  onClose?: () => void
  onTaskSaved?: () => void | Promise<void>
  /** Synchronous ownership transfer. The app owns startup and refresh after this returns. */
  onTaskCreated?: (task: TaskDetail, intent: 'backlog' | 'start') => void
}

/** One dialog session. Configure changed inputs, initialize on mount, dispose on destroy.
 * Draft fields are bindable; submission and asynchronous state belong to this module.
 */
export function createTaskCreationWorkflow(adapter: TaskCreationAdapter) {
  let context = $state<TaskCreationContext>({ projectId: null, mode: 'create' })
  const attachments = createTaskCreationAttachments(adapter)
  const state = $state({
    draft: createTaskDraft(),
    worktreeAllowed: true,
    error: null as string | null,
    taskDefaultsError: null as string | null,
    promptDraft: '',
    initialPrompt: '',
    // Key the uncontrolled prompt editor by this revision, never by the live draft.
    promptRevision: 0,
    isSaving: false,
    submissionIntent: null as 'backlog' | 'start' | null,
    taskDefaultsLoading: true,
    branchList: { status: 'loading' } as BranchListState,
    get promptReady() { return this.promptDraft.trim().length > 0 },
    get createReady() { return (context.mode !== 'create' || (!this.taskDefaultsLoading && !this.taskDefaultsError)) && !this.isSaving },
  })
  let lastPromptSource: string | null = null
  let lastTitleSeed: string | null | undefined = null
  let lastWorktreeSourceSeed: WorktreeSource | null | undefined = null
  let lastWorktreeBranchSeed: string | null | undefined = null
  let branchLoadRun = 0
  let initializationRun = 0
  let savedCreation: TaskDetail | null = null
  let retentionProjectId: string | null = null

  function configure(input: TaskCreationContext) {
    context = { ...input, mode: input.mode ?? 'create' }
    const editTask = context.mode === 'edit' ? context.task : null
    // Raw task prompts include image definitions: replacing only an image is a reseed too.
    // Equivalent inputs preserve user edits, even when the caller supplies a new task object.
    const promptSource = JSON.stringify([context.mode, editTask?.id ?? null, editTask?.prompt ?? context.promptSeed ?? ''])
    if (promptSource !== lastPromptSource) {
      state.initialPrompt = editTask ? getTaskPromptText(editTask) : context.promptSeed ?? ''
      state.promptDraft = state.initialPrompt
      attachments.reset(context.mode ?? 'create', editTask ?? null)
      lastPromptSource = promptSource
      state.promptRevision++
    }
    syncRetentionTarget()
    if (context.titleSeed === lastTitleSeed
      && context.worktreeSourceSeed === lastWorktreeSourceSeed && context.worktreeBranchSeed === lastWorktreeBranchSeed) return
    applySeedsToDraft()
    applyWorktreeSeed(state.branchList.status === 'ready' ? dedupeBranchesForSelector(state.branchList.branches) : [])
  }

  /** Only unseeded creation is draft-backed, so a supplied seed always wins. */
  function retentionTarget(): string | null {
    if (context.mode !== 'create' || (context.promptSeed ?? '').length > 0 || !context.projectId) return null
    return context.projectId
  }

  function syncRetentionTarget() {
    const target = retentionTarget()
    if (target === retentionProjectId) return
    retentionProjectId = target
    // A null target means the reseed branch above already owns the prompt.
    if (target !== null) applyPrompt(readCreateTaskDraft(target))
  }

  function applyPrompt(retained: RetainedCreateTaskDraft | null) {
    state.initialPrompt = retained?.prompt ?? ''
    state.promptDraft = state.initialPrompt
    attachments.restore(retained?.images ?? [])
    state.promptRevision++
  }

  function setPrompt(prompt: string) {
    state.promptDraft = prompt
    attachments.controls.syncWithPrompt(prompt)
    if (!retentionProjectId) return
    if (prompt.trim().length === 0) clearCreateTaskDraft(retentionProjectId)
    else writeCreateTaskDraft(retentionProjectId, { prompt, images: attachments.getImages() })
  }

  function discardDraft() {
    if (retentionProjectId) clearCreateTaskDraft(retentionProjectId)
    applyPrompt(null)
  }

  function applySeedsToDraft() {
    state.draft.title = context.titleSeed ?? ''
    lastTitleSeed = context.titleSeed
    lastWorktreeSourceSeed = context.worktreeSourceSeed
    lastWorktreeBranchSeed = context.worktreeBranchSeed
  }

  function applyWorktreeSeed(options: BranchSelectorOption[]) {
    if (context.mode !== 'create' || context.worktreeSourceSeed !== 'existingBranch' || !state.worktreeAllowed) return
    state.draft.useWorktree = true
    state.draft.worktreeSource = 'existingBranch'
    const seed = context.worktreeBranchSeed?.trim() ?? ''
    if (!seed) return
    state.draft.existingBranch = matchExistingBranchSeed(seed, options) ?? seed
  }

  async function initializeDialog() {
    const run = ++initializationRun
    const { projectId, projectPath } = context
    state.draft = createTaskDraft()
    applySeedsToDraft()
    state.taskDefaultsLoading = context.mode === 'create'
    state.worktreeAllowed = true
    state.taskDefaultsError = null
    state.error = null
    state.branchList = { status: 'loading' }
    branchLoadRun++

    // Defaults gate creation; origin lookup never does.
    try {
      if (!projectId) {
        state.draft.aiProvider = 'claude-code'
        state.branchList = { status: 'ready', branches: [] }
        return
      }
      const defaults = await adapter.loadTaskLevelDefaults(projectId)
      if (run !== initializationRun) return
      Object.assign(state.draft, {
        taskDisplayTitleUpdatesEnabled: defaults.taskDisplayTitleUpdatesEnabled,
        aiProvider: defaults.aiProvider,
        useWorktree: defaults.useWorktrees,
      })
      if (!projectPath) {
        state.branchList = { status: 'ready', branches: [] }
        return
      }

      let hasCommits = true
      try {
        hasCommits = await adapter.repoHasCommits(projectPath)
      } catch (lookupError) {
        console.error('Failed to check whether repo has commits:', lookupError)
      }
      if (run !== initializationRun) return
      const availability = resolveWorktreeAvailability(hasCommits, defaults.useWorktrees)
      state.worktreeAllowed = availability.worktreeAllowed
      state.draft.useWorktree = availability.useWorktree
      applyWorktreeSeed([])
      void loadGitBranches(projectPath)
    } catch (defaultsError) {
      if (run !== initializationRun) return
      console.error('Failed to load task defaults:', defaultsError)
      state.taskDefaultsError = 'Could not load task defaults. Retry before creating this task.'
      state.draft.aiProvider = null
      state.draft.existingBranch = ''
      state.worktreeAllowed = true
      state.branchList = { status: 'ready', branches: [] }
    } finally {
      if (run === initializationRun) state.taskDefaultsLoading = false
    }
  }

  async function loadGitBranches(repoPath: string) {
    const run = ++branchLoadRun
    try {
      const branches = await adapter.listGitBranches(repoPath)
      if (run !== branchLoadRun) return
      state.branchList = { status: 'ready', branches }
      const options = dedupeBranchesForSelector(branches)
      if (context.worktreeSourceSeed === 'existingBranch' && context.worktreeBranchSeed?.trim()) {
        applyWorktreeSeed(options)
      } else {
        const currentNames = new Set(
          branches.filter((branch) => branch.is_current).map((branch) => branch.name),
        )
        const preferred = options.find((option) => !currentNames.has(option.value)) ?? options[0]
        state.draft.existingBranch = preferred?.value ?? ''
      }
    } catch (branchError) {
      if (run !== branchLoadRun) return
      console.error('Failed to list git branches:', branchError)
      state.branchList = { status: 'error', message: String(branchError) }
      if (context.worktreeSourceSeed === 'existingBranch' && context.worktreeBranchSeed?.trim()) {
        applyWorktreeSeed([])
      } else {
        state.draft.existingBranch = ''
      }
    }
  }

  async function submit(intent: 'backlog' | 'start' = 'backlog', prompt = state.promptDraft) {
    if (state.isSaving) return
    if (context.mode === 'create' && savedCreation) return
    if (!context.projectId) return
    const normalizedPrompt = prompt.trim()
    if (!normalizedPrompt) return
    state.error = null
    if (context.mode === 'create' && state.taskDefaultsLoading) {
      state.error = 'Task defaults are still loading.'
      return
    }
    if (context.mode === 'create' && state.taskDefaultsError) {
      state.error = state.taskDefaultsError
      return
    }
    const attachmentError = attachments.getSubmissionError()
    if (attachmentError) {
      state.error = attachmentError
      return
    }
    if (context.mode === 'create' && state.draft.useWorktree && state.draft.worktreeSource === 'existingBranch' && state.draft.existingBranch.trim() === '') {
      state.error = state.branchList.status === 'loading'
        ? 'Branches are still loading. Wait for the list before starting from an existing branch.'
        : 'Select an existing branch before creating the task.'
      return
    }

    state.submissionIntent = context.mode === 'create' ? intent : null
    state.isSaving = true
    try {
      const taskPrompt = attachments.formatPrompt(normalizedPrompt)
      const callbacks = { onTaskSaved: context.onTaskSaved, onTaskCreated: context.onTaskCreated, onClose: context.onClose }
      if (context.mode === 'edit' && context.task) {
        await adapter.updateTaskInitialPrompt(context.task.id, taskPrompt)
        await callbacks.onTaskSaved?.()
        callbacks.onClose?.()
      } else {
        const task = await adapter.createTask(
          taskPrompt,
          'backlog',
          context.projectId,
          state.draft.permissionMode,
          {
            ...getWorktreeOptions(state.draft),
            title: state.draft.title.trim() || null,
            taskDisplayTitleUpdatesEnabled: state.draft.taskDisplayTitleUpdatesEnabled,
            aiProvider: state.draft.aiProvider,
          }
        )
        savedCreation = task
        if (retentionProjectId) {
          clearCreateTaskDraft(retentionProjectId)
          retentionProjectId = null
        }
        callbacks.onTaskCreated?.(task, intent)
        callbacks.onClose?.()
      }
    } catch (e) {
      console.error('Failed to save task:', e)
      state.error = String(e)
    } finally {
      state.isSaving = false
      state.submissionIntent = null
    }
  }

  return {
    state, attachments: attachments.controls, configure, initialize: initializeDialog, submit, setPrompt, discardDraft,
    dispose() { initializationRun++; branchLoadRun++; attachments.dispose() },
  }
}

export type TaskCreationWorkflow = ReturnType<typeof createTaskCreationWorkflow>
