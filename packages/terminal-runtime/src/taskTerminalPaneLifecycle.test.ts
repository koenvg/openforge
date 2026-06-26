import { describe, expect, it, vi } from 'vitest'
import { createTaskTerminalPaneLifecycle, type TerminalTaskPaneController } from './taskTerminalPaneLifecycle'

interface WorkspaceInfo {
  workspace_path: string | null
}

function createController(): TerminalTaskPaneController {
  return {
    addTab() {},
    async closeActiveTab() {},
    focusActiveTab() {},
    switchToTab() {},
  }
}

function createDeferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

describe('createTaskTerminalPaneLifecycle', () => {
  it('registers the current task and releases only the previous task when switching', async () => {
    const controller = createController()
    const registerController = vi.fn()
    const unregisterController = vi.fn()
    const releaseAllForTask = vi.fn()
    const setWorkspacePath = vi.fn()
    const getTaskWorkspace = vi.fn(async (taskId: string) => ({ workspace_path: `/worktrees/${taskId}` }))

    const lifecycle = createTaskTerminalPaneLifecycle<WorkspaceInfo>({
      controller,
      getTaskWorkspace,
      getWorkspacePath: (workspace) => workspace?.workspace_path ?? null,
      registerController,
      unregisterController,
      releaseAllForTask,
      setWorkspacePath,
    })

    lifecycle.syncTask('T-1')
    await Promise.resolve()

    expect(registerController).toHaveBeenCalledWith('T-1', controller)
    expect(setWorkspacePath).toHaveBeenCalledWith(null)
    expect(setWorkspacePath).toHaveBeenCalledWith('/worktrees/T-1')
    expect(releaseAllForTask).not.toHaveBeenCalled()

    lifecycle.syncTask('T-2')
    await Promise.resolve()

    expect(unregisterController).toHaveBeenCalledWith('T-1', controller)
    expect(releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(releaseAllForTask).toHaveBeenCalledWith('T-1')
    expect(registerController).toHaveBeenCalledWith('T-2', controller)
    expect(setWorkspacePath).toHaveBeenCalledWith('/worktrees/T-2')
  })

  it('ignores stale workspace lookups after switching tasks', async () => {
    const firstLookup = createDeferred<WorkspaceInfo>()
    const getTaskWorkspace = vi.fn((taskId: string) => {
      if (taskId === 'T-1') return firstLookup.promise
      return Promise.resolve({ workspace_path: '/worktrees/T-2' })
    })
    const setWorkspacePath = vi.fn()

    const lifecycle = createTaskTerminalPaneLifecycle<WorkspaceInfo>({
      controller: createController(),
      getTaskWorkspace,
      getWorkspacePath: (workspace) => workspace?.workspace_path ?? null,
      registerController: vi.fn(),
      unregisterController: vi.fn(),
      releaseAllForTask: vi.fn(),
      setWorkspacePath,
    })

    lifecycle.syncTask('T-1')
    lifecycle.syncTask('T-2')
    await Promise.resolve()

    firstLookup.resolve({ workspace_path: '/worktrees/T-1' })
    await Promise.resolve()

    expect(setWorkspacePath).toHaveBeenCalledWith('/worktrees/T-2')
    expect(setWorkspacePath).not.toHaveBeenCalledWith('/worktrees/T-1')
  })

  it('supports task-detail usage without a task pane controller while preserving initial workspace state', async () => {
    const releaseAllForTask = vi.fn()
    const setWorkspacePath = vi.fn()
    const onWorkspaceResolved = vi.fn()

    const lifecycle = createTaskTerminalPaneLifecycle<WorkspaceInfo>({
      getInitialWorkspacePath: () => '/runtime/T-1',
      getTaskWorkspace: vi.fn(async () => ({ workspace_path: '/worktrees/T-1' })),
      getWorkspacePath: (workspace) => workspace?.workspace_path ?? null,
      releaseAllForTask,
      setWorkspacePath,
      onWorkspaceResolved,
    })

    lifecycle.syncTask('T-1')
    await Promise.resolve()
    lifecycle.destroy()

    expect(setWorkspacePath).toHaveBeenCalledWith('/runtime/T-1')
    expect(setWorkspacePath).toHaveBeenCalledWith('/worktrees/T-1')
    expect(onWorkspaceResolved).toHaveBeenCalledWith('T-1', '/worktrees/T-1')
    expect(releaseAllForTask).toHaveBeenCalledWith('T-1')
  })

  it('unregisters and releases the current task once on destroy while ignoring later lookup results', async () => {
    const lookup = createDeferred<WorkspaceInfo>()
    const unregisterController = vi.fn()
    const releaseAllForTask = vi.fn()
    const setWorkspacePath = vi.fn()
    const controller = createController()

    const lifecycle = createTaskTerminalPaneLifecycle<WorkspaceInfo>({
      controller,
      getTaskWorkspace: vi.fn(() => lookup.promise),
      getWorkspacePath: (workspace) => workspace?.workspace_path ?? null,
      registerController: vi.fn(),
      unregisterController,
      releaseAllForTask,
      setWorkspacePath,
    })

    lifecycle.syncTask('T-1')
    lifecycle.destroy()
    lifecycle.destroy()

    lookup.resolve({ workspace_path: '/worktrees/T-1' })
    await Promise.resolve()

    expect(unregisterController).toHaveBeenCalledTimes(1)
    expect(unregisterController).toHaveBeenCalledWith('T-1', controller)
    expect(releaseAllForTask).toHaveBeenCalledTimes(1)
    expect(releaseAllForTask).toHaveBeenCalledWith('T-1')
    expect(setWorkspacePath).not.toHaveBeenCalledWith('/worktrees/T-1')
  })
})
