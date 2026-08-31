import { writable } from 'svelte/store'
import { vi } from 'vitest'

vi.mock('../../lib/stores', () => ({
  activeProjectId: writable(null),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  projects: writable([]),
  tasks: writable([]),
  taskDetailsById: writable(new Map()),
  dependencyReferenceTasks: writable([]),
  activeSessions: writable(new Map()),
  setTaskMerging: vi.fn(),
}))

vi.mock('../../lib/tasksState', () => ({
  updateTaskDetail: vi.fn(),
}))
