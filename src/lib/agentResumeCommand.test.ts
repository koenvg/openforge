import { describe, expect, it } from 'vitest'
import { getAgentResumeCommand, getAgentSessionResumeCommand } from './agentResumeCommand'
import type { AgentSession } from './types'

function makeSession(overrides: Partial<AgentSession> = {}): AgentSession {
  return {
    id: 's1',
    ticket_id: 'T-1',
    opencode_session_id: null,
    stage: 'implement',
    status: 'running',
    checkpoint_data: null,
    pty_instance_id: null,
    error_message: null,
    created_at: 0,
    updated_at: 0,
    provider: 'pi',
    claude_session_id: null,
    pi_session_id: 'pi-sess-1',
    grok_session_id: null,
    output_revision: 0,
    viewed_output_revision: 0,
    ...overrides,
  }
}

describe('getAgentResumeCommand', () => {
  it('builds copy-pasteable resume commands for each terminal agent provider', () => {
    expect(getAgentResumeCommand('opencode', 'oc-sess-1')).toBe('opencode --session oc-sess-1')
    expect(getAgentResumeCommand('claude-code', 'claude-sess-1')).toBe('claude --resume claude-sess-1')
    expect(getAgentResumeCommand('pi', 'pi-sess-1')).toBe('pi --session pi-sess-1')
    expect(getAgentResumeCommand('codex', 'codex-sess-1')).toBe('codex resume codex-sess-1')
    expect(getAgentResumeCommand('grok', 'grok-sess-1')).toBe('grok --resume grok-sess-1')
  })

  it('returns null when no provider session id is available', () => {
    expect(getAgentResumeCommand('opencode', null)).toBeNull()
    expect(getAgentResumeCommand('claude-code', '')).toBeNull()
  })
})

describe('getAgentSessionResumeCommand', () => {
  it('uses the session id field that matches the session provider', () => {
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'pi', pi_session_id: 'pi-sess-1' }))).toBe('pi --session pi-sess-1')
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'claude-code', claude_session_id: 'claude-sess-1', pi_session_id: null }))).toBe('claude --resume claude-sess-1')
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'opencode', opencode_session_id: 'oc-sess-1', pi_session_id: null }))).toBe('opencode --session oc-sess-1')
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'grok', grok_session_id: 'grok-sess-1', pi_session_id: null }))).toBe('grok --resume grok-sess-1')
  })

  it('returns null when the session has no resumable provider id', () => {
    expect(getAgentSessionResumeCommand(null)).toBeNull()
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'codex', pi_session_id: null }))).toBeNull()
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'pi', pi_session_id: '' }))).toBeNull()
    expect(getAgentSessionResumeCommand(makeSession({ provider: 'grok', grok_session_id: null, pi_session_id: null }))).toBeNull()
  })
})
