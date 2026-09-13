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
  it('announces a pending workspace lookup once, with a decorative indicator', () => {
    const adapter = createAdapter()
    adapter.getTaskWorkspace = () => new Promise(() => {})
    const { container } = render(TerminalTaskPaneSurface, {
      props: { adapter, taskId: 'T-loading', shortcutHintsVisible: false },
    })

    const statuses = screen.getAllByRole('status')
    expect(statuses).toHaveLength(1)
    expect(statuses[0].textContent).toContain('Loading')
    const indicator = container.querySelector('span[aria-hidden="true"]')
    expect(indicator).not.toBeNull()
    expect(indicator?.getAttribute('role')).toBeNull()
  })

  it.each(['unavailable', 'error'] as const)('announces loading-to-%s once and preserves recovery controls', async (outcome) => {
    const adapter = createAdapter()
    let resolveLookup!: (value: null) => void
    let rejectLookup!: (error: Error) => void
    adapter.getTaskWorkspace = vi.fn(() => new Promise<null>((resolve, reject) => {
      resolveLookup = resolve
      rejectLookup = reject
    }))
    const { container } = render(TerminalTaskPaneSurface, {
      props: { adapter, taskId: 'T-transition', shortcutHintsVisible: false },
    })
    const announcement = screen.getByRole('status')
    expect(announcement.textContent).toBe('Loading terminal workspace…')
    if (outcome === 'error') rejectLookup(new Error('Workspace service offline'))
    else resolveLookup(null)

    const message = outcome === 'error'
      ? 'Terminal workspace lookup failed.'
      : 'Terminal workspace unavailable for this task.'
    await vi.waitFor(() => expect(announcement.textContent).toBe(message))
    expect(screen.getAllByRole('status')).toEqual([announcement])
    expect(container.querySelectorAll('[aria-live]:not([aria-live="off"]), [role="status"], [role="alert"]')).toHaveLength(1)
    expect(screen.getAllByText(message).some((node) => node !== announcement)).toBe(true)
    expect(screen.getByText(/Keyboard focus path:/)).toBeTruthy()
    if (outcome === 'error') expect(screen.getByText('Workspace service offline')).toBeTruthy()

    const retry = screen.getByRole('button', { name: 'Retry workspace lookup' })
    retry.focus()
    expect(document.activeElement).toBe(retry)
    await fireEvent.click(retry)
    await vi.waitFor(() => expect(announcement.textContent).toBe('Loading terminal workspace…'))
    expect(adapter.getTaskWorkspace).toHaveBeenCalledTimes(2)
    expect(screen.getAllByRole('status')).toEqual([announcement])
  })

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
