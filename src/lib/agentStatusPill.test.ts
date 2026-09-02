import { describe, it, expect } from 'vitest'
import type { AgentSession } from './types'
import { getAgentProviderConfig, deriveAgentStatusPillView } from './agentStatusPill'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    ticket_id: 'T-11',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    provider: 'claude-code',
    claude_session_id: 'claude-sess-abc',
    pi_session_id: null,
    grok_session_id: null,
    output_revision: 0,
    viewed_output_revision: 0,
    ...overrides,
  }
}

describe('getAgentProviderConfig', () => {
  it.each(['claude-code', 'pi', 'codex', 'grok'])('disables checkpoint questions for %s', (provider) => {
    expect(getAgentProviderConfig(provider).supportsCheckpointQuestion).toBe(false)
  })

  it('enables checkpoint questions for OpenCode', () => {
    expect(getAgentProviderConfig('opencode').supportsCheckpointQuestion).toBe(true)
  })
})

describe('deriveAgentStatusPillView', () => {
  it('returns null when there is no session', () => {
    expect(deriveAgentStatusPillView(null, 'idle')).toBeNull()
  })

  it.each(['claude-code', 'pi', 'codex', 'grok', 'opencode'])('omits the running status for %s', (provider) => {
    const view = deriveAgentStatusPillView(makeSession({ provider, status: 'running' }), 'running')

    expect(view).not.toBeNull()
    expect(view!.statusText).toBeNull()
  })

  it('flags an opencode checkpoint question when paused', () => {
    const view = deriveAgentStatusPillView(makeSession({
      provider: 'opencode',
      status: 'paused',
      opencode_session_id: 'oc-1',
      claude_session_id: null,
      checkpoint_data: '{"properties":{"description":"Which branch should I use?"}}',
    }), 'paused')
    expect(view!.statusText).toBe('Agent paused')
    expect(view!.checkpointActive).toBe(true)
  })

  it('does not flag a checkpoint for a running opencode session', () => {
    const view = deriveAgentStatusPillView(makeSession({
      provider: 'opencode',
      status: 'running',
      opencode_session_id: 'oc-1',
      claude_session_id: null,
      checkpoint_data: null,
    }), 'running')
    expect(view!.checkpointActive).toBe(false)
  })
})
