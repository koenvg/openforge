import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { Action, Task } from '../lib/types'
import { createTask, updateTask, getResolvedAiProvider, listGitBranches, listOpenCodeCommands } from '../lib/ipc'
import { loadActions } from '../lib/actions'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    initial_prompt: 'New Task',
    status: 'backlog',
    prompt: null,
    summary: null,
    agent: null,
    permission_mode: null,
    worktree_source: null,
    worktree_branch: null,
    depends_on: [],
    project_id: null,
    created_at: 1000,
    updated_at: 1000,
  }),
  updateTask: vi.fn().mockResolvedValue(undefined),
  getProjectConfig: vi.fn().mockResolvedValue('claude-code'),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ]),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

const DEFAULT_WORKTREE_OPTIONS = {
  worktreeSource: 'newBranchFromMain',
  worktreeBranch: null,
}

vi.mock('../lib/actions', () => ({
  loadActions: vi.fn().mockResolvedValue([
    { id: 'act-1', name: 'Test Action', prompt: 'Do test', builtin: false, enabled: true },
  ]),
  getEnabledActions: vi.fn((actions: Action[]) => actions.filter((action: Action) => action.enabled)),
}))

vi.mock('../lib/stores', () => {
  const { writable } = require('svelte/store')
  return {
    activeProjectId: writable('test-project-id'),
  }
})

async function findPromptTextbox(): Promise<HTMLTextAreaElement> {
  await waitFor(() => {
    expect(screen.getAllByRole('textbox').length).toBeGreaterThan(0)
  })
  return screen.getAllByRole('textbox')[0] as HTMLTextAreaElement
}

async function clickAddToBacklogFromMore() {
  await fireEvent.click(await screen.findByRole('button', { name: 'More' }))
  await fireEvent.click(await screen.findByRole('menuitem', { name: 'Add to Backlog' }))
}

async function expandEnvironment() {
  await fireEvent.click(await screen.findByRole('button', { name: /Environment:/ }))
}

const mockTask = {
  id: 'T-42',
  initial_prompt: 'Existing Task',
  status: 'doing',
  prompt: null,
  title: null,
  summary: null,
  agent: null,
  permission_mode: null,
  worktree_source: null,
  worktree_branch: null,
  depends_on: [],
  project_id: null,
  created_at: 1000,
  updated_at: 2000,
} as Task

