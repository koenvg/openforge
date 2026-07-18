export * from '@openforge-app/plugin-sdk/domain'

import type { AppView, ReviewPullRequest } from '@openforge-app/plugin-sdk/domain'

/**
 * A project's last-viewed in-project location: the active tab plus whichever task
 * or PR was open within it. Kept per-project (in memory) so switching away and
 * returning lands the user back where they were instead of on the board.
 */
export interface ProjectViewSnapshot {
  currentView: AppView
  selectedTaskId: string | null
  selectedReviewPr: ReviewPullRequest | null
}

export type DeveloperLogLevel = 'info' | 'warn' | 'error'

export interface DeveloperLogEntry {
  id: number
  timestamp: string
  level: DeveloperLogLevel
  message: string
}

export interface DeveloperLogSnapshot {
  entries: DeveloperLogEntry[]
  logFilePath: string
  totalEntries: number
}

export interface TaskLabel {
  id: number
  project_id: string
  name: string
}

export interface GitStatusSummary {
  has_remote: boolean
  remote_ahead: number
  remote_behind: number
  local_commits: number
  uncommitted_files: number
  insertions: number
  deletions: number
}
