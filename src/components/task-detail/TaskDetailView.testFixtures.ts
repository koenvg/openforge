import { vi } from 'vitest'
import {
  createTask,
  createTaskWorkspaceInfo as createFixtureTaskWorkspaceInfo,
} from '../../../storybook/shared/fixtures/appFixtures'
import type { TaskDetail, TaskWorkspaceInfo } from '../../lib/types'

const baseTask: TaskDetail = createTask({
  status: 'backlog',
  title: 'Implement auth middleware',
  prompt: 'Implement auth middleware',
  promptPreview: 'Implement auth middleware',
  createdAt: 1000,
  updatedAt: 2000,
})

const secondaryTask: TaskDetail = {
  ...baseTask,
  id: 'T-99',
  title: 'Implement audit logging',
  prompt: 'Implement audit logging',
  promptPreview: 'Implement audit logging',
}

const mockOnRunAction = vi.fn()

function createTaskWorkspaceInfo(overrides: Partial<TaskWorkspaceInfo> = {}): TaskWorkspaceInfo {
  return createFixtureTaskWorkspaceInfo({
    repo_path: '/repo',
    workspace_path: '/path/to/worktree',
    branch_name: 'branch',
    provider_name: 'opencode',
    created_at: 1000,
    updated_at: 2000,
    ...overrides,
  })
}

export { baseTask, createTaskWorkspaceInfo, mockOnRunAction, secondaryTask }
export type { TaskDetail as Task }
