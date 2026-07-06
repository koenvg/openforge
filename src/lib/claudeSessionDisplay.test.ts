import { describe, expect, it } from 'vitest'
import { formatSessionRelativeTime, sessionTitle } from './claudeSessionDisplay'
import type { ClaudeSessionSummary } from './types'

const NOW = Date.parse('2026-07-06T12:00:00.000Z')

function session(overrides: Partial<ClaudeSessionSummary> = {}): ClaudeSessionSummary {
  return {
    sessionId: 'abc-123',
    title: null,
    lastPrompt: null,
    cwd: null,
    gitBranch: null,
    updatedAt: null,
    messageCount: 0,
    ...overrides,
  }
}

describe('formatSessionRelativeTime', () => {
  it('handles missing or invalid timestamps', () => {
    expect(formatSessionRelativeTime(null, NOW)).toBe('unknown time')
    expect(formatSessionRelativeTime('not-a-date', NOW)).toBe('unknown time')
  })

  it('formats across units', () => {
    expect(formatSessionRelativeTime('2026-07-06T11:59:30.000Z', NOW)).toBe('just now')
    expect(formatSessionRelativeTime('2026-07-06T11:45:00.000Z', NOW)).toBe('15m ago')
    expect(formatSessionRelativeTime('2026-07-06T09:00:00.000Z', NOW)).toBe('3h ago')
    expect(formatSessionRelativeTime('2026-07-03T12:00:00.000Z', NOW)).toBe('3d ago')
    expect(formatSessionRelativeTime('2026-06-22T12:00:00.000Z', NOW)).toBe('2w ago')
    expect(formatSessionRelativeTime('2026-05-06T12:00:00.000Z', NOW)).toBe('2mo ago')
  })

  it('never returns a negative/future duration', () => {
    expect(formatSessionRelativeTime('2026-07-06T12:05:00.000Z', NOW)).toBe('just now')
  })
})

describe('sessionTitle', () => {
  it('prefers the title, then last prompt, then the id', () => {
    expect(sessionTitle(session({ title: 'Check main branch', lastPrompt: 'pnpm i' }))).toBe(
      'Check main branch',
    )
    expect(sessionTitle(session({ title: '   ', lastPrompt: 'pnpm i' }))).toBe('pnpm i')
    expect(sessionTitle(session({ title: null, lastPrompt: null }))).toBe('abc-123')
  })
})
