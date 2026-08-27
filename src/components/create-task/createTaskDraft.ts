import type { PermissionMode, WorktreeSource } from '../../lib/types'

export interface CreateTaskDraft {
  permissionMode: PermissionMode
  worktreeSource: WorktreeSource
  existingBranch: string
  useWorktree: boolean
  aiProvider: string | null
  title: string
  sourceTicketUrl: string
  taskDisplayTitleUpdatesEnabled: boolean
}

export interface WorktreeOptions {
  worktreeSource: WorktreeSource
  worktreeBranch: string | null
}

export function createTaskDraft(): CreateTaskDraft {
  return {
    permissionMode: 'default',
    worktreeSource: 'newBranchFromMain',
    existingBranch: '',
    useWorktree: true,
    aiProvider: null,
    title: '',
    sourceTicketUrl: '',
    taskDisplayTitleUpdatesEnabled: false,
  }
}

export function getPermissionModeSummary(mode: PermissionMode): string {
  switch (mode) {
    case 'auto': return 'autorun'
    case 'acceptEdits': return 'accept edits'
    case 'plan': return 'plan only'
    case 'bypassPermissions': return 'bypass permissions'
    case 'dontAsk': return "don't ask"
    default: return 'default permissions'
  }
}

export function getWorktreeOptions(draft: CreateTaskDraft): WorktreeOptions {
  if (!draft.useWorktree) {
    return { worktreeSource: 'disabled', worktreeBranch: null }
  }

  if (draft.worktreeSource === 'existingBranch') {
    return { worktreeSource: 'existingBranch', worktreeBranch: draft.existingBranch.trim() }
  }

  return { worktreeSource: 'newBranchFromMain', worktreeBranch: null }
}

export function getEnvironmentSummaryLabel(draft: CreateTaskDraft): string {
  const workspace = draft.useWorktree ? 'Worktree' : 'Project directory'
  const base = draft.useWorktree && draft.worktreeSource === 'existingBranch'
    ? draft.existingBranch || 'Choose branch'
    : 'latest main'
  return `Environment summary: ${workspace}, ${base}, ${getPermissionModeSummary(draft.permissionMode)}`
}
