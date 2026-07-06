export * from '@openforge-app/plugin-sdk/domain'

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

/** A local Claude session transcript surfaced for the "continue a session" picker. */
export interface ClaudeSessionSummary {
  sessionId: string
  /** Claude's generated title, falling back to the first user prompt. */
  title: string | null
  /** The most recent prompt in the session. */
  lastPrompt: string | null
  /** The working directory the session was recorded in. */
  cwd: string | null
  gitBranch: string | null
  /** Latest ISO-8601 timestamp seen in the transcript. */
  updatedAt: string | null
  messageCount: number
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
