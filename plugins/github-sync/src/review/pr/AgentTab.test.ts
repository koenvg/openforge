import { cleanup, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScopedAgentSessionState, SessionScope } from '@openforge-app/plugin-sdk'
import AgentTab from './AgentTab.svelte'

const scope: SessionScope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#42',
  revision: 'head-a',
}

function running(): ScopedAgentSessionState {
  return {
    id: 'sas-1', turnId: null, status: 'running', queuePosition: null, queueReason: null,
    acceptsInput: true, workspaceAvailable: true, errorCode: null, errorMessage: null,
    createdAt: 1, updatedAt: 1,
  }
}

function props(overrides: Record<string, unknown> = {}) {
  return {
    scope,
    projectResolved: true,
    projectId: 'P-1',
    status: running(),
    isLoading: false,
    error: null,
    availabilityError: null,
    mountTerminal: vi.fn(async () => ({ dispose: vi.fn() })),
    onTerminalReadyChange: vi.fn(),
    ...overrides,
  }
}

describe('AgentTab', () => {
  afterEach(cleanup)

  it('renders one full-height terminal frame without duplicate agent controls', async () => {
    const componentProps = props()
    render(AgentTab, { props: componentProps })

    const frame = screen.getByTestId('review-agent-terminal-frame')
    expect(frame.className).toContain('agent-terminal-surface')
    expect(screen.getByTestId('review-agent-terminal')).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.queryByText('Review agent')).toBeNull()
    expect(screen.queryByText(/Stop generation|Stop review agent|Generate again|Send/i)).toBeNull()
    await waitFor(() => expect(componentProps.mountTerminal).toHaveBeenCalledWith(scope, expect.any(HTMLElement)))
    await waitFor(() => expect(componentProps.onTerminalReadyChange).toHaveBeenLastCalledWith(true))
  })

  it('keeps passive startup and unavailable states inside the terminal frame', async () => {
    const view = render(AgentTab, { props: props({ status: null, isLoading: true }) })
    expect(screen.getByTestId('review-agent-terminal-frame').textContent).toContain('Starting review agent')

    await view.rerender(props({ status: null, projectId: null, isLoading: false }))
    expect(screen.getByTestId('review-agent-terminal-frame').textContent).toContain('local OpenForge Project')
  })

  it('keeps one attachment per logical scope and disposes only the current attachment on destroy', async () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const mountTerminal = vi.fn()
      .mockResolvedValueOnce({ dispose: firstDispose })
      .mockResolvedValueOnce({ dispose: secondDispose })
    const baseProps = props({ mountTerminal })
    const view = render(AgentTab, { props: baseProps })
    await waitFor(() => expect(mountTerminal).toHaveBeenCalledTimes(1))

    await view.rerender({ ...baseProps, scope: { ...scope } })
    expect(mountTerminal).toHaveBeenCalledTimes(1)

    const replacementScope = { ...scope, revision: 'head-b' }
    await view.rerender({ ...baseProps, scope: replacementScope })
    await waitFor(() => {
      expect(baseProps.onTerminalReadyChange).toHaveBeenCalledWith(false)
      expect(firstDispose).toHaveBeenCalledOnce()
      expect(mountTerminal).toHaveBeenLastCalledWith(replacementScope, expect.any(HTMLElement))
      expect(baseProps.onTerminalReadyChange).toHaveBeenLastCalledWith(true)
    })

    view.unmount()
    await waitFor(() => {
      expect(baseProps.onTerminalReadyChange).toHaveBeenLastCalledWith(false)
      expect(secondDispose).toHaveBeenCalledOnce()
    })
  })

  it('disposes a delayed stale mount without detaching its replacement', async () => {
    let resolveFirst!: (value: { dispose: () => void }) => void
    const staleDispose = vi.fn()
    const currentDispose = vi.fn()
    const mountTerminal = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ dispose: currentDispose })
    const baseProps = props({ mountTerminal })
    const view = render(AgentTab, { props: baseProps })
    await waitFor(() => expect(mountTerminal).toHaveBeenCalledTimes(1))

    await view.rerender({ ...baseProps, scope: { ...scope, revision: 'head-b' } })
    resolveFirst({ dispose: staleDispose })

    await waitFor(() => {
      expect(staleDispose).toHaveBeenCalledOnce()
      expect(mountTerminal).toHaveBeenCalledTimes(2)
    })
    expect(currentDispose).not.toHaveBeenCalled()
    view.unmount()
    await waitFor(() => expect(currentDispose).toHaveBeenCalledOnce())
  })

  it('reports not ready when attachment fails or the current status detaches', async () => {
    const failed = props({ mountTerminal: vi.fn(async () => { throw new Error('mount failed') }) })
    const failedView = render(AgentTab, { props: failed })
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('mount failed'))
    expect(failed.onTerminalReadyChange).toHaveBeenLastCalledWith(false)
    failedView.unmount()

    const attached = props()
    const attachedView = render(AgentTab, { props: attached })
    await waitFor(() => expect(attached.onTerminalReadyChange).toHaveBeenLastCalledWith(true))
    await attachedView.rerender({ ...attached, status: null })
    await waitFor(() => expect(attached.onTerminalReadyChange).toHaveBeenLastCalledWith(false))
  })
})
