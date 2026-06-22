import { cleanup, render, waitFor } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import TerminalTaskPane from './TerminalTaskPane.svelte'

const { terminalTabsApi, ipcMocks, terminalPoolMocks } = vi.hoisted(() => ({
  terminalTabsApi: {
    addTab: vi.fn(),
    closeActiveTab: vi.fn().mockResolvedValue(undefined),
    focusActiveTab: vi.fn(),
    switchToTab: vi.fn(),
  },
  ipcMocks: {
    getTaskWorkspace: vi.fn(),
  },
  terminalPoolMocks: {
    releaseAllForTask: vi.fn().mockReturnValue(0),
  },
}))

vi.mock('./lib/ipc', () => ({
  getTaskWorkspace: ipcMocks.getTaskWorkspace,
}))

vi.mock('./lib/terminalPool', () => ({
  releaseAllForTask: terminalPoolMocks.releaseAllForTask,
}))

vi.mock('./TerminalTabs.svelte', () => ({
  default: vi.fn(() => ({
    update() {},
    destroy() {},
    ...terminalTabsApi,
  })),
}))

function workspace(taskId: string) {
  return {
    id: 1,
    task_id: taskId,
    project_id: 'project-1',
    repo_path: '/repo',
    workspace_path: `/worktrees/${taskId}`,
    kind: 'worktree',
    branch_name: `branch/${taskId}`,
    provider_name: 'opencode',
    status: 'ready',
    created_at: 1,
    updated_at: 2,
  }
}

function resetMocks() {
  terminalTabsApi.addTab.mockClear()
  terminalTabsApi.closeActiveTab.mockClear()
  terminalTabsApi.focusActiveTab.mockClear()
  terminalTabsApi.switchToTab.mockClear()
  terminalPoolMocks.releaseAllForTask.mockClear()
  ipcMocks.getTaskWorkspace.mockReset()
  ipcMocks.getTaskWorkspace.mockImplementation(async (taskId: string) => workspace(taskId))
}

describe('TerminalTaskPane task terminal lifecycle', () => {
  beforeEach(() => {
    resetMocks()
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('releases plugin task shell pool entries when navigating away from a task pane', async () => {
    const { unmount } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(ipcMocks.getTaskWorkspace).toHaveBeenCalledWith('T-1'))

    unmount()
    await tick()

    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledWith('T-1')
  })

  it('releases previous plugin task shell pool entries when switching tasks', async () => {
    const { rerender } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(ipcMocks.getTaskWorkspace).toHaveBeenCalledWith('T-1'))
    expect(terminalPoolMocks.releaseAllForTask).not.toHaveBeenCalled()

    await rerender({ taskId: 'T-2' })
    await waitFor(() => expect(ipcMocks.getTaskWorkspace).toHaveBeenCalledWith('T-2'))

    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(terminalPoolMocks.releaseAllForTask).toHaveBeenCalledWith('T-1')
  })

  it('does not release task shells when the task object refreshes with the same ID', async () => {
    const { rerender } = render(TerminalTaskPane, { props: { taskId: 'T-1' } })

    await waitFor(() => expect(ipcMocks.getTaskWorkspace).toHaveBeenCalledWith('T-1'))

    await rerender({ taskId: 'T-1' })
    await tick()

    expect(terminalPoolMocks.releaseAllForTask).not.toHaveBeenCalled()
  })
})
