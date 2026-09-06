import type { createTask, listGitBranches, repoHasCommits, updateTaskInitialPrompt } from '../../lib/ipc'
import type { loadTaskLevelDefaults } from '../../lib/taskDefaults'

/** I/O used by the workflow. Pure draft and prompt rules stay inside it. */
export interface TaskCreationAdapter {
  createTask: typeof createTask
  updateTaskInitialPrompt: typeof updateTaskInitialPrompt
  listGitBranches: typeof listGitBranches
  repoHasCommits: typeof repoHasCommits
  loadTaskLevelDefaults: typeof loadTaskLevelDefaults
  readImage(blob: Blob): Promise<string>
  readClipboardImage(): Promise<Blob | null>
}

export class ClipboardUnavailableError extends Error {}
