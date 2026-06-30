import { render, screen } from '@testing-library/svelte'
import { describe, it, expect, beforeEach } from 'vitest'
import { createAgentSession, resetAgentTerminalTestState, setActiveSession } from './agentTerminalShell.testUtils'
import AgentStatusPill from './AgentStatusPill.svelte'

describe('AgentStatusPill', () => {
  beforeEach(() => {
    resetAgentTerminalTestState()
  })

  it('renders nothing when there is no active session', () => {
    render(AgentStatusPill, { props: { taskId: 'T-1' } })
    expect(screen.queryByTestId('agent-status-pill')).toBeNull()
  })

  it('shows a single provider-specific running status without duplicate stage, badge, or resume command', async () => {
    setActiveSession(createAgentSession({ provider: 'pi', pi_session_id: 'pi-sess-abc123', status: 'running', stage: 'implement' }))
    render(AgentStatusPill, { props: { taskId: 'T-1' } })

    expect(await screen.findByText('Pi agent running...')).toBeTruthy()
    expect(screen.queryByText('implementing')).toBeNull()
    expect(screen.queryByText('RUNNING')).toBeNull()
    expect(screen.queryByText('pi --session pi-sess-abc123')).toBeNull()
  })

  it('shows Claude permission pauses as paused rather than still running', async () => {
    setActiveSession(createAgentSession({ provider: 'claude-code', status: 'paused' }))
    render(AgentStatusPill, { props: { taskId: 'T-1' } })

    expect(await screen.findByText('Agent paused')).toBeTruthy()
    expect(screen.queryByText('PAUSED')).toBeNull()
    expect(screen.queryByText('Claude agent running...')).toBeNull()
  })

  it('flags an OpenCode checkpoint question when paused', async () => {
    setActiveSession(createAgentSession({
      provider: 'opencode',
      status: 'paused',
      opencode_session_id: 'opencode-sess-abc123',
      pi_session_id: null,
      checkpoint_data: '{"properties":{"description":"Which branch should I use?"}}',
    }))
    render(AgentStatusPill, { props: { taskId: 'T-1' } })

    expect(await screen.findByLabelText('Checkpoint question pending')).toBeTruthy()
  })
})
