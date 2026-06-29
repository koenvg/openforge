export * from '@openforge/plugin-sdk/domain'

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
