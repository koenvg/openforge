import type { AgentSession } from '../../lib/types'

export function createAgentSession(overrides: Partial<AgentSession> = {}): AgentSession {
  const provider = overrides.provider ?? 'pi'

  return {
    id: 'ses-1',
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    error_message: null,
    created_at: 1000,
    updated_at: 2000,
    provider,
    claude_session_id: provider === 'claude-code' ? 'claude-sess-abc123' : null,
    pi_session_id: provider === 'pi' ? 'pi-sess-abc123' : null,
    grok_session_id: provider === 'grok' ? 'grok-sess-abc123' : null,
    output_revision: 0,
    viewed_output_revision: 0,
    ...overrides,
    pty_instance_id: overrides.pty_instance_id ?? null,
  }
}
