import { describe, expect, it } from 'vitest'
import { makeSchedule } from '../backend/testFixtures'
import { isTerminalOneOffTaskSchedule, isTerminalTaskSchedule } from './taskScheduleLifecycle'

describe('Task Schedule lifecycle', () => {
  it.each([
    ['completed', { state: 'completed', completedAt: Date.UTC(2026, 0, 1, 9) }],
    ['cancelled', { state: 'cancelled', cancelledAt: Date.UTC(2026, 0, 1, 10) }],
  ] as const)('identifies a %s one-off schedule as terminal', (_state, lifecycle) => {
    const schedule = makeSchedule({
      timing: { type: 'once', runAt: Date.UTC(2026, 0, 1, 9) },
      lifecycle,
    })

    expect(isTerminalTaskSchedule(schedule)).toBe(true)
    expect(isTerminalOneOffTaskSchedule(schedule)).toBe(true)
  })

  it('keeps an active one-off schedule outside the terminal predicates', () => {
    const runAt = Date.UTC(2026, 0, 2, 9)
    const schedule = makeSchedule({
      timing: { type: 'once', runAt },
      lifecycle: { state: 'active', enabled: true, nextFireAt: runAt },
    })

    expect(isTerminalTaskSchedule(schedule)).toBe(false)
    expect(isTerminalOneOffTaskSchedule(schedule)).toBe(false)
  })

  it('distinguishes a cancelled recurring schedule from a terminal one-off', () => {
    const schedule = makeSchedule({
      lifecycle: { state: 'cancelled', cancelledAt: Date.UTC(2026, 0, 1, 10) },
    })

    expect(isTerminalTaskSchedule(schedule)).toBe(true)
    expect(isTerminalOneOffTaskSchedule(schedule)).toBe(false)
  })
})
