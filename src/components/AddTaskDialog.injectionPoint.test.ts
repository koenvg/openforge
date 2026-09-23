import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { TaskDetail } from '../lib/types'
import { chooseSelectOption } from '../test-utils/select'

// Keep the live props object. Svelte 5 updates the same record rather than remounting.
const { injectionSlotProps } = vi.hoisted(() => ({
  injectionSlotProps: [] as Array<Record<string, unknown>>,
}))

vi.mock('./plugin/InjectionPointSlot.svelte', () => ({
  default: vi.fn((_node: Element, props: Record<string, unknown>) => {
    injectionSlotProps.push(props)
    return {
      update(nextProps: Record<string, unknown>) {
        Object.assign(props, nextProps)
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
  completedAt: null,
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

  it('updates the create-task provider on the injection slot without reopening the dialog', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const slot = () => injectionSlotProps.find((props) => props.location === 'createTaskPrompt')

    await waitFor(() => {
      expect(slot()?.provider).toBe('claude-code')
    })

    await chooseSelectOption(screen.getByRole('button', { name: 'Provider' }), 'Grok')

    await waitFor(() => {
      expect(slot()?.provider).toBe('grok')
    })
    expect(slot()?.location).toBe('createTaskPrompt')
    expect(screen.getByRole('dialog', { name: 'Create task' })).toBeTruthy()
  })

  it('exposes create-task prompt text and removes named tokens without scraping the rest', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    const textarea = await screen.findByRole('textbox', { name: 'What should the agent do?' }) as HTMLTextAreaElement
    await fireEvent.input(textarea, { target: { value: 'Please /refactor the API and keep this' } })
    const slot = () => injectionSlotProps.find((props) => props.location === 'createTaskPrompt')

    await waitFor(() => {
      expect(slot()?.promptText).toBe('Please /refactor the API and keep this')
    })

    const onRemoveNamedTokens = slot()?.onRemoveNamedTokens as (names: readonly string[]) => void
    onRemoveNamedTokens(['refactor'])

    await waitFor(() => {
      expect(textarea.value).not.toMatch(/(^|\s)\/refactor(\s|$)/)
    })
    expect(textarea.value).toContain('the API and keep this')
  })
})
