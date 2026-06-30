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
    ...overrides,
  }
}

describe('getAgentProviderConfig', () => {
  it('maps claude-code', () => {
    const c = getAgentProviderConfig('claude-code')
    expect(c.runningText).toBe('Claude agent running...')
    expect(c.sessionIdKey).toBe('claude_session_id')
    expect(c.stageLabelPrefix).toBe('')
    expect(c.uppercaseSessionStatus).toBe(true)
    expect(c.resumeCommandProvider).toBe('claude-code')
  })

  it('maps pi', () => {
    const c = getAgentProviderConfig('pi')
    expect(c.runningText).toBe('Pi agent running...')
    expect(c.sessionIdKey).toBe('pi_session_id')
    expect(c.resumeCommandProvider).toBe('pi')
  })

  it('maps codex with no session id key', () => {
    const c = getAgentProviderConfig('codex')
    expect(c.runningText).toBe('Codex agent running...')
    expect(c.sessionIdKey).toBeNull()
    expect(c.resumeCommandProvider).toBe('codex')
  })

  it('falls back to opencode chrome for unknown/opencode providers', () => {
    const c = getAgentProviderConfig('opencode')
    expect(c.runningText).toBe('Agent running...')
    expect(c.sessionIdKey).toBe('opencode_session_id')
    expect(c.stageLabelPrefix).toBe('')
    expect(c.uppercaseSessionStatus).toBe(false)
    expect(c.resumeCommandProvider).toBe('opencode')
  })
})

describe('deriveAgentStatusPillView', () => {
  it('returns null when there is no session', () => {
    expect(deriveAgentStatusPillView(null, 'idle')).toBeNull()
  })

  it('describes a running claude session', () => {
    const view = deriveAgentStatusPillView(makeSession(), 'running')
    expect(view).not.toBeNull()
    expect(view!.statusText).toBe('Claude agent running...')
    expect(view!.stageLabel).toBe('implementing')
    expect(view!.stageLabel).not.toMatch(/^\/\//)
    expect(view!.sessionStatusLabel).toBe('RUNNING')
    expect(view!.resumeCommand).toBe('claude --resume claude-sess-abc')
    expect(view!.checkpointActive).toBe(false)
  })

  it('uses lowercase status and no resume command for codex (no session id key)', () => {
    const view = deriveAgentStatusPillView(makeSession({ provider: 'codex', status: 'running', claude_session_id: null }), 'running')
    expect(view!.statusText).toBe('Codex agent running...')
    expect(view!.resumeCommand).toBeNull()
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
    expect(view!.sessionStatusLabel).toBe('paused')
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
