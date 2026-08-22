import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
  secondaryTask,
} from './TaskDetailView.testUtils'

const {
  TaskDetailView,
  tasks,
} = getTaskDetailViewTestDependencies()

describe('TaskDetailView — inspector', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('uses the shared task inspector with the Initial Prompt section', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByTestId('task-inspector-panel')).toBeTruthy()
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  it('owns right info pane scrolling at the sidebar boundary', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    const scrollContainer = screen.getByTestId('task-info-scroll-container')
    const infoPanel = screen.getByTestId('task-info-panel')

    expect(scrollContainer.getAttribute('data-scroll-owner')).toBe('task-info-panel')
    expect(infoPanel.getAttribute('data-scroll-owner')).toBe('false')
    expect(scrollContainer.contains(infoPanel)).toBe(true)
  })

  it('does not render a header Edit button (prompt editing lives in the info panel)', () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull()
  })

  it('exposes Edit prompt in the info panel for backlog tasks when onEdit is provided', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(await screen.findByRole('button', { name: 'Edit prompt' })).toBeTruthy()
  })

  it('does not expose Edit prompt for doing tasks', () => {
    render(TaskDetailView, { props: { task: { ...baseTask, status: 'doing' }, onRunAction: mockOnRunAction, onEdit: vi.fn() } })
    expect(screen.queryByRole('button', { name: 'Edit prompt' })).toBeNull()
  })

  it('Edit prompt in the info panel calls onEdit with the task id', async () => {
    const onEdit = vi.fn()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onEdit } })
    await fireEvent.click(await screen.findByRole('button', { name: 'Edit prompt' }))
    expect(onEdit).toHaveBeenCalledWith('T-42')
  })

  it('opens a dependent task from the task view info panel', async () => {
    const onOpenTask = vi.fn()
    const dependentTask = {
      ...secondaryTask,
      depends_on: [baseTask.id],
    }
    tasks.set([baseTask, dependentTask])

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction, onOpenTask } })

    await fireEvent.click(screen.getByRole('button', { name: /T-99/ }))

    expect(onOpenTask).toHaveBeenCalledWith('T-99', null)
    expect(onOpenTask).toHaveBeenCalledTimes(1)
  })

  it('shows TaskInfoPanel by default', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  it('Info panel always visible in agent mode (no tab toggle)', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('Initial Prompt')).toBeTruthy()
    })
    expect(screen.queryByRole('button', { name: /^Info$/ })).toBeNull()
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('rightPanelMode state does NOT exist — Info always visible', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    expect(screen.getByText('Initial Prompt')).toBeTruthy()
  })

  describe('info panel hide/show toggle', () => {
      it('renders the info panel by default in agent view with a workspace', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('clicking Hide removes the panel and clicking Show restores it', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeNull()
          expect(screen.getByRole('button', { name: 'Show task info panel' })).toBeTruthy()
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Show task info panel' }))

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('the toggle button reflects panel visibility via aria-pressed', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' }).getAttribute('aria-pressed')).toBe('true')
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Show task info panel' }).getAttribute('aria-pressed')).toBe('false')
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('persists the hidden state to localStorage keyed by task id', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })

        await fireEvent.click(screen.getByRole('button', { name: 'Hide task info panel' }))

        await waitFor(() => {
          expect(localStorage.getItem('task-info-panel-hidden:T-42')).toBe('1')
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('starts hidden for a task whose stored state is hidden', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        localStorage.setItem('task-info-panel-hidden:T-42', '1')

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Show task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeNull()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('starts visible for a different task with no stored state', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        // Only T-42 is marked hidden; T-99 has no stored state
        localStorage.setItem('task-info-panel-hidden:T-42', '1')

        render(TaskDetailView, { props: { task: secondaryTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.getByRole('button', { name: 'Hide task info panel' })).toBeTruthy()
        })
        expect(screen.queryByTestId('task-info-panel')).toBeTruthy()

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('opens the workspace in VS Code when the VS Code button is clicked', async () => {
        const { getTaskWorkspace, openInEditor } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        const button = await screen.findByRole('button', { name: /open in vs code/i })
        await fireEvent.click(button)

        expect(openInEditor).toHaveBeenCalledWith('/tmp/wt')
        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })

      it('⌘/ toggles the info panel visibility', async () => {
        const { getTaskWorkspace } = await import('../../lib/ipc')
        vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

        render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
        })

        await fireEvent.keyDown(window, { key: '/', metaKey: true })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeNull()
        })

        await fireEvent.keyDown(window, { key: '/', metaKey: true })

        await waitFor(() => {
          expect(screen.queryByTestId('task-info-panel')).toBeTruthy()
        })

        vi.mocked(getTaskWorkspace).mockResolvedValue(null)
      })
    })
})
