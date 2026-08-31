import type { TaskDetail } from '../lib/types'

const defaultTask: TaskDetail = {
  id: 'task-1',
  prompt: 'Test task',
  promptPreview: 'Test task',
  title: 'Test task',
  status: 'doing',
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  projectId: 'proj-1',
  createdAt: 1000,
  updatedAt: 1000,
  titleSource: null,
  titleGeneratedAt: null,
  labels: [],
}

export function createTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    ...defaultTask,
    dependsOn: [],
    labels: [],
    ...overrides,
  }
}
