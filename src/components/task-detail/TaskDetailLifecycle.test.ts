import { render, waitFor } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  baseTask,
  createTaskWorkspaceInfo,
  resetTaskDetailViewTestState,
} from './TaskDetailView.testUtils'

describe('TaskDetailLifecycle', () => {
  beforeEach(resetTaskDetailViewTestState)

  it('publishes resolved workspace and run-app state through lifecycle callbacks', async () => {
    const { getProjectConfig, getTaskWorkspace } = await import('../../lib/ipc')
    vi.mocked(getTaskWorkspace).mockResolvedValue(createTaskWorkspaceInfo({ workspace_path: '/tmp/worktree' }))
    vi.mocked(getProjectConfig).mockResolvedValue('pnpm dev')
    const TaskDetailLifecycle = (await import('./TaskDetailLifecycle.svelte')).default
    const onWorkspacePathChange = vi.fn()
    const onRunAppStateChange = vi.fn()
    const onRunAppRegistrationChange = vi.fn()

    const rendered = render(TaskDetailLifecycle, {
      props: {
        taskId: baseTask.id,
        projectId: 'project-1',
        runtimeWorkspacePath: null,
        terminalViewId: 'com.openforge.terminal:terminal',
        onWorkspacePathChange,
        onWorkspaceResolved: vi.fn(),
        onRunAppStateChange,
        onRunAppRegistrationChange,
        onOpenTerminalView: vi.fn(),
      },
    })

    await waitFor(() => {
      expect(onWorkspacePathChange).toHaveBeenCalledWith('/tmp/worktree')
      expect(onRunAppStateChange).toHaveBeenCalledWith(expect.objectContaining({
        available: true,
        command: 'pnpm dev',
      }))
      expect(onRunAppRegistrationChange).toHaveBeenCalledWith(expect.objectContaining({
        taskId: baseTask.id,
        available: true,
      }))
    })

    rendered.unmount()
    expect(onRunAppRegistrationChange).toHaveBeenLastCalledWith(null)
  })
})
