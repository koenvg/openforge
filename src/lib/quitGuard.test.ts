import { describe, it, expect } from 'vitest'
import { hasActiveAgentSessions } from './quitGuard'
import type { ProjectAttention } from './types'

const makeAttention = (overrides: Partial<ProjectAttention> = {}): ProjectAttention => ({
  project_id: 'p-1',
  needs_input: 0,
  running_agents: 0,
  ci_failures: 0,
  unaddressed_comments: 0,
  completed_agents: 0,
  ...overrides,
})

describe('hasActiveAgentSessions', () => {
  it('returns false for an empty map', () => {
    expect(hasActiveAgentSessions(new Map())).toBe(false)
  })

  it('returns false when every project has no running or waiting agents', () => {
    const attention = new Map([
      ['p-1', makeAttention({ project_id: 'p-1', completed_agents: 3, ci_failures: 2 })],
      ['p-2', makeAttention({ project_id: 'p-2', unaddressed_comments: 5 })],
    ])
    expect(hasActiveAgentSessions(attention)).toBe(false)
  })

  it('returns true when a project has a running agent', () => {
    const attention = new Map([['p-1', makeAttention({ running_agents: 1 })]])
    expect(hasActiveAgentSessions(attention)).toBe(true)
  })

  it('returns true when a project has an agent paused waiting for input', () => {
    const attention = new Map([['p-1', makeAttention({ needs_input: 1 })]])
    expect(hasActiveAgentSessions(attention)).toBe(true)
  })

  it('detects an active agent in any project, not just the first', () => {
    const attention = new Map([
      ['p-1', makeAttention({ project_id: 'p-1', completed_agents: 2 })],
      ['p-2', makeAttention({ project_id: 'p-2' })],
      ['p-3', makeAttention({ project_id: 'p-3', running_agents: 1 })],
    ])
    expect(hasActiveAgentSessions(attention)).toBe(true)
  })

  it('ignores CI failures and unaddressed comments (not agent liveness)', () => {
    const attention = new Map([
      ['p-1', makeAttention({ ci_failures: 4, unaddressed_comments: 9 })],
    ])
    expect(hasActiveAgentSessions(attention)).toBe(false)
  })
})
