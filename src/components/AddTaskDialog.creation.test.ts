import { DEFAULT_WORKTREE_OPTIONS, PROJECT_DIRECTORY_OPTIONS, mockTask, findPromptTextbox, clickAddToBacklogFromMore, resetDialogMocks } from './AddTaskDialog.testFixtures'
import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { TaskDetail } from '../lib/types'
import { createTask, getProjectConfig, getResolvedAiProvider, listGitBranches, repoHasCommits, listOpenCodeCommands } from '../lib/ipc'

/** Leaves the branch listing pending forever, the way a stalled origin does. */
function stubBranchListNeverResolves() {
  vi.mocked(listGitBranches).mockReturnValue(new Promise(() => {}))
}

// Environment controls now render inline in the properties rail; this waits for
// them to be present (defaults resolved) rather than opening a disclosure.
async function expandEnvironment() {
  await screen.findByRole('button', { name: 'Provider' })
}

describe('AddTaskDialog creation', () => {
  beforeEach(resetDialogMocks)

  it('closes after saving without showing a saved-task retry screen', async () => {
    const onClose = vi.fn()
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose, onTaskCreated } })
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: '  Start me  ' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), 'start')
    expect(screen.queryByText(/Retrying will continue/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('calls createTask with correct arguments on submit via PromptInput', async () => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onTaskCreated } })
    
    const textbox = await findPromptTextbox()
    // Svelte bind:value needs the value to be updated, or we fire `input` event
    await fireEvent.input(textbox, { target: { value: '  My new task  ' } })
    
    // The "Add to Backlog" button creates a backlog task
    await clickAddToBacklogFromMore()
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('My new task', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onTaskCreated).toHaveBeenCalled()
    })
  })

  it('shows an explicit loading state and disables both creation actions while saving', async () => {
    let resolveCreate!: (task: TaskDetail) => void
    vi.mocked(createTask).mockImplementationOnce(() => new Promise<TaskDetail>((resolve) => {
      resolveCreate = resolve
    }))
    const onClose = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onClose } })

    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Save once' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))

    await waitFor(() => {
      expect((screen.getByRole('button', { name: 'Adding…' }) as HTMLButtonElement).disabled).toBe(true)
      expect((screen.getByRole('button', { name: /Start Task/ }) as HTMLButtonElement).disabled).toBe(true)
    })

    resolveCreate({ ...mockTask, id: 'T-1', status: 'backlog' })
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
    expect(createTask).toHaveBeenCalledOnce()
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

  it('surfaces task-default loading failures and keeps Task Creation blocked', async () => {
    vi.mocked(getProjectConfig).mockRejectedValue(new Error('settings unavailable'))
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Create safely' } })

    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not load task defaults. Retry before creating this task.',
    )
    expect((screen.getByRole('button', { name: 'Add to backlog' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Start Task/ }) as HTMLButtonElement).disabled).toBe(true)

    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))
    expect(createTask).not.toHaveBeenCalled()
  })

  it('retries task-default loading and restores Task Creation after recovery', async () => {
    let loadShouldFail = true
    vi.mocked(getProjectConfig).mockImplementation(() =>
      loadShouldFail ? Promise.reject(new Error('settings unavailable')) : Promise.resolve(null),
    )
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await fireEvent.input(await findPromptTextbox(), { target: { value: 'Create after retry' } })
    await screen.findByRole('alert')
    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))

    loadShouldFail = false
    await fireEvent.click(screen.getByRole('button', { name: 'Retry loading defaults' }))

    await waitFor(() => {
      expect(screen.queryByRole('alert')).toBeNull()
      expect((screen.getByRole('button', { name: 'Add to backlog' }) as HTMLButtonElement).disabled).toBe(false)
    })
    await fireEvent.click(screen.getByRole('button', { name: 'Add to backlog' }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Create after retry',
        'backlog',
        'test-project-id',
        'default',
        DEFAULT_WORKTREE_OPTIONS,
      )
    })
  })

  it('gates task creation until the project workspace default has loaded', async () => {
    let resolveProjectConfig: (value: string | null) => void = () => {}
    // Only gate on the worktree default; other hierarchy keys resolve immediately so
    // the dialog is blocked purely on the workspace default loading.
    vi.mocked(getProjectConfig).mockImplementation((_projectId: string, key: string) =>
      key === 'use_worktrees'
        ? new Promise((resolve) => {
            resolveProjectConfig = resolve
          })
        : Promise.resolve(null),
    )
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Create after defaults' } })
    const startButton = await screen.findByRole('button', { name: /Start Task/ }) as HTMLButtonElement
    expect(startButton.disabled).toBe(true)
    expect(screen.getByText('Loading task defaults…')).toBeTruthy()

    await fireEvent.click(startButton)
    expect(createTask).not.toHaveBeenCalled()

    resolveProjectConfig('false')
    await waitFor(() => {
      expect(startButton.disabled).toBe(false)
    })

    await fireEvent.click(startButton)
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Create after defaults',
        'backlog',
        'test-project-id',
        'default',
        PROJECT_DIRECTORY_OPTIONS,
      )
    })
  })

  it('accepts task creation while the branch list is still loading', async () => {
    // A slow or dead remote must not gate submission: the branch list is only
    // needed when the task starts from an existing branch.
    stubBranchListNeverResolves()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Create while branches load' } })

    const startButton = await screen.findByRole('button', { name: /Start Task/ }) as HTMLButtonElement
    await waitFor(() => {
      expect(startButton.disabled).toBe(false)
    })
    expect(screen.queryByText('Loading task defaults…')).toBeNull()

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Create while branches load',
        'backlog',
        'test-project-id',
        'default',
        DEFAULT_WORKTREE_OPTIONS,
      )
    })
  })

  it('reports the branch list as loading rather than empty while it loads', async () => {
    stubBranchListNeverResolves()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))

    expect(await screen.findByText('Loading branches…')).toBeTruthy()
    expect(screen.queryByText('No branches available')).toBeNull()
  })

  it('reports the branch list as loading before the task defaults resolve', async () => {
    // The repo to list branches from is only known once the defaults resolve, so
    // the selector must not claim there are none during that window either.
    vi.mocked(repoHasCommits).mockReturnValue(new Promise(() => {}))
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))

    expect(await screen.findByText('Loading branches…')).toBeTruthy()
    expect(listGitBranches).not.toHaveBeenCalled()
  })

  it('explains that branches are still loading when starting from an existing branch too early', async () => {
    stubBranchListNeverResolves()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Too early for a branch' } })
    await clickAddToBacklogFromMore()

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Branches are still loading.')
    expect(createTask).not.toHaveBeenCalled()
  })

  it('uses the project default when new tasks should start in the project directory', async () => {
    vi.mocked(getProjectConfig).mockImplementation((_projectId: string, key: string) =>
      Promise.resolve(key === 'use_worktrees' ? 'false' : null),
    )
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskCreated } })

    await expandEnvironment()
    const worktreeToggle = await screen.findByLabelText('Worktree') as HTMLInputElement
    expect(worktreeToggle.checked).toBe(false)
    expect(screen.getAllByText('Project directory').length).toBeGreaterThan(0)

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Default project-directory task' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Default project-directory task',
        'backlog',
        'test-project-id',
        'default',
        PROJECT_DIRECTORY_OPTIONS,
      )
      expect(onTaskCreated).toHaveBeenCalled()
    })
  })

  it('disables the worktree toggle and runs in the project directory when the repo has no commits', async () => {
    vi.mocked(repoHasCommits).mockResolvedValue(false)
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskCreated } })

    await expandEnvironment()
    const worktreeToggle = await screen.findByLabelText('Worktree') as HTMLInputElement
    await waitFor(() => expect(worktreeToggle.disabled).toBe(true))
    expect(worktreeToggle.checked).toBe(false)

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Bootstrap an app' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith(
        'Bootstrap an app',
        'backlog',
        'test-project-id',
        'default',
        PROJECT_DIRECTORY_OPTIONS,
      )
      expect(onTaskCreated).toHaveBeenCalled()
    })
  })

  it('passes the selected existing branch when creating a worktree-backed task', async () => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'create',
        projectPath: '/repo',
        onTaskCreated,
      },
    })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))
    await fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }))
    await fireEvent.click(await screen.findByRole('option', { name: /^feature\/open-pr/ }))
    expect(screen.getByRole('group', { name: 'Environment summary: Worktree, feature/open-pr, default permissions' })).toBeTruthy()

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
          title: null,
          taskDisplayTitleUpdatesEnabled: false,
          aiProvider: 'claude-code',
        },
      )
      expect(onTaskCreated).toHaveBeenCalled()
    })
  })

  it('creates a project-directory task when the worktree toggle is off', async () => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskCreated } })

    await expandEnvironment()
    await fireEvent.click(await screen.findByLabelText('Worktree'))
    expect(screen.getByRole('group', { name: 'Environment summary: Project directory, latest main, default permissions' })).toBeTruthy()
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
        PROJECT_DIRECTORY_OPTIONS,
      )
      expect(onTaskCreated).toHaveBeenCalled()
    })
  })

  it('passes the entered title when creating a task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    const titleInput = screen.getByLabelText('Task title') as HTMLInputElement
    await fireEvent.input(titleInput, { target: { value: '  My titled task  ' } })
    await fireEvent.input(textbox, { target: { value: 'Body of task' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Body of task', 'backlog', 'test-project-id', 'default', {
        ...DEFAULT_WORKTREE_OPTIONS,
        title: 'My titled task',
      })
    })
  })

  it('omits the title (null) when none is entered', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Untitled body' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Untitled body', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
    })
  })

  it('clears the title and enables AI naming when AI-generated is selected', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    const titleInput = screen.getByLabelText('Task title') as HTMLInputElement
    await fireEvent.input(titleInput, { target: { value: 'Typed then abandoned' } })
    await fireEvent.click(screen.getByLabelText('AI-generated title'))
    await waitFor(() => expect(screen.queryByLabelText('Task title')).toBeNull())
    await fireEvent.input(textbox, { target: { value: 'Let the agent name it' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Let the agent name it', 'backlog', 'test-project-id', 'default', {
        ...DEFAULT_WORKTREE_OPTIONS,
        taskDisplayTitleUpdatesEnabled: true,
      })
    })
  })


  it('filters the existing branch list when searching', async () => {
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo' } })

    await expandEnvironment()
    await fireEvent.click(screen.getByLabelText('Existing branch'))
    await fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }))

    expect(await screen.findByRole('option', { name: /^feature\/open-pr/ })).toBeTruthy()
    expect(screen.getByRole('option', { name: /^main/ })).toBeTruthy()

    const search = screen.getByPlaceholderText('Search...')
    await fireEvent.input(search, { target: { value: 'feature' } })

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /^main/ })).toBeNull()
      expect(screen.getByRole('option', { name: /^feature\/open-pr/ })).toBeTruthy()
    })
  })

  it('does not show label controls while creating a task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await findPromptTextbox()

    expect(screen.queryByRole('textbox', { name: 'Add label' })).toBeNull()
  })

  it('shows permission mode dropdown when the environment is expanded for claude-code', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await expandEnvironment()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Mode' })).toBeTruthy()
    })
  })

  it('includes Autorun in the Claude Code permission modes', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    await expandEnvironment()
    const modeSelect = await screen.findByRole('button', { name: 'Mode' })
    modeSelect.focus()
    await fireEvent.keyDown(modeSelect, { key: 'ArrowDown' })

    expect(await screen.findByRole('option', { name: 'Autorun' })).toBeTruthy()
  })

  it('creates a task with the AI provider chosen in the environment controls', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await expandEnvironment()

    const providerSelect = await screen.findByRole('button', { name: 'Provider' })
    expect(providerSelect.textContent).toContain('Claude Code')
    providerSelect.focus()
    await fireEvent.keyDown(providerSelect, { key: 'ArrowDown' })
    await fireEvent.keyDown(providerSelect, { key: 'ArrowDown' })
    await fireEvent.keyDown(providerSelect, { key: 'Enter' })
    expect(providerSelect.textContent).toContain('OpenCode')
    await fireEvent.input(textbox, { target: { value: 'Task with chosen provider' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task with chosen provider', 'backlog', 'test-project-id', 'default', {
        ...DEFAULT_WORKTREE_OPTIONS,
        aiProvider: 'opencode',
      })
    })
  })

  it('persists Claude auto mode when Autorun is selected for a new Claude Code task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await expandEnvironment()
    const select = await screen.findByRole('button', { name: 'Mode' })

    select.focus()
    await fireEvent.keyDown(select, { key: 'ArrowDown' })
    await fireEvent.keyDown(select, { key: 'ArrowDown' })
    await fireEvent.keyDown(select, { key: 'Enter' })
    expect(screen.getByRole('button', { name: 'Mode' }).textContent).toContain('Autorun')
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

  it('uses direct task creation defaults when starting a task for opencode', async () => {
    const onTaskCreated = vi.fn()
    vi.mocked(getResolvedAiProvider).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create', onTaskCreated } })

    const textbox = await findPromptTextbox()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Provider' })).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: 'Mode' })).toBeNull()

    await fireEvent.input(textbox, { target: { value: 'Task for default agent' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task for default agent', 'backlog', 'test-project-id', 'default', { ...DEFAULT_WORKTREE_OPTIONS, aiProvider: 'opencode' })
      expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), 'start')
    })
  })

  it('calls onTaskCreated when PromptInput triggers start task', async () => {
    const onTaskCreated = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onTaskCreated } })
    
    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Task to start' } })
    
    const startBtn = await screen.findByRole('button', { name: /Start Task/ })
    await fireEvent.click(startBtn)
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task to start', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onTaskCreated).toHaveBeenCalledWith(expect.objectContaining({ id: 'T-1' }), 'start')
    })
  })
})
