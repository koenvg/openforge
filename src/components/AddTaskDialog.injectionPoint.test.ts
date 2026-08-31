import { render } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { TaskDetail } from '../lib/types'

// Capture the props passed to InjectionPointSlot by the dialog.
const { injectionSlotProps } = vi.hoisted(() => ({
  injectionSlotProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn((_node: Element, props: Record<string, unknown>) => {
    injectionSlotProps.push({ ...props })
    return {
      update(nextProps: Record<string, unknown>) {
        injectionSlotProps.push({ ...nextProps })
      },
      destroy() {},
    }
  }),
}))

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    projectId: 'test-project-id',
    status: 'backlog',
    title: 'New Task',
    prompt: 'New Task',
    promptPreview: 'New Task',
    titleSource: null,
    titleGeneratedAt: null,
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    dependsOn: [],
    labels: [],
    createdAt: 1000,
    updatedAt: 1000,
  }),
  updateTaskInitialPrompt: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return {
    activeProjectId: writable('test-project-id'),
  }
})

const mockTask: TaskDetail = {
  id: 'T-42',
  projectId: 'test-project-id',
  status: 'doing',
  title: 'Existing Task',
  prompt: 'Existing Task',
  promptPreview: 'Existing Task',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  labels: [],
  createdAt: 1000,
  updatedAt: 2000,
}

describe('AddTaskDialog injection point', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    injectionSlotProps.length = 0
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('mounts an injection slot with location createTaskPrompt in create mode', () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    // The slot is mounted during render; find the first captured props entry.
    const captured = injectionSlotProps.find((p) => p.location !== undefined)
    expect(captured?.location).toBe('createTaskPrompt')
  })

  it('mounts an injection slot with location backlogPrompt in edit mode', () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    const captured = injectionSlotProps.find((p) => p.location !== undefined)
    expect(captured?.location).toBe('backlogPrompt')
  })
})
