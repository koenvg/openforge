import { writable } from 'svelte/store'
import { vi } from 'vitest'

vi.mock('../../lib/stores', () => ({
  selectedTaskId: writable(null),
  activeSessions: writable(new Map()),
  ticketPrs: writable(new Map()),
  mergingTaskIds: writable(new Set()),
  projects: writable([]),
  setTaskMerging: vi.fn(),
  tasks: writable([]),
  dependencyReferenceTasks: writable([]),
  activeProjectId: writable('project-1'),
  startingTasks: writable(new Set()),
  completingTasks: writable(new Set()),
  outOfFocusTaskIdsByProject: writable(new Map()),
  error: writable(null),
  taskRuntimeInfo: writable(new Map()),
  pendingManualComments: writable([]),
  taskActiveView: writable(new Map()),
  taskDraftNotes: writable(new Map()),
  commandHeld: writable(false),
}))
