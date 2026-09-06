import { render, screen, fireEvent, waitFor } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import AddTaskDialog from './AddTaskDialog.svelte'
import type { TaskDetail } from '../lib/types'
import { createTask, updateTaskInitialPrompt, getProjectConfig, getResolvedAiProvider, listGitBranches, repoHasCommits, listOpenCodeCommands } from '../lib/ipc'

vi.mock('../lib/ipc', () => ({
  createTask: vi.fn().mockResolvedValue({
    id: 'T-1',
    projectId: 'test-project-id',
    status: 'backlog',
    title: 'New Task',
    prompt: 'New Task',
    promptPreview: 'New Task',
    agent: null,
    permissionMode: null,
    worktreeSource: null,
    worktreeBranch: null,
    sourceTicketUrl: null,
    dependsOn: [],
    labels: [],
    titleSource: null,
    titleGeneratedAt: null,
    createdAt: 1000,
    updatedAt: 1000,
  }),
  updateTaskInitialPrompt: vi.fn().mockResolvedValue(undefined),
  getConfig: vi.fn().mockResolvedValue(null),
  getProjectConfig: vi.fn().mockResolvedValue(null),
  getResolvedAiProvider: vi.fn().mockResolvedValue('claude-code'),
  listGitBranches: vi.fn().mockResolvedValue([
    { name: 'main', is_current: true, is_remote: false },
    { name: 'feature/open-pr', is_current: false, is_remote: false },
  ]),
  repoHasCommits: vi.fn().mockResolvedValue(true),
  getProjectTaskLabels: vi.fn().mockResolvedValue([]),
  listOpenCodeCommands: vi.fn().mockResolvedValue([]),
  searchOpenCodeFiles: vi.fn().mockResolvedValue([]),
  listOpenCodeAgents: vi.fn().mockResolvedValue([]),
}))

const DEFAULT_WORKTREE_OPTIONS = {
  worktreeSource: 'newBranchFromMain',
  worktreeBranch: null,
  title: null,
  sourceTicketUrl: null,
  taskDisplayTitleUpdatesEnabled: false,
  aiProvider: 'claude-code',
}

const PROJECT_DIRECTORY_OPTIONS = {
  worktreeSource: 'disabled',
  worktreeBranch: null,
  title: null,
  sourceTicketUrl: null,
  taskDisplayTitleUpdatesEnabled: false,
  aiProvider: 'claude-code',
}

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
  // The prompt is a <textarea>; the optional title field is an <input>, so target
  // the textarea specifically rather than relying on textbox ordering.
  const textarea = screen
    .getAllByRole('textbox')
    .find((element): element is HTMLTextAreaElement => element.tagName === 'TEXTAREA')
  if (!textarea) throw new Error('prompt textarea not found')
  return textarea
}

async function clickAddToBacklogFromMore() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Add to backlog' }))
}

/** Leaves the branch listing pending forever, the way a stalled origin does. */
function stubBranchListNeverResolves() {
  vi.mocked(listGitBranches).mockReturnValue(new Promise(() => {}))
}

async function expandEnvironment() {
  await fireEvent.click(await screen.findByRole('button', { name: 'Edit environment' }))
}

function setClipboardRead(read: () => Promise<Array<{ types: string[], getType: (type: string) => Promise<Blob> }>>) {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { read },
  })
}

const mockTask: TaskDetail = {
  id: 'T-42',
  prompt: 'Existing Task',
  promptPreview: 'Existing Task',
  status: 'doing',
  title: 'Existing Task',
  titleSource: null,
  titleGeneratedAt: null,
  agent: null,
  permissionMode: null,
  worktreeSource: null,
  worktreeBranch: null,
  sourceTicketUrl: null,
  dependsOn: [],
  projectId: 'project-1',
  createdAt: 1000,
  updatedAt: 2000,
  labels: [],
}