describe('AddTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(getResolvedAiProvider).mockResolvedValue('claude-code')
    vi.mocked(listGitBranches).mockResolvedValue([
      { name: 'main', is_current: true, is_remote: false },
      { name: 'feature/open-pr', is_current: false, is_remote: false },
    ])
    vi.mocked(listOpenCodeCommands).mockResolvedValue([])
    vi.mocked(loadActions).mockResolvedValue([
      { id: 'act-1', name: 'Test Action', prompt: 'Do test', builtin: false, enabled: true },
    ])
  })

  it('renders in create mode with empty fields via PromptInput', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })
    expect(screen.getByRole('heading', { name: 'Create Task' })).toBeTruthy()
    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('')
  })

  it('closes before awaiting the async start flow', async () => {
    let resolveRunAction = () => {}
    const onClose = vi.fn()
    const onRunAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRunAction = resolve
    }))

    render(AddTaskDialog, { props: { mode: 'create', onClose, onRunAction } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Start me' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Start me', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onClose).toHaveBeenCalledTimes(1)
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', null)
    })

    resolveRunAction()
  })

  it('calls createTask with correct arguments on submit via PromptInput', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onTaskSaved } })
    
    const textbox = await findPromptTextbox()
    // Svelte bind:value needs the value to be updated, or we fire `input` event
    await fireEvent.input(textbox, { target: { value: 'My new task' } })
    
    // The "Add to Backlog" button calls onSubmit
    await clickAddToBacklogFromMore()
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('My new task', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('collapses environment controls behind a summary by default', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await findPromptTextbox()

    expect(screen.getByRole('button', { name: /Environment: Worktree · latest main · default permissions/ })).toBeTruthy()
    expect(screen.queryByLabelText('Worktree')).toBeNull()
    expect(screen.queryByLabelText('New branch from latest main')).toBeNull()
    expect(screen.queryByRole('combobox')).toBeNull()
  })

  it('uses new branch from latest main as the default worktree task source', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await expandEnvironment()
    const worktreeToggle = await screen.findByLabelText('Worktree') as HTMLInputElement
    expect(worktreeToggle.checked).toBe(true)
    expect((screen.getByLabelText('New branch from latest main') as HTMLInputElement).checked).toBe(true)

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Default worktree task' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Default worktree task', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
    })
  })

  it('passes the selected existing branch when creating a worktree-backed task', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        onTaskSaved,
      },
    })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))
    await fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'feature/open-pr' } })
    expect(screen.getByRole('button', { name: /Environment: Worktree · feature\/open-pr · default permissions/ })).toBeTruthy()

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Continue PR work' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Continue PR work',
        'backlog',
        'test-project-id',
        'default',
        {
          worktreeSource: 'existingBranch',
          worktreeBranch: 'feature/open-pr',
        },
      )
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('creates a project-directory task when the worktree toggle is off', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskSaved } })

    await expandEnvironment()
    await fireEvent.click(await screen.findByLabelText('Worktree'))
    expect(screen.getByRole('button', { name: /Environment: Project directory · default permissions/ })).toBeTruthy()
    expect(screen.queryByLabelText('New branch from latest main')).toBeNull()
    expect(screen.queryByLabelText('Existing branch')).toBeNull()

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'No worktree task' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'No worktree task',
        'backlog',
        'test-project-id',
        'default',
        {
          worktreeSource: 'disabled',
          worktreeBranch: null,
        },
      )
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('does not show label controls while creating a task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await findPromptTextbox()

    expect(screen.queryByRole('textbox', { name: 'Add label' })).toBeNull()
  })

  it('pre-fills fields in edit mode', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.getByRole('heading', { name: 'Edit Task' })).toBeTruthy()
    
    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('Existing Task')
  })

  it('pre-fills edit mode from mutable prompt when present', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: { ...mockTask, initial_prompt: 'Immutable initial prompt', prompt: 'Mutable prompt text' },
      },
    })

    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('Mutable prompt text')
  })

  it('calls updateTask when submitted in edit mode', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, onTaskSaved } })
    
    const submitBtn = await screen.findByRole('button', { name: /Submit/ })
    await fireEvent.click(submitBtn)
    
    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('T-42', 'Existing Task')
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('shows permission mode dropdown when the environment is expanded for claude-code', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await expandEnvironment()

    await waitFor(() => {
      expect(screen.getByRole('combobox')).toBeTruthy() // Mode select
    })
  })

  it('includes autorun as a Claude Code permission mode using Claude\'s auto value', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await expandEnvironment()
    const select = await screen.findByRole('combobox') as HTMLSelectElement
    const autorunOption = Array.from(select.options).find((option) => option.textContent === 'Autorun')

    expect(autorunOption?.value).toBe('auto')
  })

  it('persists Claude auto mode when Autorun is selected for a new Claude Code task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await expandEnvironment()
    const select = await screen.findByRole('combobox') as HTMLSelectElement

    await fireEvent.change(select, { target: { value: 'auto' } })
    expect(screen.getByRole('button', { name: /Environment: Worktree · latest main · autorun/ })).toBeTruthy()
    await fireEvent.input(textbox, { target: { value: 'Task with autorun' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task with autorun', 'backlog', 'test-project-id', 'auto', DEFAULT_WORKTREE_OPTIONS)
    })
  })

  it('uses the resolved Codex provider for dollar-trigger skill autocomplete when project config inherits global provider', async () => {
    vi.mocked(getResolvedAiProvider).mockResolvedValue('codex')
    vi.mocked(listOpenCodeCommands).mockResolvedValue([
      { name: 'skill:grill-with-docs', description: 'Grill with docs', source: 'skill', agent: null },
    ])

    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: '$skill' } })

    await waitFor(() => {
      expect(screen.queryAllByRole('option').length).toBeGreaterThan(0)
    })

    await fireEvent.keyDown(textbox, { key: 'Enter' })

    expect(textbox.value).toBe('$skill:grill-with-docs ')
    expect(getResolvedAiProvider).toHaveBeenCalledWith('test-project-id')
  })

  it('uses direct task creation defaults and no agent when starting a task for opencode', async () => {
    const onRunAction = vi.fn()
    vi.mocked(getResolvedAiProvider).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })

    const textbox = await findPromptTextbox()

    await waitFor(() => {
      expect(screen.queryByRole('combobox')).toBeNull()
    })

    await fireEvent.input(textbox, { target: { value: 'Task for default agent' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task for default agent', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', null)
    })
  })

  it('runs the selected custom action through the shared dialog flow', async () => {
    const onRunAction = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Task with action' } })

    await fireEvent.click(await screen.findByRole('button', { name: 'More' }))
    const actionButton = await screen.findByRole('menuitem', { name: 'Test Action' })
    await fireEvent.click(actionButton)

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task with action', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onRunAction).toHaveBeenCalledWith('T-1', 'Do test', null)
    })
  })

  it('calls onRunAction when PromptInput triggers start task', async () => {
    const onRunAction = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })
    
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Task to start' } })
    
    const startBtn = await screen.findByRole('button', { name: /Start Task/ })
    await fireEvent.click(startBtn)
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task to start', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onRunAction).toHaveBeenCalledWith('T-1', '', null)
    })
  })
})
