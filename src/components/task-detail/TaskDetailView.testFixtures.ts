import { vi } from 'vitest'
import type { TaskDetail, TaskWorkspaceInfo } from '../../lib/types'

const baseTask: TaskDetail = {
  id: 'T-42',
  projectId: 'project-1',
  status: 'backlog',
  title: 'Implement auth middleware',
  prompt: 'Implement auth middleware',
  promptPreview: 'Implement auth middleware',
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
  titleSource: null,
  titleGeneratedAt: null,
  createdAt: 1000,
  updatedAt: 2000,
}

const secondaryTask: TaskDetail = {
  ...baseTask,
  id: 'T-99',
  title: 'Implement audit logging',
  prompt: 'Implement audit logging',
  promptPreview: 'Implement audit logging',
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
export type { TaskDetail as Task }
