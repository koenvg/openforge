import { fireEvent, render, screen } from '@testing-library/svelte'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { installAppTestLifecycle } from './App.test-harness'
import {
  closeRequestedHandler,
  mockWindowDestroy,
  mockWindowOnCloseRequested,
} from './App.test-fixtures/desktop-lifecycle'

describe('App window-close behavior', () => {
  installAppTestLifecycle()

  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Make the close-confirm path fire by reporting a running agent from the
  // per-project attention query the close handler refreshes before deciding.
  async function mockRunningAgentAttention() {
    const ipc = await import('./lib/ipc')
    vi.mocked(ipc.getProjectAttention).mockResolvedValue([
      { project_id: 'proj-1', needs_input: 0, running_agents: 1, ci_failures: 0, unaddressed_comments: 0, completed_agents: 0 },
    ])
  }

  // No running or waiting agents anywhere. Quitting is safe, so no dialog.
  async function mockIdleAttention() {
    const ipc = await import('./lib/ipc')
    vi.mocked(ipc.getProjectAttention).mockResolvedValue([])
  }

  it('prevents window close requests and shows a confirmation modal when an agent is running', async () => {
    await mockRunningAgentAttention()
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(mockWindowOnCloseRequested).toHaveBeenCalled()
    })

    const preventDefault = vi.fn()
    if (!closeRequestedHandler) {
      throw new Error('Expected close request handler to be registered')
    }

    await closeRequestedHandler({ preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: 'Agents still running' })).toBeTruthy()
    expect(screen.getByText('Agents still running')).toBeTruthy()
    expect(mockWindowDestroy).not.toHaveBeenCalled()
  })

  it('quits immediately without a confirmation when no agents are active', async () => {
    await mockIdleAttention()
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(mockWindowOnCloseRequested).toHaveBeenCalled()
    })

    const preventDefault = vi.fn()
    if (!closeRequestedHandler) {
      throw new Error('Expected close request handler to be registered')
    }

    await closeRequestedHandler({ preventDefault })

    expect(preventDefault).toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mockWindowDestroy).toHaveBeenCalledTimes(1)
  })

  it('focuses the Quit button when the close confirmation opens', async () => {
    await mockRunningAgentAttention()
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(mockWindowOnCloseRequested).toHaveBeenCalled()
    })

    if (!closeRequestedHandler) {
      throw new Error('Expected close request handler to be registered')
    }

    await closeRequestedHandler({ preventDefault: vi.fn() })

    const quitButton = screen.getByRole('button', { name: 'Quit' })
    await vi.waitFor(() => {
      expect(document.activeElement).toBe(quitButton)
    })
  })

  it('destroys the window after the user confirms close', async () => {
    await mockRunningAgentAttention()
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(mockWindowOnCloseRequested).toHaveBeenCalled()
    })

    if (!closeRequestedHandler) {
      throw new Error('Expected close request handler to be registered')
    }

    await closeRequestedHandler({ preventDefault: vi.fn() })
    await fireEvent.click(screen.getByRole('button', { name: 'Quit' }))

    expect(mockWindowDestroy).toHaveBeenCalledTimes(1)
  })

  it('keeps the app open when the user cancels close', async () => {
    await mockRunningAgentAttention()
    const App = (await import('./App.svelte')).default

    render(App)

    await vi.waitFor(() => {
      expect(mockWindowOnCloseRequested).toHaveBeenCalled()
    })

    if (!closeRequestedHandler) {
      throw new Error('Expected close request handler to be registered')
    }

    await closeRequestedHandler({ preventDefault: vi.fn() })
    await fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByText('Agents still running')).toBeNull()
    expect(mockWindowDestroy).not.toHaveBeenCalled()
  })
})
