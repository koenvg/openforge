import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { tick } from 'svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TaskTerminalSurface from './TaskTerminalSurface.svelte'
import type { ShellLifecycleState, TerminalRuntime } from './terminalRuntime'
import { createTerminalSessionHandle } from './terminalRuntimeTypes'
import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'

const readyLifecycle: ShellLifecycleState = {
  ptyActive: true,
  shellExited: false,
  currentPtyInstance: 12,
  hasOutput: false,
}

function createAdapter(): TerminalSurfaceAdapter {
  const session = createTerminalSessionHandle('T-1-shell-0')
  const runtime = {
    acquire: vi.fn(async () => session),
    attach: vi.fn(async () => ({
      generation: 1,
      refit: vi.fn(async () => ({ cols: 80, rows: 24 })),
      detach: vi.fn(),
    })),
    beginPtySpawn: vi.fn(() => null),
    release: vi.fn(),
    resetPresentation: vi.fn(async () => undefined),
    getShellLifecycleState: vi.fn(() => readyLifecycle),
    subscribeShellLifecycle: vi.fn(() => () => undefined),
  } as unknown as TerminalRuntime

  return {
    runtime,
    spawnShellPty: vi.fn(async () => 12),
    killPty: vi.fn(async () => undefined),
    getTaskWorkspace: vi.fn(async () => null),
    getWorkspacePath: vi.fn(() => null),
    registerTaskPaneController: vi.fn(),
    unregisterTaskPaneController: vi.fn(),
  }
}

afterEach(() => cleanup())

describe('TaskTerminalSurface', () => {
  it('keeps terminal output and offers retry after a delayed termination fails', async () => {
    const adapter = createAdapter()
    vi.mocked(adapter.runtime.getShellLifecycleState).mockReturnValue({
      ...readyLifecycle, ptyActive: false, shellExited: true, hasOutput: true,
    })
    let rejectTermination!: (error: Error) => void
    vi.mocked(adapter.killPty).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      rejectTermination = reject
    }))
    vi.mocked(adapter.runtime.attach).mockImplementation(async (_session, host) => {
      host.textContent = 'Existing terminal output'
      return { generation: 1, refit: vi.fn(async () => ({ cols: 80, rows: 24 })), detach: vi.fn() }
    })
    render(TaskTerminalSurface, { props: {
      adapter, taskId: 'T-1', workspacePath: '/worktrees/T-1',
      terminalKey: 'T-1-shell-0', terminalIndex: 0, isActive: true,
    } })
    await vi.waitFor(() => expect(screen.getByText('Existing terminal output')).toBeTruthy())
    const restart = screen.getByRole('button', { name: /restart/i }) as HTMLButtonElement

    await fireEvent.click(restart)
    expect(restart.disabled).toBe(true)
    expect(screen.getByText('Existing terminal output')).toBeTruthy()
    expect(adapter.runtime.resetPresentation).not.toHaveBeenCalled()

    rejectTermination(new Error('daemon unavailable'))
    await vi.waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Retry restarting the shell'))
    expect(screen.getByRole('alert').textContent).toContain('daemon unavailable')
    expect(restart.disabled).toBe(false)
    expect(screen.getByText('Existing terminal output')).toBeTruthy()
    expect(adapter.runtime.resetPresentation).not.toHaveBeenCalled()
    expect(adapter.spawnShellPty).not.toHaveBeenCalled()

    await fireEvent.click(restart)
    await vi.waitFor(() => expect(adapter.runtime.resetPresentation).toHaveBeenCalledOnce())
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the shell-ready affordance only when the host opts in', async () => {
    const props = {
      adapter: createAdapter(),
      taskId: 'T-1',
      workspacePath: '/worktrees/T-1',
      terminalKey: 'T-1-shell-0',
      terminalIndex: 0,
      isActive: true,
      showShellReadyAffordance: true,
    }
    const { rerender } = render(TaskTerminalSurface, { props })

    await vi.waitFor(() => expect(screen.getByText('Shell ready')).toBeTruthy())

    await rerender({ ...props, showShellReadyAffordance: false })
    await tick()

    expect(screen.queryByText('Shell ready')).toBeNull()
  })
})
