import type { Task } from '../lib/types'

const defaultTask: Task = {
  id: 'task-1',
  initial_prompt: 'Test task',
  prompt: null,
  title: null,
  title_source: null,
  title_generated_at: null,
  status: 'doing',
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  source_ticket_url: null,
  depends_on: [],
  project_id: 'proj-1',
  created_at: 1000,
  updated_at: 1000,
}

export function createTask(overrides: Partial<Task> = {}): Task {
  return {
    ...defaultTask,
    depends_on: [],
    ...overrides,
  }
}
