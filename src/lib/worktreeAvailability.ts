export interface WorktreeAvailability {
  worktreeAllowed: boolean;
  useWorktree: boolean;
}

/**
 * Decide whether the Add Task dialog may offer a git worktree and whether the
 * toggle should start on.
 *
 * A repository with no commits (unborn HEAD) cannot back a worktree — `git
 * worktree add` needs a base commit to branch from — so the toggle is
 * force-disabled and off, and the task runs in the project directory instead.
 * When commits exist, the project's configured default is honored.
 */
export function resolveWorktreeAvailability(
  hasCommits: boolean,
  projectDefaultUseWorktree: boolean,
): WorktreeAvailability {
  if (!hasCommits) {
    return { worktreeAllowed: false, useWorktree: false };
  }
  return { worktreeAllowed: true, useWorktree: projectDefaultUseWorktree };
}
