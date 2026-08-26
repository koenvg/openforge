import { cleanup, fireEvent, render, screen } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import TerminalTaskPaneSurface from './TerminalTaskPaneSurface.svelte'
import type { TerminalRuntime } from './terminalRuntime'
import type { TerminalSurfaceAdapter } from './terminalSurfaceAdapter'

function createAdapter(): TerminalSurfaceAdapter {
  return {
    runtime: { releaseAllForTask: vi.fn() } as unknown as TerminalRuntime,
    spawnShellPty: vi.fn(async () => 1),
    killPty: vi.fn(async () => undefined),
    getTaskWorkspace: vi.fn(async () => null),
    getWorkspacePath: vi.fn(() => null),
    registerTaskPaneController: vi.fn(),
    unregisterTaskPaneController: vi.fn(),
  }
}

afterEach(() => cleanup())

describe('TerminalTaskPaneSurface', () => {
  it('uses the host adapter to retry an unavailable workspace lookup', async () => {
    const adapter = createAdapter()
    render(TerminalTaskPaneSurface, {
      props: {
        adapter,
        taskId: 'T-1',
        shortcutHintsVisible: false,
      },
    })

    await screen.findAllByText('Terminal workspace unavailable for this task.')
    await fireEvent.click(screen.getByRole('button', { name: 'Retry workspace lookup' }))

    await vi.waitFor(() => expect(adapter.getTaskWorkspace).toHaveBeenCalledTimes(2))
  })
})
