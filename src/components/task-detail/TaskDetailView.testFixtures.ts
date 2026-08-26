import { vi } from 'vitest'
import type { Task, TaskWorkspaceInfo } from '../../lib/types'

const baseTask: Task = {
  id: 'T-42',
  initial_prompt: 'Implement auth middleware',
  status: 'backlog',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
}

const secondaryTask: Task = {
  ...baseTask,
  id: 'T-99',
  initial_prompt: 'Implement audit logging',
}

const mockOnRunAction = vi.fn()

function createTaskWorkspaceInfo(overrides: Partial<TaskWorkspaceInfo> = {}): TaskWorkspaceInfo {
  return {
    id: 1,
    task_id: 'T-42',
    project_id: 'project-1',
    repo_path: '/repo',
    workspace_path: '/path/to/worktree',
    kind: 'worktree',
    branch_name: 'branch',
    provider_name: 'opencode',
    status: 'ready',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  }
}

export { baseTask, createTaskWorkspaceInfo, mockOnRunAction, secondaryTask }
export type { Task }
