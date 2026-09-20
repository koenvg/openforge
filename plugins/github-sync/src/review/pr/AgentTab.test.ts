import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ScopedAgentSessionState, SessionScope } from '@openforge-app/plugin-sdk'
import AgentTab from './AgentTab.svelte'

const scope: SessionScope = {
  namespace: 'github',
  targetKey: 'gh:acme/web#42',
  revision: 'head-a',
}

function sessionState(
  status: ScopedAgentSessionState['status'],
  overrides: Partial<ScopedAgentSessionState> = {},
): ScopedAgentSessionState {
  return {
    id: 'sas-1',
    turnId: 'turn-1',
    status,
    queuePosition: null,
    queueReason: null,
    acceptsInput: status === 'running' || status === 'paused' || status === 'completed',
    workspaceAvailable: status !== 'queued' && status !== 'starting',
    errorCode: null,
    errorMessage: null,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function renderAgentTab(overrides: {
  projectResolved?: boolean
  projectId?: string | null
  status?: ScopedAgentSessionState | null
  walkthroughStatus?: 'generating' | 'ready' | 'no-submissions' | 'failed' | 'aborted' | null
  acceptedStepCount?: number
  availabilityError?: string | null
  error?: string | null
} = {}) {
  const onStart = vi.fn(async () => undefined)
  const onAbort = vi.fn(async () => undefined)
  const onRestart = vi.fn(async () => undefined)
  const onSendInput = vi.fn(async () => undefined)
  const onRetryAvailability = vi.fn(async () => undefined)
  const mountTerminal = vi.fn(async () => ({ dispose: vi.fn() }))

  render(AgentTab, {
    props: {
      scope,
      projectResolved: overrides.projectResolved ?? true,
      projectId: overrides.projectId === undefined ? 'P-1' : overrides.projectId,
      status: overrides.status ?? null,
      isLoading: false,
      actionPending: false,
      error: overrides.error ?? null,
      availabilityError: overrides.availabilityError ?? null,
      walkthroughStatus: overrides.walkthroughStatus ?? null,
      acceptedStepCount: overrides.acceptedStepCount ?? 0,
      mountTerminal,
      onStart,
      onAbort,
      onRestart,
      onSendInput,
      onRetryAvailability,
    },
  })

  return { mountTerminal, onAbort, onRestart, onRetryAvailability, onSendInput, onStart }
}

describe('AgentTab', () => {
  afterEach(cleanup)

  it('offers to generate a walkthrough when no session exists', async () => {
    const { onStart, mountTerminal } = renderAgentTab()

    expect(screen.getByText('No walkthrough session yet.')).toBeTruthy()
    expect(screen.getByText(/read-only checkout/i)).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Generate walkthrough' }))

    expect(onStart).toHaveBeenCalledOnce()
    expect(mountTerminal).not.toHaveBeenCalled()
  })

  it('stays present and explains why a repository without a local Project cannot start', () => {
    const { onStart } = renderAgentTab({ projectId: null })

    expect(screen.getByText('Review agent unavailable')).toBeTruthy()
    expect(screen.getByText(/local OpenForge Project linked to this repository is required/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Generate walkthrough' })).toHaveProperty('disabled', true)
    expect(onStart).not.toHaveBeenCalled()
  })

  it('offers to retry when the session status check fails', async () => {
    const { onRetryAvailability, onStart } = renderAgentTab({
      availabilityError: 'The review agent did not respond. Try again.',
    })

    expect(screen.getByRole('alert').textContent).toContain('The review agent did not respond')
    expect(screen.queryByRole('button', { name: 'Generate walkthrough' })).toBeNull()
    await fireEvent.click(screen.getByRole('button', { name: 'Try again' }))

    expect(onRetryAvailability).toHaveBeenCalledOnce()
    expect(onStart).not.toHaveBeenCalled()
  })

  it.each([
    ['queued', sessionState('queued', { queuePosition: 2, queueReason: 'Waiting for capacity' }), /Queue position 2/i],
    ['starting', sessionState('starting'), /Preparing the read-only checkout/i],
    ['running', sessionState('running'), /review agent is working/i],
    ['awaiting-input', sessionState('paused'), /^The review agent is awaiting input\.$/i],
    ['completed', sessionState('completed'), /completed this turn/i],
    ['failed', sessionState('failed', { errorMessage: 'Provider exited unexpectedly' }), /Provider exited unexpectedly/i],
    ['aborted', sessionState('aborted'), /output remains available/i],
  ])('renders the %s state with retained terminal output', async (_name, status, message) => {
    const { mountTerminal } = renderAgentTab({ status })

    expect(screen.getByText(message)).toBeTruthy()
    expect(screen.getByTestId('review-agent-terminal')).toBeTruthy()
    await waitFor(() => expect(mountTerminal).toHaveBeenCalledWith(scope, expect.any(HTMLElement)))
  })

  it('explains a completed attempt with no accepted steps and offers a retry', async () => {
    const { onRestart } = renderAgentTab({
      status: sessionState('completed'),
      walkthroughStatus: 'no-submissions',
    })

    expect(screen.getByText('The agent finished without submitting a walkthrough. Ask it to try again and submit each step through the OpenForge CLI.')).toBeTruthy()
    await fireEvent.click(screen.getByRole('button', { name: 'Generate again' }))
    expect(onRestart).toHaveBeenCalledOnce()
  })

  it('sends follow-up input from a completed session and clears it only after success', async () => {
    const { onSendInput } = renderAgentTab({ status: sessionState('completed') })
    const input = screen.getByRole('textbox', { name: 'Message the review agent' })

    await fireEvent.input(input, { target: { value: 'Explain the retry path' } })
    await fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => expect(onSendInput).toHaveBeenCalledWith('Explain the retry path'))
    expect(input).toHaveProperty('value', '')
  })

  it('keeps one attachment per logical scope and disposes only the current attachment on destroy', async () => {
    const firstDispose = vi.fn()
    const secondDispose = vi.fn()
    const mountTerminal = vi.fn()
      .mockResolvedValueOnce({ dispose: firstDispose })
      .mockResolvedValueOnce({ dispose: secondDispose })
    const onAbort = vi.fn(async () => undefined)
    const baseProps = {
      scope,
      projectResolved: true,
      projectId: 'P-1',
      status: sessionState('running'),
      isLoading: false,
      actionPending: false,
      error: null,
      availabilityError: null,
      mountTerminal,
      onStart: vi.fn(async () => undefined),
      onAbort,
      onRestart: vi.fn(async () => undefined),
      onSendInput: vi.fn(async () => undefined),
      onRetryAvailability: vi.fn(async () => undefined),
    }
    const view = render(AgentTab, { props: baseProps })
    await waitFor(() => expect(mountTerminal).toHaveBeenCalledTimes(1))

    await view.rerender({ ...baseProps, scope: { ...scope } })
    expect(mountTerminal).toHaveBeenCalledTimes(1)

    const replacementScope = { ...scope, revision: 'head-b' }
    await view.rerender({ ...baseProps, scope: replacementScope })
    await waitFor(() => {
      expect(firstDispose).toHaveBeenCalledOnce()
      expect(mountTerminal).toHaveBeenLastCalledWith(replacementScope, expect.any(HTMLElement))
    })

    view.unmount()
    await waitFor(() => expect(secondDispose).toHaveBeenCalledOnce())
    expect(onAbort).not.toHaveBeenCalled()
  })

  it('disposes a delayed stale mount without detaching its replacement', async () => {
    let resolveFirst!: (value: { dispose: () => void }) => void
    const staleDispose = vi.fn()
    const currentDispose = vi.fn()
    const mountTerminal = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { resolveFirst = resolve }))
      .mockResolvedValueOnce({ dispose: currentDispose })
    const baseProps = {
      scope,
      projectResolved: true,
      projectId: 'P-1',
      status: sessionState('running'),
      isLoading: false,
      actionPending: false,
      error: null,
      availabilityError: null,
      mountTerminal,
      onStart: vi.fn(async () => undefined),
      onAbort: vi.fn(async () => undefined),
      onRestart: vi.fn(async () => undefined),
      onSendInput: vi.fn(async () => undefined),
      onRetryAvailability: vi.fn(async () => undefined),
    }
    const view = render(AgentTab, { props: baseProps })
    await waitFor(() => expect(mountTerminal).toHaveBeenCalledTimes(1))

    const replacementScope = { ...scope, revision: 'head-b' }
    await view.rerender({ ...baseProps, scope: replacementScope })
    resolveFirst({ dispose: staleDispose })

    await waitFor(() => {
      expect(staleDispose).toHaveBeenCalledOnce()
      expect(mountTerminal).toHaveBeenCalledTimes(2)
    })
    expect(currentDispose).not.toHaveBeenCalled()

    view.unmount()
    await waitFor(() => expect(currentDispose).toHaveBeenCalledOnce())
  })

  it('retries a transient terminal mount failure when the session state changes', async () => {
    const dispose = vi.fn()
    const mountTerminal = vi.fn()
      .mockRejectedValueOnce(new Error('Terminal bridge unavailable'))
      .mockResolvedValueOnce({ dispose })
    const baseProps = {
      scope,
      projectResolved: true,
      projectId: 'P-1',
      status: sessionState('starting'),
      isLoading: false,
      actionPending: false,
      error: null,
      availabilityError: null,
      mountTerminal,
      onStart: vi.fn(async () => undefined),
      onAbort: vi.fn(async () => undefined),
      onRestart: vi.fn(async () => undefined),
      onSendInput: vi.fn(async () => undefined),
      onRetryAvailability: vi.fn(async () => undefined),
    }
    const view = render(AgentTab, { props: baseProps })
    await screen.findByText('Terminal bridge unavailable')

    await view.rerender({ ...baseProps, status: sessionState('running') })

    await waitFor(() => expect(mountTerminal).toHaveBeenCalledTimes(2))
    expect(screen.queryByText('Terminal bridge unavailable')).toBeNull()
    view.unmount()
    await waitFor(() => expect(dispose).toHaveBeenCalledOnce())
  })
})
