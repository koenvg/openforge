import { createTask as createFixtureTask } from '../../storybook/shared/fixtures/appFixtures'
import type { TaskDetail } from '../lib/types'

export function createTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return createFixtureTask({
    id: 'task-1',
    prompt: 'Test task',
    promptPreview: 'Test task',
    title: 'Test task',
    projectId: 'proj-1',
    createdAt: 1000,
    updatedAt: 1000,
    ...overrides,
  })
}
