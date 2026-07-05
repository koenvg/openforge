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

export interface TaskLabel {
  id: number
  project_id: string
  name: string
  color: 'primary' | 'secondary' | 'accent' | 'info' | 'success' | 'warning' | 'error'
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
