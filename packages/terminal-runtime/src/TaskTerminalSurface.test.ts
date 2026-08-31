import { cleanup, render, screen } from '@testing-library/svelte'
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
