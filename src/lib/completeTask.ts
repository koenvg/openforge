// "Complete" is the single terminal action for a task: it permanently deletes
// the task along with its worktree and branch (there is no Done/reopen flow).
// Because the label reads as a benign "finish", every Complete affordance must
// confirm first. Centralised here so the wording stays identical everywhere.
export const COMPLETE_TASK_CONFIRM_MESSAGE =
  'Complete this task? Its worktree and branch will be deleted — this cannot be undone.'

/** Prompt the user to confirm the destructive Complete (delete) action. */
export function confirmCompleteTask(): boolean {
  return window.confirm(COMPLETE_TASK_CONFIRM_MESSAGE)
}
