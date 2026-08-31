import { fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { get } from 'svelte/store'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  TERMINAL_VIEW_ID,
  baseTask,
  createTaskWorkspaceInfo,
  getTaskDetailViewTestDependencies,
  mockOnRunAction,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'

const { TaskDetailView, commandHeld, taskActiveView } = getTaskDetailViewTestDependencies()

describe('TaskDetailView keyboard shortcuts', () => {
  beforeEach(resetTaskDetailViewTestState)

  beforeEach(() => {
    taskActiveView.set(new Map())
  })

  it('⌘3 switches to terminal tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => expect(screen.getByRole('button', { name: /^agent\b/i })).toBeTruthy())

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^terminal\b/i }).getAttribute('aria-pressed')).toBe('true')
    })
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('Cmd+1 switches from an active terminal pane to agent without selecting a shell tab', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    const { regularTerminalSessions } = await import('../../lib/terminalSessionService')
    const { focusTerminal } = regularTerminalSessions
    const { createTerminalShortcutController } = await import('../../lib/terminalShortcutController')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/path/to/worktree', repo_path: '/repo', branch_name: 'branch' }))

    const switchToTab = vi.fn()
    const terminalShortcuts = createTerminalShortcutController()
    terminalShortcuts.terminalTabsRef = {
      addTab: vi.fn(),
      closeActiveTab: vi.fn().mockResolvedValue(undefined),
      focusActiveTab: vi.fn(),
      switchToTab,
    }
    const unregisterTerminalShortcuts = terminalShortcuts.registerWindowKeydown()

    try {
      render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
      await waitFor(() => expect(screen.getByRole('button', { name: /^terminal\b/i })).toBeTruthy())

      await fireEvent.click(screen.getByRole('button', { name: /^terminal\b/i }))

      await waitFor(() => {
        expect(get(taskActiveView).get(baseTask.id)).toBe(TERMINAL_VIEW_ID)
      })

      vi.mocked(focusTerminal).mockClear()
      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
        expect(get(taskActiveView).get(baseTask.id)).toBe('agent')
      })
      expect(switchToTab).not.toHaveBeenCalled()
      expect(vi.mocked(focusTerminal)).not.toHaveBeenCalled()
    } finally {
      unregisterTerminalShortcuts()
      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    }
  })

  it('l key switches to review mode when worktree exists', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(window, { key: 'l' })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('h key switches back to agent mode from review', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    await fireEvent.keyDown(window, { key: 'l' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: 'h' })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('h and l keys are ignored when no worktree exists', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    // With no worktree the view tabs do not render; the view stays on agent
    expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()

    await fireEvent.keyDown(window, { key: 'l' })
    expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()
  })

  it('h and l keys are ignored when modifier keys are held', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    const agentBtn = screen.getByRole('button', { name: /^agent\b/i })

    await fireEvent.keyDown(window, { key: 'l', ctrlKey: true })
    expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(window, { key: 'l', metaKey: true })
    expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(window, { key: 'l', altKey: true })
    expect(agentBtn.getAttribute('aria-pressed')).toBe('true')

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('Cmd+2 switches to review mode when worktree exists', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('Cmd+1 switches back to agent mode from review', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
    })

    await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('false')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('Cmd+1/2 work even when an input element is focused', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    const input = document.createElement('input')
    document.body.appendChild(input)

    try {
      input.focus()

      await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^review\b/i }).getAttribute('aria-pressed')).toBe('true')
      })

      await fireEvent.keyDown(window, { key: '1', code: 'Digit1', metaKey: true, shiftKey: false })
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /^agent\b/i }).getAttribute('aria-pressed')).toBe('true')
      })
    } finally {
      document.body.removeChild(input)
      vi.mocked(getTaskWorkspace).mockResolvedValue(null)
    }
  })

  it('Cmd+1/2 are ignored when no worktree exists', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    // No worktree means no view tabs are rendered
    expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()

    await fireEvent.keyDown(window, { key: '2', code: 'Digit2', metaKey: true, shiftKey: false })
    expect(screen.queryByRole('button', { name: /^review\b/i })).toBeNull()
  })

  it('⌘3 ignored when no worktree', async () => {
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    // No worktree means no view tabs are rendered
    expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()

    await fireEvent.keyDown(window, { key: '3', code: 'Digit3', metaKey: true, shiftKey: false })

    expect(screen.queryByRole('button', { name: /^terminal\b/i })).toBeNull()
  })

  it('shows shortcut hints on view toggle buttons when CMD is held', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    commandHeld.set(true)

    await waitFor(() => {
      const agentBtn = screen.getByRole('button', { name: /^agent\b/i }).closest('button')
      const reviewBtn = screen.getByText('review').closest('button')
      const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
      expect(agentBtn?.textContent).toContain('⌘1')
      expect(reviewBtn?.textContent).toContain('⌘2')
      expect(terminalBtn?.textContent).toContain('⌘3')
    })

    commandHeld.set(false)
    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('hides shortcut hints on view toggle buttons when CMD is not held', async () => {
    const { getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/wt', repo_path: '/repo', branch_name: 'b' }))

    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })
    await waitFor(() => {
      expect(screen.getByText('review')).toBeTruthy()
    })

    commandHeld.set(false)

    await waitFor(() => {
      const agentBtn = screen.getByRole('button', { name: /^agent\b/i }).closest('button')
      const reviewBtn = screen.getByText('review').closest('button')
      const terminalBtn = screen.getByRole('button', { name: /^terminal\b/i })
      expect(agentBtn?.textContent).not.toContain('⌘1')
      expect(reviewBtn?.textContent).not.toContain('⌘2')
      expect(terminalBtn?.textContent).not.toContain('⌘3')
    })

    vi.mocked(getTaskWorkspace).mockResolvedValue(null)
  })

  it('Escape triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
    vi.mocked(resetToBoard).mockClear()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await fireEvent.keyDown(window, { key: 'Escape' })

    expect(resetToBoard).toHaveBeenCalled()
  })

  it('does not navigate back before an open modal handles Escape', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
    vi.mocked(resetToBoard).mockClear()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    const modal = document.createElement('div')
    modal.setAttribute('role', 'dialog')
    modal.setAttribute('aria-modal', 'true')
    modal.tabIndex = -1
    modal.addEventListener('keydown', (event) => {
      event.stopPropagation()
    })
    document.body.appendChild(modal)

    try {
      await fireEvent.keyDown(modal, { key: 'Escape' })
      expect(resetToBoard).not.toHaveBeenCalled()
    } finally {
      modal.remove()
    }
  })

  it('q triggers reset to board', async () => {
    const { resetToBoard } = await import('../../lib/router.svelte')
    vi.mocked(resetToBoard).mockClear()
    render(TaskDetailView, { props: { task: baseTask, onRunAction: mockOnRunAction } })

    await fireEvent.keyDown(window, { key: 'q' })

    expect(resetToBoard).toHaveBeenCalled()
  })
})
