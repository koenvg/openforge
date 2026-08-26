import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalTaskPane from './TerminalTaskPane.svelte'

const { getTaskWorkspaceMock, terminalTabsRenderProps, shortcutCleanupMock, controllerRegistry, terminalPoolMocks } = vi.hoisted(() => ({
  getTaskWorkspaceMock: vi.fn(),
  terminalTabsRenderProps: [] as Array<Record<string, unknown>>,
  shortcutCleanupMock: vi.fn(),
  controllerRegistry: {
    register: vi.fn(),
    unregister: vi.fn(),
  },
  terminalPoolMocks: {
    releaseAllForTask: vi.fn().mockReturnValue(0),
  },
}))

vi.mock('./lib/ipc', () => ({
  spawnShellPty: vi.fn().mockResolvedValue(1),
  killPty: vi.fn().mockResolvedValue(undefined),
  getTaskWorkspace: getTaskWorkspaceMock,
}))

vi.mock('./lib/terminalPool', () => ({
  releaseAllForTask: terminalPoolMocks.releaseAllForTask,
}))

vi.mock('./terminalShortcutController', () => ({
  createTerminalShortcutController: vi.fn(() => ({
    controller: {
      addTab: vi.fn(),
      closeActiveTab: vi.fn().mockResolvedValue(undefined),
      focusActiveTab: vi.fn(),
      switchToTab: vi.fn(),
    },
    terminalTabsRef: null,
    registerWindowKeydown: vi.fn(() => shortcutCleanupMock),
  })),
}))

vi.mock('./terminalTaskPaneController', () => ({
  registerTerminalTaskPaneController: controllerRegistry.register,
  unregisterTerminalTaskPaneController: controllerRegistry.unregister,
}))

vi.mock('./TerminalTabs.svelte', () => ({
  default: vi.fn((_node: Element, props: Record<string, unknown>) => {
    terminalTabsRenderProps.push(props)
    return {
      update(nextProps: Record<string, unknown>) {
        terminalTabsRenderProps.push(nextProps)
      },
      destroy() {},
      addTab: vi.fn(),
      closeActiveTab: vi.fn().mockResolvedValue(undefined),
      focusActiveTab: vi.fn(),
      switchToTab: vi.fn(),
    }
  }),
}))

function makeWorkspace(taskId: string, workspacePath = `/worktrees/${taskId}`) {
  return {
    id: 1,
    task_id: taskId,
    project_id: 'P-1',
    workspace_path: workspacePath,
    repo_path: '/repo',
    kind: 'worktree',
    branch_name: 'feature/task',
    provider_name: 'pi',
    status: 'ready',
    created_at: 1,
    updated_at: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

async function flushAsync() {
  await Promise.resolve()
  await tick()
}

beforeEach(() => {
  getTaskWorkspaceMock.mockReset()
  getTaskWorkspaceMock.mockImplementation(async (taskId: string) => makeWorkspace(taskId))
  terminalTabsRenderProps.length = 0
  shortcutCleanupMock.mockClear()
  controllerRegistry.register.mockClear()
  controllerRegistry.unregister.mockClear()
  terminalPoolMocks.releaseAllForTask.mockClear()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TerminalTaskPane task terminal lifecycle', () => {
  it('releases plugin task shell pool entries when navigating away from a task pane', async () => {
    const { unmount } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-1'))

    unmount()
    await tick()

    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledWith('T-1')
  })

  it('releases previous plugin task shell pool entries when switching tasks', async () => {
    const { rerender } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-1'))
    expect(terminalPoolMocks.releaseAllForTask).not.toHaveBeenCalled()

    await rerender({ taskId: 'T-2' })
    await waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-2'))

    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledWith('T-1')
  })

  it('does not release task shells when the task object refreshes with the same ID', async () => {
    const { rerender } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-1'))

    await rerender({ taskId: 'T-1' })
    await tick()

    expect(terminalPoolMocks.releaseAllForTask).not.toHaveBeenCalled()
  })
})

describe('terminal plugin TerminalTaskPane workspace resolution', () => {
  it('shows an unavailable state, focus path, and retry when workspace lookup resolves null', async () => {
    getTaskWorkspaceMock
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(makeWorkspace('T-1', '/repo/.worktrees/T-1'))

    render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    expect(screen.getAllByRole('status')[0]?.textContent).toBe('Loading terminal workspace…')

    await screen.findAllByText('Terminal workspace unavailable for this task.')
    expect(screen.getByText('Start or repair the task workspace, then retry loading the terminal.')).toBeTruthy()
    expect(screen.getByText(/Keyboard focus path:/)).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry workspace lookup' }))

    await vi.waitFor(() => expect(screen.getAllByRole('status')[0]?.textContent).toBe('Terminal workspace ready.'))
    expect(getTaskWorkspaceMock).toHaveBeenCalledTimes(2)
    expect(terminalTabsRenderProps.at(-1)).toMatchObject({ taskId: 'T-1', workspacePath: '/repo/.worktrees/T-1' })
  })

  it('shows an error state, announces the error, and retries when workspace lookup rejects', async () => {
    getTaskWorkspaceMock
      .mockRejectedValueOnce(new Error('workspace bridge offline'))
      .mockResolvedValueOnce(makeWorkspace('T-1', '/repo/.worktrees/T-1'))

    render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await screen.findAllByText('Terminal workspace lookup failed.')
    expect(screen.getByText('workspace bridge offline')).toBeTruthy()
    expect(screen.getByText(/Terminal workspace error/)).toBeTruthy()
    expect(screen.getByText(/Keyboard focus path:/)).toBeTruthy()

    await fireEvent.click(screen.getByRole('button', { name: 'Retry workspace lookup' }))

    await vi.waitFor(() => expect(screen.getAllByRole('status')[0]?.textContent).toBe('Terminal workspace ready.'))
    expect(terminalTabsRenderProps.at(-1)).toMatchObject({ taskId: 'T-1', workspacePath: '/repo/.worktrees/T-1' })
  })

  it('ignores out-of-order workspace lookup results after rapid task switching', async () => {
    const firstLookup = deferred<ReturnType<typeof makeWorkspace> | null>()
    const secondLookup = deferred<ReturnType<typeof makeWorkspace> | null>()
    getTaskWorkspaceMock
      .mockReturnValueOnce(firstLookup.promise)
      .mockReturnValueOnce(secondLookup.promise)

    const { rerender } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-1'))

    await rerender({ taskId: 'T-2' })
    await vi.waitFor(() => expect(getTaskWorkspaceMock).toHaveBeenCalledWith('T-2'))

    secondLookup.resolve(makeWorkspace('T-2', '/repo/.worktrees/T-2'))
    await vi.waitFor(() => {
      expect(terminalTabsRenderProps.at(-1)).toMatchObject({ taskId: 'T-2', workspacePath: '/repo/.worktrees/T-2' })
    })

    firstLookup.resolve(makeWorkspace('T-1', '/repo/.worktrees/T-1'))
    await flushAsync()

    expect(terminalTabsRenderProps.some((props) => props.taskId === 'T-1')).toBe(false)
    expect(terminalTabsRenderProps.at(-1)).toMatchObject({ taskId: 'T-2', workspacePath: '/repo/.worktrees/T-2' })
  })
})
