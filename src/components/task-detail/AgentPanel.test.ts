import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { resetAgentIpcMocks } from './agentIpcMocks.testUtils'
import { resetActiveSessions, setActiveSession } from './activeAgentSessions.testUtils'
import { mockPoolEntry, resetAgentTerminalMocks } from './agentTerminalMocks.testUtils'
import { createAgentSession } from './agentSession.testFixtures'
import AgentPanel from './AgentPanel.svelte'

beforeEach(() => {
  resetActiveSessions()
  resetAgentIpcMocks()
  resetAgentTerminalMocks()
  vi.clearAllMocks()
})

describe('AgentPanel (router)', () => {

  it('renders OpenCode panel by default when no session exists without a separate history-loading overlay', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    // Wait for async onMount to complete
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
    })
    expect(screen.queryByText('Loading session output...')).toBeNull()
  })

  it('shows guidance text via OpenCode panel', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.getByText('Use the action buttons in the header to get started')).toBeTruthy()
    })
  })

  it('shows OpenCode panel for opencode provider session', async () => {
    const session = createAgentSession({ provider: 'opencode', opencode_session_id: 'oc-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('opencode-agent-panel')).toBeTruthy()
  })

  it('routes pi provider sessions through the shared terminal shell', () => {
    const session = createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('pi-agent-panel')).toBeTruthy()
  })

  it('routes codex provider sessions through the shared terminal shell', () => {
    const session = createAgentSession({ provider: 'codex', opencode_session_id: 'codex-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('codex-agent-panel')).toBeTruthy()
  })

  it('resolves the grok session key for grok provider sessions', () => {
    const session = createAgentSession({ provider: 'grok', grok_session_id: 'grok-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByTestId('grok-agent-panel')).toBeTruthy()
  })

})

describe('AgentPanel starting animation', () => {

  it('shows starting animation when isStarting=true and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    await vi.waitFor(() => {
      expect(screen.getByText('Starting agent session...')).toBeTruthy()
      expect(screen.getByText('Preparing workspace and launching agent')).toBeTruthy()
      expect(screen.queryByText('No active agent session')).toBeNull()
    })
  })

  it('shows idle state when isStarting=false and no session', async () => {
    render(AgentPanel, { props: { taskId: 'T-1', isStarting: false } })
    await vi.waitFor(() => {
      expect(screen.getByText('No active agent session')).toBeTruthy()
      expect(screen.queryByText('Starting agent session...')).toBeNull()
    })
  })

  it('hides starting animation when session exists', async () => {
    const session = createAgentSession({ provider: 'opencode', opencode_session_id: 'oc-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1', isStarting: true } })
    expect(screen.queryByText('Starting agent session...')).toBeNull()
  })
})

describe('OpenCode shared shell (via router)', () => {

  it('calls attach with the pooled terminal entry for OpenCode sessions', async () => {
    const { agentTerminalSessions } = await import('../../lib/terminalSessionService')
    const { attach } = agentTerminalSessions

    const session = createAgentSession({ provider: 'opencode', opencode_session_id: 'oc-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
  })

  it('does not expose an Abort action for a running agent session', async () => {
    const { agentTerminalSessions } = await import('../../lib/terminalSessionService')
    const { attach } = agentTerminalSessions

    const session = createAgentSession({ provider: 'opencode', opencode_session_id: 'oc-sess-1' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })

    await vi.waitFor(() => {
      expect(attach).toHaveBeenCalledWith(mockPoolEntry, expect.any(HTMLDivElement))
    })
    expect(screen.queryByRole('button', { name: 'Abort' })).toBeNull()
  })

  it('shows question banner when session is paused with checkpoint_data', () => {
    const session = createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"properties":{"description":"Allow file write to src/main.ts?"}}',
    })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Allow file write to src/main.ts?')).toBeTruthy()
  })

  it('shows generic fallback banner when checkpoint_data has no known fields', () => {
    const session = createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: '{"unknown":"data"}',
    })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Agent is waiting for input')).toBeTruthy()
  })

  it('does not show question banner for dedicated PTY instance metadata', () => {
    const session = createAgentSession({ provider: 'opencode', pty_instance_id: 42 })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show question banner when session is running', () => {
    const session = createAgentSession({ provider: 'opencode' })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.queryByText('Agent is waiting for input')).toBeNull()
  })

  it('does not show question banner when no session exists', async () => {
    render(AgentPanel, { props: { taskId: 'T-1' } })
    await vi.waitFor(() => {
      expect(screen.queryByText('Agent is waiting for input')).toBeNull()
    })
  })

  it('shows question text from question.asked event format', () => {
    const session = createAgentSession({
      provider: 'opencode',
      status: 'paused',
      checkpoint_data: JSON.stringify({
        type: 'question.asked',
        properties: {
          id: 'que_abc',
          sessionID: 'ses_xyz',
          questions: [{ question: 'Run or Bike?', header: 'Run or Bike', options: [] }],
        },
      }),
    })

    setActiveSession(session)

    render(AgentPanel, { props: { taskId: 'T-1' } })
    expect(screen.getByText('Run or Bike?')).toBeTruthy()
  })
})