describe('AddTaskDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Element.prototype.scrollIntoView = vi.fn()
    vi.mocked(getProjectConfig).mockResolvedValue(null)
    vi.mocked(getResolvedAiProvider).mockResolvedValue('claude-code')
    vi.mocked(listGitBranches).mockResolvedValue([
      { name: 'main', is_current: true, is_remote: false },
      { name: 'feature/open-pr', is_current: false, is_remote: false },
    ])
    vi.mocked(repoHasCommits).mockResolvedValue(true)
    vi.mocked(listOpenCodeCommands).mockResolvedValue([])
  })


  it('closes only after the async start flow succeeds', async () => {
    let resolveRunAction = () => {}
    const onClose = vi.fn()
    const onRunAction = vi.fn(() => new Promise<void>((resolve) => {
      resolveRunAction = resolve
    }))

    render(AddTaskDialog, { props: { mode: 'create', onClose, onRunAction } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: '  Start me  ' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Start me', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onClose).not.toHaveBeenCalled()
      expect(onRunAction).toHaveBeenCalledWith('T-1', '')
    })

    resolveRunAction()
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce())
  })

  it('calls createTask with correct arguments on submit via PromptInput', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', onTaskSaved } })
    
    const textbox = await findPromptTextbox()
    // Svelte bind:value needs the value to be updated, or we fire `input` event
    await fireEvent.input(textbox, { target: { value: '  My new task  ' } })
    
    // The "Add to Backlog" button creates a backlog task
    await clickAddToBacklogFromMore()
    
    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('My new task', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
      expect(onTaskSaved).toHaveBeenCalled()
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
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskSaved } })

    await expandEnvironment()
    const worktreeToggle = await screen.findByLabelText('Worktree') as HTMLInputElement
    expect(worktreeToggle.checked).toBe(false)
    expect(screen.getAllByText('Project directory').length).toBeGreaterThan(0)
    expect(screen.getByText('default permissions')).toBeTruthy()

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
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('disables the worktree toggle and runs in the project directory when the repo has no commits', async () => {
    vi.mocked(repoHasCommits).mockResolvedValue(false)
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'create', projectPath: '/repo', onTaskSaved } })

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
      expect(onTaskSaved).toHaveBeenCalled()
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
    await fireEvent.click(screen.getByRole('combobox', { name: 'Branch' }))
    await fireEvent.click(await screen.findByRole('option', { name: /^feature\/open-pr/ }))
    expect(screen.getByRole('group', { name: 'Environment summary: Worktree, feature/open-pr, default permissions' })).toBeTruthy()
    expect(screen.getByText('default permissions')).toBeTruthy()

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
          sourceTicketUrl: null,
          taskDisplayTitleUpdatesEnabled: false,
          aiProvider: 'claude-code',
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
    expect(screen.getByRole('group', { name: 'Environment summary: Project directory, latest main, default permissions' })).toBeTruthy()
    expect(screen.getByText('default permissions')).toBeTruthy()
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
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('inserts a clipboard image marker into the prompt and persists the image reference', async () => {
    setClipboardRead(() => Promise.resolve([
      {
        types: ['image/png'],
        getType: async () => new Blob(['image-bytes'], { type: 'image/png' }),
      },
    ]))

    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Build the screenshot state' } })
    textbox.setSelectionRange('Build'.length, 'Build'.length)
    await fireEvent.click(await screen.findByRole('button', { name: 'Attach image' }))

    await waitFor(() => {
      expect(textbox.value).toBe('Build [image#1] the screenshot state')
      expect(screen.getByText('1 image ready')).toBeTruthy()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toContain('Build [image#1] the screenshot state')
      expect(prompt).toContain('[image#1]: data:image/png;base64,')
      expect(createTask).toHaveBeenCalledWith(prompt, 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
    })
  })

  it('inserts an image marker at the textarea paste position', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })
    textbox.setSelectionRange('Use this'.length, 'Use this'.length)
    await fireEvent.paste(textbox, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => new File(['image-bytes'], 'screenshot.png', { type: 'image/png' }),
          },
        ],
      },
    })

    await waitFor(() => {
      expect(textbox.value).toBe('Use this [image#1] screenshot')
      expect(screen.getByText('1 image ready')).toBeTruthy()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toContain('Use this [image#1] screenshot')
      expect(prompt).toContain('[image#1]: data:image/png;base64,')
    })
  })

  it('opens a preview dialog when an inline image marker is clicked', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect screenshot' } })
    textbox.setSelectionRange('Inspect'.length, 'Inspect'.length)
    await fireEvent.paste(textbox, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => new File(['image-bytes'], 'screenshot.png', { type: 'image/png' }),
          },
        ],
      },
    })

    await waitFor(() => {
      expect(textbox.value).toBe('Inspect [image#1] screenshot')
    })

    const markerStart = textbox.value.indexOf('[image#1]')
    textbox.setSelectionRange(markerStart + 2, markerStart + 2)
    await fireEvent.click(textbox)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Pasted image [image#1]' })).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Pasted image [image#1]' })).toBeTruthy()
    })
  })

  it('removes a pasted image when its inline marker is deleted from the prompt', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })
    textbox.setSelectionRange('Use this'.length, 'Use this'.length)
    await fireEvent.paste(textbox, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/png',
            getAsFile: () => new File(['image-bytes'], 'screenshot.png', { type: 'image/png' }),
          },
        ],
      },
    })

    await waitFor(() => {
      expect(textbox.value).toBe('Use this [image#1] screenshot')
      expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()
    })

    await fireEvent.input(textbox, { target: { value: 'Use this screenshot' } })

    await waitFor(() => {
      expect(screen.queryByText('1 image ready')).toBeNull()
      expect(screen.queryByRole('button', { name: 'Preview [image#1]' })).toBeNull()
    })

    await clickAddToBacklogFromMore()

    await waitFor(() => {
      const prompt = vi.mocked(createTask).mock.calls[0][0]
      expect(prompt).toBe('Use this screenshot')
      expect(prompt).not.toContain('[image#1]: data:image/png;base64,')
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

  it('passes the entered source ticket link when creating a task', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    const sourceTicketInput = screen.getByLabelText('Source ticket link') as HTMLInputElement
    await fireEvent.input(sourceTicketInput, { target: { value: '  https://github.com/koenvg/openforge/issues/1294  ' } })
    await fireEvent.input(textbox, { target: { value: 'Body of task' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Body of task', 'backlog', 'test-project-id', 'default', {
        ...DEFAULT_WORKTREE_OPTIONS,
        sourceTicketUrl: 'https://github.com/koenvg/openforge/issues/1294',
      })
    })
  })

  it('omits the source ticket link (null) when none is entered', async () => {
    render(AddTaskDialog, { props: { mode: 'create' } })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'No ticket body' } })
    await clickAddToBacklogFromMore()

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('No ticket body', 'backlog', 'test-project-id', 'default', DEFAULT_WORKTREE_OPTIONS)
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

  it('pre-fills fields in edit mode', async () => {
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask } })
    expect(screen.getByRole('heading', { name: 'Edit task' })).toBeTruthy()
    
    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('Existing Task')
  })

  it('pre-fills edit mode from mutable prompt when present', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: { ...mockTask, prompt: 'Mutable prompt text' },
      },
    })

    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('Mutable prompt text')
  })

  it('hides persisted image reference definitions when editing a task prompt', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    const textbox = await findPromptTextbox()
    expect(textbox.value).toBe('Inspect [image#1] carefully')
    expect(textbox.value).not.toContain('data:image/png;base64')
  })

  it('shows persisted image marker controls when editing a task prompt', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    await findPromptTextbox()

    expect(screen.getByText('1 image ready')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Attach image' })).toBeTruthy()
  })

  it('pastes an additional image marker while editing a persisted image prompt', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    const textbox = await findPromptTextbox()
    textbox.setSelectionRange(textbox.value.length, textbox.value.length)
    await fireEvent.paste(textbox, {
      clipboardData: {
        items: [
          {
            kind: 'file',
            type: 'image/jpeg',
            getAsFile: () => new File(['second-image'], 'second.jpg', { type: 'image/jpeg' }),
          },
        ],
      },
    })

    await waitFor(() => {
      expect(textbox.value).toBe('Inspect [image#1] carefully [image#2] ')
      expect(screen.getByText('2 images ready')).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Preview [image#1]' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Preview [image#2]' })).toBeTruthy()
    })

    await fireEvent.click(await screen.findByRole('button', { name: /Submit/ }))

    await waitFor(() => {
      const prompt = vi.mocked(updateTaskInitialPrompt).mock.calls[0][1]
      expect(updateTaskInitialPrompt).toHaveBeenCalledWith('T-42', prompt)
      expect(prompt).toContain('Inspect [image#1] carefully [image#2]')
      expect(prompt).toContain('[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=')
      expect(prompt).toContain('[image#2]: data:image/jpeg;base64,')
    })
  })

  it('opens a persisted image preview when an inline marker is clicked in edit mode', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    const textbox = await findPromptTextbox()
    const markerStart = textbox.value.indexOf('[image#1]')
    textbox.setSelectionRange(markerStart + 2, markerStart + 2)
    await fireEvent.click(textbox)

    await waitFor(() => {
      expect(screen.getByRole('dialog', { name: 'Pasted image [image#1]' })).toBeTruthy()
      expect(screen.getByRole('img', { name: 'Pasted image [image#1]' })).toBeTruthy()
    })
  })

  it('updates the initial prompt when submitted in edit mode', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, { props: { mode: 'edit', task: mockTask, onTaskSaved } })
    
    const submitBtn = await screen.findByRole('button', { name: /Submit/ })
    await fireEvent.click(submitBtn)
    
    await waitFor(() => {
      expect(updateTaskInitialPrompt).toHaveBeenCalledWith('T-42', 'Existing Task')
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('preserves persisted image references when saving an edited prompt that keeps the marker', async () => {
    const onTaskSaved = vi.fn()
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
        onTaskSaved,
      },
    })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect [image#1] again' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Submit/ }))

    await waitFor(() => {
      expect(updateTaskInitialPrompt).toHaveBeenCalledWith(
        'T-42',
        'Inspect [image#1] again\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
      )
      expect(onTaskSaved).toHaveBeenCalled()
    })
  })

  it('drops persisted image references when saving an edited prompt after deleting the marker', async () => {
    render(AddTaskDialog, {
      props: {
        mode: 'edit',
        task: {
          ...mockTask,
          prompt: 'Inspect [image#1] carefully\n\n[image#1]: data:image/png;base64,aW1hZ2UtYnl0ZXM=',
        },
      },
    })

    const textbox = await findPromptTextbox()
    await fireEvent.input(textbox, { target: { value: 'Inspect carefully' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Submit/ }))

    await waitFor(() => {
      expect(updateTaskInitialPrompt).toHaveBeenCalledWith('T-42', 'Inspect carefully')
    })
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
    expect(screen.getByText('autorun')).toBeTruthy()
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
    const onRunAction = vi.fn()
    vi.mocked(getResolvedAiProvider).mockResolvedValue('opencode')
    render(AddTaskDialog, { props: { mode: 'create', onRunAction } })

    const textbox = await findPromptTextbox()

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Provider' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Mode' })).toBeNull()
    })

    await fireEvent.input(textbox, { target: { value: 'Task for default agent' } })
    await fireEvent.click(await screen.findByRole('button', { name: /Start Task/ }))

    await waitFor(() => {
      expect(createTask).toHaveBeenCalledWith('Task for default agent', 'backlog', 'test-project-id', 'default', { ...DEFAULT_WORKTREE_OPTIONS, aiProvider: 'opencode' })
      expect(onRunAction).toHaveBeenCalledWith('T-1', '')
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
      expect(onRunAction).toHaveBeenCalledWith('T-1', '')
    })
  })
})
