import type { TaskDetail, WorktreeSource } from '../../lib/types'
import { dedupeBranchesForSelector, matchExistingBranchSeed, type BranchListState, type BranchSelectorOption } from '../../lib/branchSelector'
import { resolveWorktreeAvailability } from '../../lib/worktreeAvailability'
import { getTaskPromptText } from '../../lib/taskPrompt'
import { createTaskDraft, getWorktreeOptions } from './createTaskDraft'
import { createTaskCreationAttachments } from './taskCreationAttachments.svelte'
import type { TaskCreationAdapter } from './taskCreationAdapter'

export interface TaskCreationContext {
  projectId: string | null
  mode?: 'create' | 'edit'
  task?: TaskDetail | null
  projectPath?: string | null
  promptSeed?: string
  sourceTicketUrlSeed?: string | null
  titleSeed?: string | null
  worktreeSourceSeed?: WorktreeSource | null
  worktreeBranchSeed?: string | null
  onClose?: () => void
  onTaskSaved?: (task?: TaskDetail, options?: { started: boolean }) => void | Promise<void>
  onRunAction?: (taskId: string, actionPrompt: string) => Promise<void>
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
  let lastSourceTicketSeed: string | null | undefined = null
  let lastWorktreeSourceSeed: WorktreeSource | null | undefined = null
  let lastWorktreeBranchSeed: string | null | undefined = null
  let branchLoadRun = 0
  let initializationRun = 0

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
    if (context.titleSeed === lastTitleSeed && context.sourceTicketUrlSeed === lastSourceTicketSeed
      && context.worktreeSourceSeed === lastWorktreeSourceSeed && context.worktreeBranchSeed === lastWorktreeBranchSeed) return
    applySeedsToDraft()
    applyWorktreeSeed(state.branchList.status === 'ready' ? dedupeBranchesForSelector(state.branchList.branches) : [])
  }

  function applySeedsToDraft() {
    state.draft.title = context.titleSeed ?? ''
    state.draft.sourceTicketUrl = context.sourceTicketUrlSeed ?? ''
    lastTitleSeed = context.titleSeed
    lastSourceTicketSeed = context.sourceTicketUrlSeed
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
    if (state.isSaving) return
    if (context.mode === 'create' && state.draft.useWorktree && state.draft.worktreeSource === 'existingBranch' && state.draft.existingBranch.trim() === '') {
      state.error = state.branchList.status === 'loading'
        ? 'Branches are still loading. Wait for the list before starting from an existing branch.'
        : 'Select an existing branch before creating the task.'
      return
    }

    state.submissionIntent = context.mode === 'create' ? intent : null
    state.isSaving = true
    try {
      let savedTask: TaskDetail
      const taskPrompt = attachments.formatPrompt(normalizedPrompt)

      if (context.mode === 'edit' && context.task) {
        await adapter.updateTaskInitialPrompt(context.task.id, taskPrompt)
        savedTask = context.task
        await context.onTaskSaved?.()
      } else {

        savedTask = await adapter.createTask(
          taskPrompt,
          'backlog',
          context.projectId,
          state.draft.permissionMode,
          {
            ...getWorktreeOptions(state.draft),
            title: state.draft.title.trim() || null,
            sourceTicketUrl: state.draft.sourceTicketUrl.trim() || null,
            taskDisplayTitleUpdatesEnabled: state.draft.taskDisplayTitleUpdatesEnabled,
            aiProvider: state.draft.aiProvider,
          }
        )

        if (intent === 'start' && context.onRunAction) {
          // Report before navigating away: a compose request settles on this
          // callback, and onRunAction hands control to the board.
          await context.onTaskSaved?.(savedTask, { started: true })
          context.onClose?.()
          await context.onRunAction(savedTask.id, '')
          return
        } else {
          await context.onTaskSaved?.(savedTask, { started: false })
        }
      }
      context.onClose?.()
    } catch (e) {
      console.error('Failed to save task:', e)
      state.error = String(e)
    } finally {
      state.isSaving = false
      state.submissionIntent = null
    }
  }

  return {
    state, attachments: attachments.controls, configure, initialize: initializeDialog, submit,
    dispose() { initializationRun++; branchLoadRun++; attachments.dispose() },
  }
}

export type TaskCreationWorkflow = ReturnType<typeof createTaskCreationWorkflow>
